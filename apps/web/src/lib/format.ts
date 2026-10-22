// Montants et dates selon le système de design : « 15 000 FCFA » (espace insécable),
// « samedi 14 novembre, 19 h ». Heure du Tchad (UTC+1, sans heure d'été).
const CHAD_OFFSET = '+01:00';
const CHAD_TIME_ZONE = 'Africa/Ndjamena';

export function formatMoney(amount: number): string {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
}

export function formatNumber(amount: number): string {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatPercent(bps: number): string {
  return `${String(bps / 100).replace('.', ',')} %`;
}

export function formatDateTime(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: CHAD_TIME_ZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  const minutes = parts.minute === '00' ? '' : ` ${parts.minute}`;
  const weekday = `${parts.weekday?.charAt(0).toUpperCase()}${parts.weekday?.slice(1)}`;
  return `${weekday} ${parts.day} ${parts.month}, ${Number(parts.hour)} h${minutes}`;
}

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
