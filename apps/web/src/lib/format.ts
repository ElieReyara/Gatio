import { formatDateTime } from '@gatio/shared';

// Montants et dates : formatés dans le paquet partagé, pour que le PDF et les emails du
// serveur écrivent exactement la même chose que le site. Heure du Tchad (UTC+1).
export { formatDateTime, formatMoney, formatNumber, formatPercent } from '@gatio/shared';
const CHAD_OFFSET = '+01:00';

// « samedi 14 novembre à 8 h » (maquette B2 : ouverture d'une catégorie).
export function formatOpening(iso: string): string {
  const text = formatDateTime(iso).replace(', ', ' à ');
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// Champ « datetime-local » : la saisie est l'heure du Tchad, quel que soit le réglage du téléphone.
export function toChadInput(iso: string | null): string {
  if (!iso) return '';
  const chad = new Date(new Date(iso).getTime() + 60 * 60 * 1000);
  return chad.toISOString().slice(0, 16);
}

export function fromChadInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return new Date(`${value}:00${CHAD_OFFSET}`).toISOString();
}

export function parseAmount(value: string): number | null {
  const digits = value.replace(/[\s  .]/g, '');
  return /^\d{1,9}$/.test(digits) ? Number(digits) : null;
}

// « +235 66 12 34 56 » (maquette B4).
export function formatPhone(e164: string): string {
  const match = /^\+235(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  return match ? `+235 ${match.slice(1).join(' ')}` : e164;
}
