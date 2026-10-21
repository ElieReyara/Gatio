// Aucun téléphone ni email en clair dans les journaux (instructions générales, règle 9).

// 8 à 15 chiffres, éventuellement séparés par des espaces ou des points ; jamais
// collés à une lettre ou un tiret, pour laisser intacts UUID, dates et références.
const phonePattern = /(?<![\w-])\+?\d(?:[ .]?\d){7,14}(?![\w-])/g;
const emailPattern = /[^\s@/?&=:"'()]+@[^\s@/?&=:"'()]+\.[^\s@/?&=:"'()]+/g;

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '••';
  return `${phone.startsWith('+') ? '+' : ''}${digits.slice(0, 3)}••••${digits.slice(-2)}`;
}

export function maskPersonalData(text: string): string {
  return safeDecode(text)
    .replace(emailPattern, '[email masqué]')
    .replace(phonePattern, (match) => maskPhone(match));
}

// Le sérialiseur standard de pino copie toutes les propriétés d'une erreur, dont
// `detail` des erreurs PostgreSQL (« Key (email)=(…) already exists ») : on ne
// garde que l'utile, masqué.
export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: maskPersonalData(String(error)), stack: '' };
  }
  const code = (error as { code?: unknown }).code;
  return {
    type: error.constructor.name,
    message: maskPersonalData(error.message),
    stack: maskPersonalData(error.stack ?? ''),
    ...(typeof code === 'string' ? { code } : {}),
  };
}

type SerializedError = { [key: string]: unknown; type: string; message: string; stack: string };

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
