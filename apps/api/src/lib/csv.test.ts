import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv.js';

const unquote = (cell: string) => cell.slice(1, -1).replace(/""/g, '"');

describe('export CSV (S4)', () => {
  it.each(['=HYPERLINK("https://exemple.com")', '+33 6 12', '-1+1', '@SUM(A1)', '\t=1', '\r=1'])(
    'neutralise une formule « %s »',
    (value) => {
      expect(unquote(csvCell(value)).startsWith("'")).toBe(true);
    },
  );

  it.each(['Ali,=1+2,', 'Ali\t=1+2', "Ali,=cmd|' /C calc'!A0,"])(
    'garde « %s » en une seule cellule, quel que soit le séparateur choisi',
    (value) => {
      const cell = csvCell(value);
      expect(cell.startsWith('"') && cell.endsWith('"')).toBe(true);
      expect(unquote(cell)).toBe(value);
    },
  );

  it('met tout texte entre guillemets ; laisse les nombres tels quels', () => {
    expect(csvCell('Mahamat Idriss')).toBe('"Mahamat Idriss"');
    expect(csvCell('Ali; Moussa')).toBe('"Ali; Moussa"');
    expect(csvCell('Le "Grand" Ali')).toBe('"Le ""Grand"" Ali"');
    expect(csvCell('ligne\nsuivante')).toBe('"ligne\nsuivante"');
    expect(csvCell(-5000)).toBe('-5000');
    expect(csvCell(null)).toBe('');
  });

  it('commence par le BOM UTF-8, sépare par « ; », finit les lignes par CRLF', () => {
    expect(
      toCsv([
        ['Nom', 'Montant'],
        ['Fatimé', 5000],
      ]),
    ).toBe('\uFEFF"Nom";"Montant"\r\n"Fatimé";5000\r\n');
  });
});
