import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { renderTicketPdf, type TicketDocument } from './pdf.js';
import { createTicketSigner, generateSigningKey } from './signing.js';

const signer = createTicketSigner(1, generateSigningKey());
const ticket = (overrides: Partial<TicketDocument> = {}): TicketDocument => ({
  eventTitle: 'Soirée Sahel Live',
  startsAt: '2026-11-14T18:00:00.000Z',
  venue: 'Salle des fêtes',
  city: "N'Djamena",
  categoryName: 'Standard',
  price: 5000,
  reference: 'GT-7K3M9Q',
  index: 1,
  count: 2,
  qr: signer.signTicket({
    ticketId: '00000000-0000-4000-8000-000000000001',
    eventId: '00000000-0000-4000-8000-0000000000e1',
    categoryId: '00000000-0000-4000-8000-0000000000c1',
  }),
  ...overrides,
});

// Rectangles dessinés (« x y l h re ») dans le contenu non compressé du PDF.
function rectangles(pdf: Buffer) {
  return [...pdf.toString('latin1').matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/g)].map(
    (match) => match.slice(1, 5).map(Number) as [number, number, number, number],
  );
}

describe('billet PDF (P1)', () => {
  it('le QR dessiné est exactement le QR signé du billet (module par module)', async () => {
    const document = ticket();
    const pdf = await renderTicketPdf(document, { compress: false });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const rects = rectangles(pdf);
    // Le fond blanc du QR est le plus grand carré ; chaque module noir est un petit carré.
    const background = rects.reduce((largest, rect) => (rect[2] > largest[2] ? rect : largest));
    const [left, top, size] = background;
    const expected = QRCode.create(document.qr, { errorCorrectionLevel: 'M' }).modules;
    const cell = size / (expected.size + 8);
    const drawn = new Set(
      rects
        .filter((rect) => Math.abs(rect[2] - cell) < 0.01)
        .map(
          ([x, y]) => `${Math.round((y - top) / cell) - 4},${Math.round((x - left) / cell) - 4}`,
        ),
    );
    const wanted = new Set<string>();
    for (let row = 0; row < expected.size; row++) {
      for (let col = 0; col < expected.size; col++) {
        if (expected.get(row, col)) wanted.add(`${row},${col}`);
      }
    }
    expect(drawn).toEqual(wanted);
  });

  it('titre très long, catégorie longue, retours à la ligne : une seule page', async () => {
    const pdf = await renderTicketPdf(
      ticket({
        eventTitle: `${'Grand concert de fin d’année '.repeat(4)}\n\nédition spéciale`,
        categoryName: 'Carré VIP avec accès coulisses et boissons offertes toute la soirée',
        venue: 'Salle\ndes fêtes',
        price: 150000,
      }),
      { compress: false },
    );
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it('événement reporté : « Date à confirmer » au lieu de la date', async () => {
    const pdf = (await renderTicketPdf(ticket({ postponed: true }), { compress: false })).toString(
      'latin1',
    );
    // Texte écrit en hexadécimal par les polices standard du PDF.
    const hex = Buffer.from('Date à confirmer', 'latin1').toString('hex');
    expect(pdf.toLowerCase()).toContain(hex);
  });
});
