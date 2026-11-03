import {
  parseTicketQr,
  SCAN_PASSAGES_PER_BATCH,
  scanPassageSchema,
  type PassageOutcome,
  type ScanPassage,
  type ScanTicket,
} from '@gatio/shared';
import type { LocalPassage } from './storage';
import type { PreparedManifest } from './verify';

// Règles de la file des passages et de la liste locale (R26, R27), sans navigateur : testées.

export const toWire = (passage: LocalPassage): ScanPassage => ({
  id: passage.id,
  ticketId: passage.ticketId,
  scannedAt: passage.scannedAt,
  localResult: passage.localResult,
  verifyMs: passage.verifyMs,
  qr: passage.qr,
});

// Prochain lot à envoyer : passages de l'événement en cours, dans l'ordre des scans (un
// « valide » part avant un « déjà utilisé » du même billet). Un passage mal formé est écarté
// au lieu de bloquer toute la file.
export function nextBatch(queue: LocalPassage[], eventId: string) {
  const invalid: string[] = [];
  const batch: LocalPassage[] = [];
  const mine = queue
    .filter((passage) => passage.eventId === eventId)
    .sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
  for (const passage of mine) {
    if (!scanPassageSchema.safeParse(toWire(passage)).success) invalid.push(passage.id);
    else if (batch.length < SCAN_PASSAGES_PER_BATCH) batch.push(passage);
  }
  return { batch, invalid };
}

// Passages d'un autre événement que la liste en cours : ils ne peuvent plus partir.
export const otherEvents = (queue: LocalPassage[], eventId: string) =>
  queue.filter((passage) => passage.eventId !== eventId).map((passage) => passage.id);

// Billets reçus du serveur (changements) : fusion sans effet double.
export function mergeTickets(manifest: PreparedManifest, tickets: ScanTicket[]): boolean {
  for (const ticket of tickets) manifest.tickets.set(ticket.id, ticket);
  return tickets.length > 0;
}

// Réponse d'un envoi : les billets acceptés ou en doublon sont « utilisés » dans la liste
// locale avant que leurs passages quittent la file (un rechargement hors ligne ne redonne
// donc jamais VALIDE pour un billet déjà passé sur ce téléphone).
export function applyResults(
  manifest: PreparedManifest,
  batch: LocalPassage[],
  results: Array<{ id: string; outcome: PassageOutcome; usedAt: string | null }>,
): boolean {
  const byId = new Map(batch.map((passage) => [passage.id, passage]));
  let changed = false;
  for (const result of results) {
    if (result.outcome !== 'accepted' && result.outcome !== 'duplicate') continue;
    const passage = byId.get(result.id);
    if (!passage?.ticketId) continue;
    const known = manifest.tickets.get(passage.ticketId);
    const categoryId =
      known?.categoryId ?? (passage.qr ? parseTicketQr(passage.qr)?.categoryId : undefined);
    if (!categoryId) continue;
    manifest.tickets.set(passage.ticketId, {
      id: passage.ticketId,
      categoryId,
      status: 'used',
      usedAt: earliest(result.usedAt, known?.usedAt ?? null) ?? passage.scannedAt,
    });
    changed = true;
  }
  return changed;
}

// Premier passage « valide » de ce téléphone, par billet (file encore à envoyer).
export function firstValidPassages(passages: LocalPassage[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const passage of [...passages].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt))) {
    if (passage.localResult === 'valid' && passage.ticketId && !first.has(passage.ticketId)) {
      first.set(passage.ticketId, passage.scannedAt);
    }
  }
  return first;
}

export function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}
