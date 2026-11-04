// Export CSV pour un tableur (Excel en français) : séparateur « ; », UTF-8 avec BOM pour les
// accents, fins de ligne CRLF. S4 : une cellule qui commence par =, +, -, @ (ou une
// tabulation, un retour) serait lue comme une formule : elle est neutralisée par une
// apostrophe en tête. Tout texte est mis entre guillemets : un fichier ouvert avec un autre
// séparateur (virgule, tabulation) ne coupe pas une cellule en deux, d'où pourrait sortir une
// formule (« Ali,=1+2 »).
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Array<Array<string | number | null>>): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
