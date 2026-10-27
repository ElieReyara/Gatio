import {
  errorResponseSchema,
  nextActionSchema,
  paymentStartedSchema,
  paymentStartSchema,
  type PaymentStarted,
} from '@gatio/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { events, orders, paymentWebhookEvents, payments } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { limits } from '../../lib/limits.js';
import { consumeLimit } from '../../lib/rate-limit.js';
import { orderForRequest } from '../orders/access.js';
import type { PaymentPort } from './port.js';

const errors = {
  400: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  429: errorResponseSchema,
  502: errorResponseSchema,
};

// Démarrage d'un paiement (contrat §6.2), accès « commande ».
export const paymentRoutes =
  (db: Db, port: PaymentPort): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/orders/:id/payments',
      {
        schema: {
          params: z.object({ id: z.uuid() }),
          body: paymentStartSchema,
          response: { 201: paymentStartedSchema, 200: paymentStartedSchema, ...errors },
        },
      },
      async (request, reply) => {
        const key = request.headers['idempotency-key'];
        if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'En-tête Idempotency-Key manquant ou invalide.',
            {
              reason: 'idempotency_key_required',
            },
          );
        }
        const order = await orderForRequest(db, request, request.params.id);
        if (!order) throw new AppError(404, 'NOT_FOUND', 'Commande introuvable.');
        if (!(await consumeLimit(db, `payment_ip:${request.ip}`, limits.paymentPerIp))) {
          throw new AppError(
            429,
            'RATE_LIMITED',
            'Trop de demandes de paiement. Réessayez plus tard.',
            {
              reason: 'too_many_payments',
            },
          );
        }

        const prepared = await db.transaction(async (tx) => {
          // Verrou de la commande : deux démarrages simultanés passent l'un après l'autre.
          const [locked] = await tx
            .select({
              order: orders,
              eventStatus: events.status,
              active: sql<boolean>`${orders.reservationExpiresAt} > now()`,
            })
            .from(orders)
            .innerJoin(events, eq(events.id, orders.eventId))
            .where(eq(orders.id, order.id))
            .for('update', { of: orders });
          const [replay] = await tx
            .select()
            .from(payments)
            .where(and(eq(payments.orderId, order.id), eq(payments.idempotencyKey, key)));
          if (replay) return { kind: 'replay' as const, payment: replay };
          if (locked!.order.status === 'paid') {
            throw new AppError(409, 'VALIDATION_ERROR', 'Cette commande est déjà payée.', {
              reason: 'already_paid',
            });
          }
          if (locked!.order.status !== 'pending' || !locked!.active) {
            throw new AppError(409, 'RESERVATION_EXPIRED', 'Cette réservation a expiré.');
          }
          // R34 : un paiement déjà en cours reste traité, mais aucun nouveau ne démarre.
          if (locked!.eventStatus !== 'published') {
            throw new AppError(
              409,
              'EVENT_NOT_ON_SALE',
              'Les ventes de cet événement sont arrêtées.',
              {
                status: locked!.eventStatus,
              },
            );
          }
          // « Changer de moyen de paiement » : l'essai précédent est abandonné (R13).
          await tx
            .update(payments)
            .set({ status: 'failed', failureReason: 'replaced', updatedAt: sql`now()` })
            .where(and(eq(payments.orderId, order.id), eq(payments.status, 'pending')));
          const id = crypto.randomUUID();
          const [created] = await tx
            .insert(payments)
            .values({
              id,
              orderId: order.id,
              provider: port.name,
              // Remplacée par la référence du prestataire dès sa réponse.
              providerRef: `local:${id}`,
              method: request.body.method,
              amount: order.totalAmount,
              currency: order.currency,
              idempotencyKey: key,
            })
            .returning();
          return { kind: 'created' as const, payment: created! };
        });

        if (prepared.kind === 'replay') {
          const next = nextActionSchema.safeParse(prepared.payment.nextAction);
          if (!next.success) {
            throw new AppError(409, 'VALIDATION_ERROR', 'Ce paiement n’a pas pu démarrer.', {
              reason: 'payment_not_started',
            });
          }
          return reply.code(200).send({
            paymentId: prepared.payment.id,
            status: prepared.payment.status,
            next: next.data,
          } satisfies PaymentStarted);
        }

        // Appel au prestataire hors transaction : la commande n'est pas verrouillée
        // pendant l'attente du réseau.
        const payment = prepared.payment;
        try {
          const started = await port.start({
            reference: payment.id,
            amount: payment.amount,
            currency: payment.currency,
            method: request.body.method,
            phone: order.contactPhone,
          });
          await db
            .update(payments)
            .set({
              providerRef: started.providerRef,
              nextAction: started.next,
              updatedAt: sql`now()`,
            })
            .where(eq(payments.id, payment.id));
          return reply.code(201).send({
            paymentId: payment.id,
            status: 'pending',
            next: started.next,
          } satisfies PaymentStarted);
        } catch (error) {
          request.log.error({ err: error, paymentId: payment.id }, 'payment start failed');
          await db
            .update(payments)
            .set({ status: 'failed', failureReason: 'provider_unavailable', updatedAt: sql`now()` })
            .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')));
          throw new AppError(
            502,
            'INTERNAL_ERROR',
            'Le service de paiement ne répond pas. Réessayez.',
          );
        }
      },
    );
  };

// Notification du prestataire (contrat §6.2, R15) : corps brut pour vérifier la signature,
// enregistrée une seule fois, 200 dès l'enregistrement ; traitement en tâche de fond.
export const paymentWebhookRoutes =
  (
    db: Db,
    port: PaymentPort,
    notificationReceived: (notificationId: string) => Promise<void>,
  ): FastifyPluginAsync =>
  async (app) => {
    app.removeAllContentTypeParsers();
    app.addContentTypeParser(
      '*',
      { parseAs: 'buffer', bodyLimit: 64 * 1024 },
      (_request, body, done) => done(null, body),
    );
    app.post<{ Params: { provider: string } }>(
      '/webhooks/payments/:provider',
      { schema: { hide: true } },
      async (request, reply) => {
        if (request.params.provider !== port.name) {
          throw new AppError(404, 'NOT_FOUND', 'Prestataire inconnu.');
        }
        // Signature vérifiée sur les octets reçus, avant toute lecture du contenu (R15).
        const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        const verified = port.verifyNotification(request.headers, rawBody);
        // Signature fausse : gardée pour l'enquête dans une limite par adresse, jamais traitée.
        if (
          !verified.signatureValid &&
          !(await consumeLimit(db, `webhook_invalid_ip:${request.ip}`, limits.invalidWebhookPerIp))
        ) {
          throw new AppError(401, 'UNAUTHENTICATED', 'Signature invalide.');
        }
        const [saved] = await db
          .insert(paymentWebhookEvents)
          .values({
            provider: port.name,
            // Une fausse notification ne doit pas occuper l'identifiant d'une vraie.
            providerEventId: verified.signatureValid
              ? verified.eventId
              : `invalid:${crypto.randomUUID()}`,
            payload: verified.payload as object,
            signatureValid: verified.signatureValid,
            ...(verified.signatureValid
              ? {}
              : { processedAt: sql`now()`, outcome: 'invalid_signature' }),
          })
          .onConflictDoNothing()
          .returning({ id: paymentWebhookEvents.id });
        if (!verified.signatureValid) {
          throw new AppError(401, 'UNAUTHENTICATED', 'Signature invalide.');
        }
        // Doublon (même identifiant de notification) : ignoré, réponse identique.
        if (saved) await notificationReceived(saved.id);
        return reply.code(200).send({ received: true });
      },
    );
  };
