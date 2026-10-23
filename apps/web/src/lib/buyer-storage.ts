// Données gardées dans le navigateur de l'acheteur. Le stockage peut être refusé (navigation
// privée) : une copie en mémoire suffit alors pour la visite en cours.
const memory = new Map<string, string>();

function read(storage: 'local' | 'session', key: string): string | null {
  try {
    const value = (storage === 'local' ? localStorage : sessionStorage).getItem(key);
    if (value !== null) return value;
  } catch {
    /* stockage refusé */
  }
  return memory.get(key) ?? null;
}

function write(storage: 'local' | 'session', key: string, value: string) {
  memory.set(key, value);
  try {
    (storage === 'local' ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    /* stockage refusé */
  }
}

// Jeton de commande (conception §3.5) : rend la commande lisible depuis ce téléphone.
export const saveOrderToken = (orderId: string, token: string) =>
  write('local', `gatio_order_${orderId}`, token);
export const orderToken = (orderId: string) => read('local', `gatio_order_${orderId}`);

export function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Mesures du parcours (§8) : identifiant de session anonyme, aucune donnée personnelle.
function anonSessionId(): string {
  const existing = read('session', 'gatio_anon');
  if (existing) return existing;
  const created = randomKey();
  write('session', 'gatio_anon', created);
  return created;
}

export function trackFunnel(type: 'event_view' | 'checkout_started', eventSlug: string) {
  void fetch('/api/v1/funnel-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, eventSlug, anonSessionId: anonSessionId() }),
    keepalive: true,
  }).catch(() => undefined);
}
