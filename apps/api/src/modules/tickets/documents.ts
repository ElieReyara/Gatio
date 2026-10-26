import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { events, orderItems, orders, ticketCategories, tickets } from '../../db/schema.js';
import type { TicketDocument } from './pdf.js';
import type { TicketSigner } from './signing.js';

export type OrderTicket = TicketDocument & { ticketId: string; status: 'valid' | 'used' | 'void' };

// Billets d'une commande, dans l'ordre affiché partout (page, PDF, email) ; QR signé à la
// lecture (signature Ed25519 déterministe, rien n'est stocké).
export async function loadOrderTickets(
  db: DbOrTx,
  signer: TicketSigner,
  orderId: string,
): Promise<OrderTicket[]> {
  const rows = await db
    .select({
      ticket: tickets,
      categoryName: ticketCategories.name,
      price: orderItems.unitPrice,
      reference: orders.reference,
      event: {
        title: events.title,
        startsAt: events.startsAt,
        venue: events.venue,
        city: events.city,
        status: events.status,
      },
    })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .innerJoin(events, eq(events.id, tickets.eventId))
    .innerJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId))
    .innerJoin(orderItems, eq(orderItems.id, tickets.orderItemId))
    .where(eq(tickets.orderId, orderId))
    .orderBy(asc(ticketCategories.position), asc(orderItems.id), asc(tickets.ordinal));
  return rows.map((row, index) => ({
    ticketId: row.ticket.id,
    status: row.ticket.status,
    eventTitle: row.event.title,
    startsAt: row.event.startsAt.toISOString(),
    venue: row.event.venue,
    city: row.event.city,
    postponed: row.event.status === 'postponed',
    categoryName: row.categoryName,
    price: row.price,
    reference: row.reference,
    index: index + 1,
    count: rows.length,
    qr: signer.signTicket({
      ticketId: row.ticket.id,
      eventId: row.ticket.eventId,
      categoryId: row.ticket.categoryId,
    }),
  }));
}
