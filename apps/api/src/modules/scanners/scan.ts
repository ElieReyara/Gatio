import {
  SCAN_CHANGES_OVERLAP_SECONDS,
  type PassageOutcome,
  type ScanPassage,
  type ScanTicket,
} from '@gatio/shared';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  manifestDownloads,
  orders,
  passages,
  scannerSessions,
  ticketCategories,
  tickets,
} from '../../db/schema.js';
import type { TicketSigner } from '../tickets/signing.js';

const ticketColumns = {
  id: tickets.id,
  categoryId: tickets.categoryId,
  status: tickets.status,
  usedAt: tickets.usedAt,
};

const serializeTicket = (row: {
  id: string;
  categoryId: string;
  status: ScanTicket['status'];
  usedAt: Date | null;
}): ScanTicket => ({ ...row, usedAt: row.usedAt?.toISOString() ?? null });

// Heure du serveur : le curseur ne dépend pas de l'horloge des téléphones (R26).
async function databaseNow(db: Db): Promise<Date> {
  const { rows } = await db.execute<{ now: string | Date }>(sql`select now() as now`);
  return new Date(rows[0]!.now);
}

// R24 : liste du scan de l'événement de la session, téléchargement enregistré.
export async function loadManifest(
  db: Db,
  signer: TicketSigner,
  session: { id: string; eventId: string },
) {
  const cursor = await databaseNow(db);
  const [categories, rows] = await Promise.all([
    db
      .select({ id: ticketCategories.id, name: ticketCategories.name })
      .from(ticketCategories)
      .where(eq(ticketCategories.eventId, session.eventId)),
    db.select(ticketColumns).from(tickets).where(eq(tickets.eventId, session.eventId)),
  ]);
  await db.insert(manifestDownloads).values({
    scannerSessionId: session.id,
    ticketCount: rows.length,
    cursorAt: cursor,
  });
  return {
    eventId: session.eventId,
    keys: [{ keyId: signer.keyId, publicKey: signer.publicKey }],
    categories,
    tickets: rows.map(serializeTicket),
    cursor: cursor.toISOString(),
  };
}

// R27 : billets changés depuis le curseur moins 30 s (la fusion côté téléphone est sans effet
// double) ; nouveau curseur = heure du serveur.
export async function changesSince(db: Db, eventId: string, since: Date) {
  const cursor = await databaseNow(db);
  const from = new Date(since.getTime() - SCAN_CHANGES_OVERLAP_SECONDS * 1000);
  const rows = await db
    .select(ticketColumns)
    .from(tickets)
    .where(and(eq(tickets.eventId, eventId), gt(tickets.updatedAt, from)));
  return { tickets: rows.map(serializeTicket), cursor: cursor.toISOString() };
}

// R26 : chaque passage est enregistré une fois (identifiant du téléphone) ; le premier reçu qui
// a été vu « valide » passe le billet à « utilisé » par une mise à jour conditionnelle, les
// suivants sont des doublons. Un passage par transaction : l'identifiant est réservé d'abord,
// un envoi rejoué en même temps attend puis relit la décision déjà prise.
export async function recordPassages(
  db: Db,
  signer: TicketSigner,
  session: { id: string; eventId: string },
  batch: ScanPassage[],
) {
  const results: Array<{ id: string; outcome: PassageOutcome; usedAt: string | null }> = [];
  for (const passage of batch) {
    results.push(await recordPassage(db, signer, session, passage));
  }
  return results;
}

async function recordPassage(
  db: Db,
  signer: TicketSigner,
  session: { id: string; eventId: string },
  passage: ScanPassage,
) {
  return db.transaction(async (tx) => {
    const [reserved] = await tx
      .insert(passages)
      .values({
        id: passage.id,
        eventId: session.eventId,
        scannerSessionId: session.id,
        scannedAt: new Date(passage.scannedAt),
        localResult: passage.localResult,
        // Provisoire, remplacé ci-dessous dans la même transaction.
        outcome: 'unknown_ticket',
        verifyMs: passage.verifyMs,
      })
      .onConflictDoNothing({ target: passages.id })
      .returning({ id: passages.id });
    if (!reserved) {
      // Rejeu : la décision déjà prise, seulement pour la session qui l'a envoyée.
      const [stored] = await tx
        .select({ outcome: passages.outcome, usedAt: tickets.usedAt })
        .from(passages)
        .leftJoin(
          tickets,
          and(eq(tickets.id, passages.ticketId), eq(tickets.eventId, passages.eventId)),
        )
        .where(and(eq(passages.id, passage.id), eq(passages.scannerSessionId, session.id)));
      return {
        id: passage.id,
        outcome: stored?.outcome ?? 'unknown_ticket',
        usedAt: stored?.usedAt?.toISOString() ?? null,
      };
    }

    // Un QR refusé par le téléphone n'agit jamais sur un billet. Un passage « valide » doit
    // porter le QR authentique de ce billet : l'identifiant seul, lisible dans la liste remise
    // à tout détenteur du lien, ne permet pas d'utiliser des billets à distance.
    const proof =
      passage.localResult === 'valid' && passage.qr ? signer.verifyTicket(passage.qr) : null;
    const genuine = proof !== null && proof.ticketId === passage.ticketId;
    const ticketId =
      passage.localResult === 'invalid' || (passage.localResult === 'valid' && !genuine)
        ? null
        : passage.ticketId;
    let outcome: PassageOutcome = 'unknown_ticket';
    let storedTicketId: string | null = null;
    let usedAt: Date | null = null;
    if (ticketId) {
      const [ticket] = await tx
        .select({ id: tickets.id, eventId: tickets.eventId, status: tickets.status })
        .from(tickets)
        .where(eq(tickets.id, ticketId));
      if (ticket) {
        // Billet d'un autre événement : son identifiant n'est pas gardé (rien à montrer d'un
        // autre organisateur dans le rapport d'entrée).
        storedTicketId = ticket.eventId === session.eventId ? ticket.id : null;
        if (ticket.eventId !== session.eventId) outcome = 'wrong_event';
        else if (ticket.status === 'void') outcome = 'void_ticket';
        else {
          const [used] =
            passage.localResult === 'valid'
              ? await tx
                  .update(tickets)
                  .set({ status: 'used', usedAt: sql`now()`, updatedAt: sql`now()` })
                  .where(and(eq(tickets.id, ticket.id), eq(tickets.status, 'valid')))
                  .returning({ usedAt: tickets.usedAt })
              : [];
          outcome = used ? 'accepted' : 'duplicate';
          usedAt = used?.usedAt ?? null;
          if (!used) {
            const [current] = await tx
              .select({ usedAt: tickets.usedAt })
              .from(tickets)
              .where(eq(tickets.id, ticket.id));
            usedAt = current?.usedAt ?? null;
          }
        }
      }
    }
    await tx
      .update(passages)
      .set({ outcome, ticketId: storedTicketId })
      .where(eq(passages.id, passage.id));
    return { id: passage.id, outcome, usedAt: usedAt?.toISOString() ?? null };
  });
}

const PHONE_FRESH_MINUTES = 2;
const LATEST_PASSAGES = 30;

// Rapport d'entrée (maquette O8).
export async function entryReport(db: Db, eventId: string) {
  const [statusCounts, duplicates, phones, latest] = await Promise.all([
    db
      .select({ status: tickets.status, total: count() })
      .from(tickets)
      .where(eq(tickets.eventId, eventId))
      .groupBy(tickets.status),
    db
      .select({ total: count() })
      .from(passages)
      .where(and(eq(passages.eventId, eventId), eq(passages.outcome, 'duplicate'))),
    db
      .selectDistinct({ id: scannerSessions.id })
      .from(scannerSessions)
      .innerJoin(manifestDownloads, eq(manifestDownloads.scannerSessionId, scannerSessions.id))
      .where(
        and(
          eq(scannerSessions.eventId, eventId),
          isNull(scannerSessions.revokedAt),
          sql`${scannerSessions.lastSeenAt} > now() - make_interval(mins => ${PHONE_FRESH_MINUTES})`,
        ),
      ),
    db
      .select({
        id: passages.id,
        receivedAt: passages.receivedAt,
        outcome: passages.outcome,
        categoryName: ticketCategories.name,
        orderReference: orders.reference,
        scannerName: scannerSessions.firstName,
        usedAt: tickets.usedAt,
      })
      .from(passages)
      .innerJoin(scannerSessions, eq(scannerSessions.id, passages.scannerSessionId))
      .leftJoin(
        tickets,
        and(eq(tickets.id, passages.ticketId), eq(tickets.eventId, passages.eventId)),
      )
      .leftJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId))
      .leftJoin(orders, eq(orders.id, tickets.orderId))
      .where(eq(passages.eventId, eventId))
      .orderBy(desc(passages.receivedAt))
      .limit(LATEST_PASSAGES),
  ]);
  const byStatus = new Map(statusCounts.map((row) => [row.status, Number(row.total)]));
  const entered = byStatus.get('used') ?? 0;
  return {
    entered,
    sold: entered + (byStatus.get('valid') ?? 0),
    duplicates: Number(duplicates[0]?.total ?? 0),
    phonesUpToDate: phones.length,
    latest: latest.map((row) => ({
      id: row.id,
      receivedAt: row.receivedAt.toISOString(),
      outcome: row.outcome,
      categoryName: row.categoryName,
      orderReference: row.orderReference,
      scannerName: row.scannerName,
      usedAt: row.outcome === 'duplicate' ? (row.usedAt?.toISOString() ?? null) : null,
    })),
  };
}
