import { emailVerificationConfirmSchema, errorResponseSchema } from '@gatio/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { buyers, emailVerifications, funnelEvents } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { limits } from '../../lib/limits.js';
import { consumeLimit } from '../../lib/rate-limit.js';
import { hashToken } from '../../lib/tokens.js';
import { orderByToken } from '../orders/access.js';
import { loadOrderTickets } from './documents.js';
import { renderTicketPdf } from './pdf.js';
import type { TicketSigner } from './signing.js';

const errors = {
  400: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
};

export const ticketRoutes =
  (db: Db, signer: TicketSigner): FastifyPluginAsyncZod =>
  async (app) => {
    // PDF du billet (contrat §6.2, maquette P1), accès « commande » : jeton en en-tête, jamais
    // dans l'adresse (absent des journaux). Généré à la demande, jamais stocké (§3.9).
    app.get(
      '/orders/:id/tickets/:ticketId/pdf',
      {
        // Réponse binaire (PDF) : pas de schéma de réponse JSON.
        schema: { params: z.object({ id: z.uuid(), ticketId: z.uuid() }) },
      },
      async (request, reply) => {
        // Chaque PDF se calcule : limité par adresse, comme les autres routes coûteuses.
        if (!(await consumeLimit(db, `ticket_pdf_ip:${request.ip}`, limits.ticketPdfPerIp))) {
          throw new AppError(429, 'RATE_LIMITED', 'Trop de téléchargements. Réessayez plus tard.');
        }
        const order = await orderByToken(db, request.params.id, request.headers['x-order-token']);
        if (!order || order.status !== 'paid') {
          throw new AppError(404, 'NOT_FOUND', 'Billet introuvable.');
        }
        const ticket = (await loadOrderTickets(db, signer, order.id)).find(
          (candidate) => candidate.ticketId === request.params.ticketId,
        );
        if (!ticket || ticket.status === 'void') {
          throw new AppError(404, 'NOT_FOUND', 'Billet introuvable.');
        }
        const pdf = await renderTicketPdf(ticket);
        await recordDownload(db, order.id, order.eventId);
        return reply
          .header('cache-control', 'no-store')
          .header(
            'content-disposition',
            `attachment; filename="billet-${ticket.reference}-${ticket.index}.pdf"`,
          )
          .type('application/pdf')
          .send(pdf);
      },
    );

    // Validation de l'email de l'acheteur (R32, maquette B9) : l'email n'est rattaché au
    // compte qu'ici, et ne sert jamais à se connecter.
    app.post(
      '/email-verifications/confirm',
      {
        schema: {
          body: emailVerificationConfirmSchema,
          response: { 200: z.object({ confirmed: z.literal(true) }), ...errors },
        },
      },
      async (request) => {
        if (!(await consumeLimit(db, `email_verify_ip:${request.ip}`, limits.emailVerifyPerIp))) {
          throw new AppError(429, 'RATE_LIMITED', 'Trop d’essais. Réessayez plus tard.');
        }
        const confirmed = await db.transaction(async (tx) => {
          const [verification] = await tx
            .update(emailVerifications)
            .set({ consumedAt: sql`now()` })
            .where(
              and(
                eq(emailVerifications.tokenHash, hashToken(request.body.token)),
                isNull(emailVerifications.consumedAt),
                sql`${emailVerifications.expiresAt} > now()`,
              ),
            )
            .returning();
          if (!verification) return false;
          await tx
            .update(buyers)
            .set({ email: verification.email, emailVerifiedAt: sql`now()`, updatedAt: sql`now()` })
            .where(eq(buyers.id, verification.buyerId));
          // Les autres liens en attente pour ce compte ne servent plus : un ancien lien cliqué
          // plus tard ne remplacerait pas l'adresse qui vient d'être confirmée.
          await tx
            .update(emailVerifications)
            .set({ consumedAt: sql`now()` })
            .where(
              and(
                eq(emailVerifications.buyerId, verification.buyerId),
                isNull(emailVerifications.consumedAt),
              ),
            );
          return true;
        });
        if (!confirmed) {
          throw new AppError(400, 'TOKEN_INVALID', 'Ce lien n’est plus valable.');
        }
        return { confirmed: true as const };
      },
    );
  };

// Mesure du parcours (§8) écrite par le serveur, avec la session anonyme du paiement ;
// une seule fois par commande (les téléchargements répétés ne faussent pas la mesure).
async function recordDownload(db: Db, orderId: string, eventId: string) {
  const [already] = await db
    .select({ id: funnelEvents.id })
    .from(funnelEvents)
    .where(and(eq(funnelEvents.orderId, orderId), eq(funnelEvents.type, 'ticket_downloaded')))
    .limit(1);
  if (already) return;
  const [initiated] = await db
    .select({ anonSessionId: funnelEvents.anonSessionId })
    .from(funnelEvents)
    .where(and(eq(funnelEvents.orderId, orderId), eq(funnelEvents.type, 'payment_initiated')))
    .orderBy(desc(funnelEvents.occurredAt))
    .limit(1);
  if (!initiated) return;
  await db.insert(funnelEvents).values({
    anonSessionId: initiated.anonSessionId,
    eventId,
    orderId,
    type: 'ticket_downloaded',
  });
}
