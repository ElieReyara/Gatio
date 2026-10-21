import { healthResponseSchema, type HealthResponse } from '@gatio/shared';

// Le web ne décide de rien : il lit l'API côté serveur (instructions générales, règle 2).
const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

export async function fetchHealth(): Promise<HealthResponse | null> {
  try {
    const response = await fetch(`${apiUrl}/api/v1/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return healthResponseSchema.parse(await response.json());
  } catch {
    return null;
  }
}
