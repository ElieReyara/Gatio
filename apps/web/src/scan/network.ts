import { errorResponseSchema, scanPassagesResponseSchema } from '@gatio/shared';
import { listPassages, loadManifest, removePassages, type LocalPassage } from './storage';
import { nextBatch, toWire } from './sync';

// Appels de la page de scan : délai maximal, pour qu'un réseau qui ne répond plus sans
// couper ne bloque pas la synchronisation pendant des minutes.
const SCAN_TIMEOUT_MS = 10_000;

export type ScanResponse =
  { ok: true; data: unknown } | { ok: false; status: number; reason: unknown };

export async function scanRequest(path: string, body?: unknown): Promise<ScanResponse> {
  try {
    const response = await fetch(`/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) return { ok: true, data: payload };
    const error = errorResponseSchema.safeParse(payload);
    return {
      ok: false,
      status: response.status,
      reason: error.success ? error.data.error.details.reason : undefined,
    };
  } catch {
    return { ok: false, status: 0, reason: undefined };
  }
}

// Envoi d'un lot ; réponse du serveur, ou null (réseau, session coupée).
export async function sendPassages(batch: LocalPassage[]) {
  const response = await scanRequest('/scan/passages', { passages: batch.map(toWire) });
  const parsed = response.ok ? scanPassagesResponseSchema.safeParse(response.data) : null;
  return parsed?.success ? parsed.data.results : null;
}

// Avant d'ouvrir une autre session sur ce téléphone (autre lien, « scanner moi-même »), les
// passages en attente partent avec la session actuelle : après, ils ne pourraient plus.
export async function flushPendingPassages(): Promise<void> {
  if (!navigator.onLine) return;
  const stored = await loadManifest().catch(() => null);
  if (!stored) return;
  for (let round = 0; round < 200; round++) {
    const queue = await listPassages().catch(() => [] as LocalPassage[]);
    const { batch, invalid } = nextBatch(queue, stored.eventId);
    if (invalid.length > 0) await removePassages(invalid).catch(() => undefined);
    if (batch.length === 0) return;
    const results = await sendPassages(batch);
    if (!results) return;
    await removePassages(results.map((result) => result.id)).catch(() => undefined);
  }
}
