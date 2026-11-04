import { randomUUID } from 'node:crypto';

// Port Versement (conception §3.11) : envoyer l'argent d'une vente à l'organisateur. Le
// reste du programme ne connaît aucun prestataire. Le prestataire réel arrive en tranche 16.
export type PayoutResult =
  | { status: 'sent'; providerRef: string }
  // Refus définitif (numéro invalide, compte fermé) : inutile de réessayer tel quel.
  | { status: 'failed'; reason: string };

export type PayoutPort = {
  name: string;
  // La clé (identifiant du versement) rend l'envoi rejouable : un second appel avec la même
  // clé renvoie le résultat du premier, sans second transfert. Une erreur levée (réseau,
  // prestataire indisponible) laisse l'issue inconnue : l'envoi sera repris avec la même clé.
  send(input: {
    key: string;
    amount: number;
    currency: string;
    method: string;
    destination: string;
  }): Promise<PayoutResult>;
};

// Faux versement (développement et tests) : rien ne part. Un numéro qui finit par « 00 » est
// refusé, pour voir un échec à l'écran (O9) ; `unavailable` simule une panne passagère.
export function fakePayoutProvider() {
  const transfers = new Map<string, PayoutResult & { amount: number; destination: string }>();
  const provider = {
    name: 'fake',
    transfers,
    unavailable: false,
    async send(input: { key: string; amount: number; destination: string }) {
      if (provider.unavailable) throw new Error('faux versement indisponible');
      const known = transfers.get(input.key);
      if (known)
        return known.status === 'sent'
          ? { status: 'sent' as const, providerRef: known.providerRef }
          : { status: 'failed' as const, reason: known.reason };
      const result: PayoutResult = input.destination.endsWith('00')
        ? { status: 'failed', reason: 'invalid_destination' }
        : { status: 'sent', providerRef: `fake-payout-${randomUUID()}` };
      transfers.set(input.key, { ...result, amount: input.amount, destination: input.destination });
      return result;
    },
  };
  return provider satisfies PayoutPort;
}

export type FakePayoutProvider = ReturnType<typeof fakePayoutProvider>;
