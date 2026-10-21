// Aucun téléphone ni email en clair dans les journaux (instructions générales, règle 9).

const phonePattern = /\+?\d[\d .-]{6,}\d/g;
const emailPattern = /[^\s@/?&=]+@[^\s@/?&=]+\.[^\s@/?&=]+/g;

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '••';
  return `${phone.startsWith('+') ? '+' : ''}${digits.slice(0, 3)}••••${digits.slice(-2)}`;
}

export function maskPersonalData(text: string): string {
  const decoded = safeDecode(text);
  return decoded
    .replace(emailPattern, '[email masqué]')
    .replace(phonePattern, (match) => maskPhone(match));
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
