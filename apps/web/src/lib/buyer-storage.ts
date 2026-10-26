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

// Paramètres après le « # » d'un lien d'email : jamais envoyés au serveur ni gardés dans
// ses journaux. « t » : jeton ; « b » : numéro du billet à afficher.
export function readLinkParams(): { token: string | null; ticket: number | null } {
  // Rendu préalable côté serveur : pas d'adresse à lire.
  if (typeof window === 'undefined') return { token: null, ticket: null };
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = params.get('t');
  const ticket = Number(params.get('b'));
  return {
    token: token && /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null,
    ticket: Number.isInteger(ticket) && ticket > 0 ? ticket : null,
  };
}

// Le lien (même abîmé par une messagerie) est retiré de l'adresse affichée.
export function clearLinkParams() {
  if (window.location.hash.includes('t=')) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

// Téléchargement du PDF avec le jeton en en-tête (pas dans l'adresse).
export async function downloadTicketPdf(orderId: string, ticketId: string, filename: string) {
  const token = orderToken(orderId);
  if (!token) return false;
  try {
    const response = await fetch(`/api/v1/orders/${orderId}/tickets/${ticketId}/pdf`, {
      headers: { 'x-order-token': token },
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch {
    return false;
  }
}

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

// « payment_confirmed » est écrit par le serveur au moment de la confirmation.
type FunnelType = 'event_view' | 'checkout_started' | 'payment_initiated';

export function trackFunnel(type: FunnelType, eventSlug: string, orderId?: string) {
  void fetch('/api/v1/funnel-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, eventSlug, anonSessionId: anonSessionId(), orderId }),
    keepalive: true,
  }).catch(() => undefined);
}
