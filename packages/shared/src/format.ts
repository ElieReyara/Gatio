// Montants et dates selon le système de design : « 15 000 FCFA » (espace insécable),
// « samedi 14 novembre, 19 h ». Heure du Tchad (UTC+1, sans heure d'été).
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
