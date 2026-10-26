import { randomUUID } from 'node:crypto';
import {
  prototypeSampleSchema,
  prototypeSamplesResponseSchema,
  scanManifestSchema,
  type PrototypeSample,
  type ScanManifest,
} from '@gatio/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { renderTicketPdf } from '../tickets/pdf.js';
import type { TicketSigner } from '../tickets/signing.js';

// Prototype de la tranche 1 (développement seulement) : liste fictive en mémoire pour
// essayer le scan hors ligne avant que billets et événements existent. À retirer quand
// le manifeste réel (tranche 10) sera en place.

const EVENT_ID = '00000000-0000-4000-8000-0000000000e1';
const OTHER_EVENT_ID = '00000000-0000-4000-8000-0000000000e2';
const STANDARD = '00000000-0000-4000-8000-0000000000c1';
const VIP = '00000000-0000-4000-8000-0000000000c2';

type Ticket = ScanManifest['tickets'][number];

const [standard1, standard2, vip3, used, voided] = [
  { id: '00000000-0000-4000-8000-000000000001', categoryId: STANDARD, status: 'valid' },
  { id: '00000000-0000-4000-8000-000000000002', categoryId: STANDARD, status: 'valid' },
  { id: '00000000-0000-4000-8000-000000000003', categoryId: VIP, status: 'valid' },
  { id: '00000000-0000-4000-8000-000000000004', categoryId: STANDARD, status: 'used' },
  { id: '00000000-0000-4000-8000-000000000005', categoryId: VIP, status: 'void' },
] as const satisfies Ticket[];

export const scanPrototypeRoutes =
  (signer: TicketSigner): FastifyPluginAsyncZod =>
  async (app) => {
    const tickets = new Map<string, Ticket>(
      [standard1, standard2, vip3, used, voided].map((ticket) => [ticket.id, { ...ticket }]),
    );
    const sign = (ticket: Ticket, eventId = EVENT_ID) =>
      signer.signTicket({ ticketId: ticket.id, eventId, categoryId: ticket.categoryId });

    app.get('/manifest', { schema: { response: { 200: scanManifestSchema } } }, async () => ({
      eventId: EVENT_ID,
      keys: [{ keyId: signer.keyId, publicKey: signer.publicKey }],
      categories: [
        { id: STANDARD, name: 'Standard' },
        { id: VIP, name: 'VIP' },
      ],
      tickets: [...tickets.values()],
      cursor: new Date().toISOString(),
    }));

    app.get(
      '/samples',
      { schema: { response: { 200: prototypeSamplesResponseSchema } } },
      async () => {
        const items: PrototypeSample[] = [
          { label: 'Billet Standard n° 1', expected: 'valid', qr: sign(standard1) },
          { label: 'Billet Standard n° 2', expected: 'valid', qr: sign(standard2) },
          { label: 'Billet VIP n° 3', expected: 'valid', qr: sign(vip3) },
          { label: 'Billet déjà utilisé', expected: 'already_used', qr: sign(used) },
          { label: 'Billet annulé (commande remboursée)', expected: 'void', qr: sign(voided) },
          {
            label: "Billet d'un autre événement",
            expected: 'invalid',
            qr: sign(standard1, OTHER_EVENT_ID),
          },
          {
            label: 'Billet contrefait (signature fausse)',
            expected: 'invalid',
            qr: forge(sign(standard1)),
          },
        ];
        return { items };
      },
    );

    // Critère de la tranche 7 : le PDF du billet se scanne avec la page de la tranche 1.
    // Billet Standard n° 1 de la liste fictive, dessiné par le même générateur que les vrais.
    app.get('/sample.pdf', { schema: { hide: true } }, async (_request, reply) => {
      const pdf = await renderTicketPdf({
        eventTitle: 'Événement d’essai (prototype)',
        startsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        venue: 'Salle d’essai',
        city: "N'Djamena",
        categoryName: 'Standard',
        price: 5000,
        reference: 'GT-ESSAI1',
        index: 1,
        count: 1,
        qr: sign(standard1),
      });
      return reply.type('application/pdf').send(pdf);
    });

    // Billet « vendu après le téléchargement de la liste » : absent de la liste du téléphone.
    app.post(
      '/tickets',
      { schema: { response: { 201: prototypeSampleSchema } } },
      async (_request, reply) => {
        const ticket: Ticket = { id: randomUUID(), categoryId: STANDARD, status: 'valid' };
        tickets.set(ticket.id, ticket);
        return reply.code(201).send({
          label: 'Billet vendu après le téléchargement',
          expected: 'valid',
          qr: sign(ticket),
        });
      },
    );
  };

// Change un caractère au milieu de la signature : même billet, signature fausse.
function forge(qr: string): string {
  const position = qr.length - 20;
  const replacement = qr[position] === 'A' ? 'B' : 'A';
  return qr.slice(0, position) + replacement + qr.slice(position + 1);
}
