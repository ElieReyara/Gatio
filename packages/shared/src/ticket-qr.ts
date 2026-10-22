// Format du QR code d'un billet (cahier de conception §3.6) :
// version (1 octet) + identifiant de clé (1) + billet (16) + événement (16) + catégorie (16)
// = 50 octets signés, suivis de la signature Ed25519 (64 octets), encodés en base64url.
// Aucune donnée personnelle. Sans dépendance : utilisé par l'API et par la page de scan.

export const TICKET_QR_VERSION = 1;
export const TICKET_QR_SIGNED_LENGTH = 50;
export const TICKET_QR_SIGNATURE_LENGTH = 64;
const TOTAL_LENGTH = TICKET_QR_SIGNED_LENGTH + TICKET_QR_SIGNATURE_LENGTH;

export type TicketQrPayload = {
  keyId: number;
  ticketId: string;
  eventId: string;
  categoryId: string;
};

export type ParsedTicketQr = TicketQrPayload & {
  version: number;
  signed: Uint8Array;
  signature: Uint8Array;
};

export function encodeTicketQrSignedPart(payload: TicketQrPayload): Uint8Array {
  if (!Number.isInteger(payload.keyId) || payload.keyId < 0 || payload.keyId > 255) {
    throw new Error('keyId must be an integer between 0 and 255');
  }
  const bytes = new Uint8Array(TICKET_QR_SIGNED_LENGTH);
  bytes[0] = TICKET_QR_VERSION;
  bytes[1] = payload.keyId;
  bytes.set(uuidToBytes(payload.ticketId), 2);
  bytes.set(uuidToBytes(payload.eventId), 18);
  bytes.set(uuidToBytes(payload.categoryId), 34);
  return bytes;
}

export function assembleTicketQr(signed: Uint8Array, signature: Uint8Array): string {
  if (
    signed.length !== TICKET_QR_SIGNED_LENGTH ||
    signature.length !== TICKET_QR_SIGNATURE_LENGTH
  ) {
    throw new Error('invalid ticket QR part lengths');
  }
  const bytes = new Uint8Array(TOTAL_LENGTH);
  bytes.set(signed, 0);
  bytes.set(signature, TICKET_QR_SIGNED_LENGTH);
  return toBase64Url(bytes);
}

// Lecture seule de la structure : la signature est vérifiée par l'appelant.
export function parseTicketQr(text: string): ParsedTicketQr | null {
  const bytes = fromBase64Url(text.trim());
  if (!bytes || bytes.length !== TOTAL_LENGTH || bytes[0] !== TICKET_QR_VERSION) return null;
  return {
    version: bytes[0],
    keyId: bytes[1] as number,
    ticketId: bytesToUuid(bytes.subarray(2, 18)),
    eventId: bytesToUuid(bytes.subarray(18, 34)),
    categoryId: bytesToUuid(bytes.subarray(34, 50)),
    signed: bytes.slice(0, TICKET_QR_SIGNED_LENGTH),
    signature: bytes.slice(TICKET_QR_SIGNED_LENGTH),
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidToBytes(uuid: string): Uint8Array {
  if (!uuidPattern.test(uuid)) throw new Error('invalid UUID');
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
