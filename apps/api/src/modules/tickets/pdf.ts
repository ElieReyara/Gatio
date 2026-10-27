import { formatDateTime, formatMoney } from '@gatio/shared';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export type TicketDocument = {
  eventTitle: string;
  startsAt: string;
  venue: string;
  city: string;
  categoryName: string;
  price: number;
  reference: string;
  index: number;
  count: number;
  qr: string;
  // Événement reporté : « Date à confirmer », comme sur sa page (B2).
  postponed?: boolean;
  // Événement annulé : bandeau en tête du billet (décision du responsable, PC-7).
  cancelled?: boolean;
};

// Un titre ou un lieu saisi avec des retours à la ligne reste sur ses lignes prévues.
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

// Billet PDF (maquette P1, conception §3.9) : A4, noir et blanc, lisible imprimé ; généré à
// la demande, jamais stocké. Polices standard du PDF (accents français compris).
const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const INK = '#000000';
// Tracé de l'icône « billet » du logo (système de design), en 24 × 24.
const TICKET_ICON = 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z';

export async function renderTicketPdf(
  ticket: TicketDocument,
  // Tests : contenu lisible (vérification du QR dessiné).
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const doc = new PDFDocument({
    compress: options.compress ?? true,
    size: 'A4',
    margin: PAGE.margin,
    info: { Title: `Billet ${ticket.reference}`, Author: 'Gatio' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = PAGE.margin;
  const width = PAGE.width - 2 * PAGE.margin;

  // En-tête : logo et numéro du billet, trait épais.
  doc.save().translate(left, 50).scale(1.4).path(TICKET_ICON).lineWidth(2).stroke(INK).restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(28)
    .fillColor(INK)
    .text('Gatio', left + 42, 48);
  doc
    .fontSize(12)
    .text(`BILLET ${ticket.index} SUR ${ticket.count}`, left, 60, { width, align: 'right' });
  doc
    .moveTo(left, 96)
    .lineTo(left + width, 96)
    .lineWidth(3)
    .stroke(INK);

  let top = 120;
  if (ticket.cancelled) {
    doc.rect(left, 110, width, 44).fill(INK);
    doc
      .font('Helvetica-Bold')
      .fontSize(22)
      .fillColor('#ffffff')
      .text('ÉVÉNEMENT ANNULÉ', left, 121, { width, align: 'center', lineBreak: false });
    doc.fillColor(INK);
    top = 172;
  }

  // Événement.
  // Titre long : police réduite pour garder la place du QR code.
  doc.font('Helvetica-Bold');
  const titleSize =
    [32, 26, 22].find(
      (size) =>
        doc.fontSize(size).heightOfString(oneLine(ticket.eventTitle), { width }) <= 3.6 * size,
    ) ?? 18;
  doc.fontSize(titleSize).text(oneLine(ticket.eventTitle), left, top, { width });
  doc.moveDown(0.3);
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(ticket.postponed ? 'Date à confirmer' : formatDateTime(ticket.startsAt), { width });
  doc
    .font('Helvetica')
    .fontSize(18)
    .text(oneLine(`${ticket.venue}, ${ticket.city}`), { width });

  // Catégorie et prix dans deux cadres.
  const boxTop = doc.y + 20;
  const boxWidth = (width - 16) / 2;
  for (const [i, [label, value]] of [
    ['CATÉGORIE', oneLine(ticket.categoryName)],
    ['PRIX', formatMoney(ticket.price)],
  ].entries()) {
    const x = left + i * (boxWidth + 16);
    doc.roundedRect(x, boxTop, boxWidth, 72, 8).lineWidth(2).stroke(INK);
    doc
      .font('Helvetica')
      .fontSize(11)
      .text(label!, x + 12, boxTop + 12, { width: boxWidth - 24 });
    doc.font('Helvetica-Bold');
    doc.fontSize(fitOnOneLine(doc, value!, boxWidth - 24, 20, 12));
    doc.text(shorten(doc, value!, boxWidth - 24), x + 12, boxTop + 32, { lineBreak: false });
  }

  // QR code en vecteurs (net à l'impression), avec sa marge blanche de 4 modules.
  const qr = QRCode.create(ticket.qr, { errorCorrectionLevel: 'M' });
  const modules = qr.modules.size;
  // QR aussi grand que la place le permet, entre 200 et 300 points.
  const footer = PAGE.height - PAGE.margin - 28;
  const qrSize = Math.max(200, Math.min(300, footer - (boxTop + 92) - 50));
  const cell = qrSize / (modules + 8);
  const qrLeft = left + (width - qrSize) / 2;
  const qrTop = boxTop + 92;
  doc.rect(qrLeft, qrTop, qrSize, qrSize).fill('#ffffff');
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.modules.get(row, col)) {
        doc.rect(qrLeft + (col + 4) * cell, qrTop + (row + 4) * cell, cell, cell);
      }
    }
  }
  doc.fill(INK);

  doc
    .font('Helvetica')
    .fontSize(14)
    .fillColor(INK)
    .text(
      'Présentez ce QR code à l’entrée, sur papier ou sur votre téléphone.',
      left,
      qrTop + qrSize + 16,
      { width, align: 'center' },
    );

  // Pied de page : référence et rappel.
  doc
    .moveTo(left, footer)
    .lineTo(left + width, footer)
    .lineWidth(1)
    .stroke(INK);
  doc.fontSize(11).text(`Référence de commande : ${ticket.reference}`, left, footer + 10, {
    width,
    lineBreak: false,
  });
  doc.text('Un billet = une seule entrée', left, footer + 10, {
    width,
    align: 'right',
    lineBreak: false,
  });

  doc.end();
  return done;
}

// Plus grande taille de police (entre max et min) qui tient sur une ligne.
function fitOnOneLine(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  max: number,
  min: number,
) {
  for (let size = max; size > min; size -= 1) {
    if (doc.fontSize(size).widthOfString(text) <= width) return size;
  }
  return min;
}

// Texte coupé avec « … » s'il dépasse encore à la plus petite taille.
function shorten(doc: PDFKit.PDFDocument, text: string, width: number) {
  if (doc.widthOfString(text) <= width) return text;
  let cut = text;
  while (cut.length > 1 && doc.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}
