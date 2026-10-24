import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { fakeOutcomes, type FakeNotification, type FakePaymentProvider } from './fake-provider.js';

// Outil d'essai (développement seulement) : joue le rôle du téléphone de l'acheteur face
// au faux prestataire. Les notifications passent par la vraie route de notification.
export const fakePaymentDevRoutes =
  (
    provider: FakePaymentProvider,
    deliver: (notification: FakeNotification) => Promise<void>,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/', { schema: { hide: true } }, async () => ({
      items: provider.list().map((payment) => ({
        providerRef: payment.providerRef,
        amount: payment.amount,
        method: payment.method,
        status: payment.status,
        createdAt: payment.createdAt.toISOString(),
      })),
    }));

    app.post(
      '/:providerRef',
      {
        schema: {
          hide: true,
          params: z.object({ providerRef: z.string().max(100) }),
          body: z.object({ outcome: z.enum(fakeOutcomes) }),
        },
      },
      async (request) => {
        const notifications = provider.simulate(request.params.providerRef, request.body.outcome);
        if (notifications.length === 0 && request.body.outcome !== 'accept_silent') {
          throw new AppError(404, 'NOT_FOUND', 'Paiement inconnu ou déjà terminé.');
        }
        for (const notification of notifications) await deliver(notification);
        return { delivered: notifications.length };
      },
    );
  };
