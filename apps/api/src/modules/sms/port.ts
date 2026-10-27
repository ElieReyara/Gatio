import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config.js';
import { maskPhone } from '../../lib/redact.js';

// Port Message (conception §3.11) : le programme ne dépend d'aucun service d'envoi de SMS.
export type SmsMessage = { to: string; text: string };
export type SmsPort = {
  name: string;
  send(message: SmsMessage): Promise<{ providerRef: string | null }>;
};

// Développement : le SMS s'affiche dans la console de l'API, numéro masqué. Refusé en
// production (le texte contient le code).
export function consoleSms(log: Pick<FastifyBaseLogger, 'warn'>): SmsPort {
  return {
    name: 'console',
    async send({ to, text }) {
      log.warn(`SMS (console, non envoyé) pour ${maskPhone(to)} : ${text}`);
      return { providerRef: null };
    },
  };
}

// Tests : messages gardés en mémoire.
export function memorySms() {
  const sent: SmsMessage[] = [];
  const port: SmsPort & { sent: SmsMessage[]; failing: boolean } = {
    name: 'memory',
    sent,
    failing: false,
    async send(message) {
      if (port.failing) throw new Error('sms indisponible');
      sent.push(message);
      return { providerRef: `memory-${sent.length}` };
    },
  };
  return port;
}

// Essai sur un vrai téléphone (roadmap, tranche 8) : application libre « SMS Gateway for
// Android » (github.com/capcom6/android-sms-gateway), mode serveur local
// (http://<adresse du téléphone>:8080/message) ou nuage, authentification Basic.
export function androidGatewaySms(gateway: {
  url: string;
  login: string;
  password: string;
}): SmsPort {
  const authorization = `Basic ${Buffer.from(`${gateway.login}:${gateway.password}`).toString('base64')}`;
  return {
    name: 'android-gateway',
    async send({ to, text }) {
      const response = await fetch(gateway.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization },
        body: JSON.stringify({ textMessage: { text }, phoneNumbers: [to] }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`sms gateway refused: ${response.status}`);
      const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
      return { providerRef: typeof body?.id === 'string' ? body.id : null };
    },
  };
}

// Adaptateur choisi par la configuration. En production, la console écrirait les codes dans
// les journaux et la passerelle Android n'est qu'un outil d'essai (HTTP Basic sur le réseau
// local) : refusés tous deux, en attendant un prestataire réel (tranche 16).
export function smsPortFor(
  config: Pick<Config, 'nodeEnv' | 'smsGateway'>,
  log: Pick<FastifyBaseLogger, 'warn'>,
): SmsPort {
  if (config.nodeEnv === 'production') {
    throw new Error('Aucun prestataire SMS réel configuré (tranche 16)');
  }
  return config.smsGateway ? androidGatewaySms(config.smsGateway) : consoleSms(log);
}
