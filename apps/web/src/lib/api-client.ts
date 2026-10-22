import { errorResponseSchema, type ErrorResponse } from '@gatio/shared';

// Appels de l'API depuis le navigateur, par le relais /api/v1 du site (même origine).
export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; status: number; error: ErrorResponse['error'] | null };

export async function postJson<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`/api/v1${path}`, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload: unknown =
      response.status === 204 ? null : await response.json().catch(() => null);
    if (response.ok) return { ok: true, data: payload as T };
    const parsed = errorResponseSchema.safeParse(payload);
    return { ok: false, status: response.status, error: parsed.success ? parsed.data.error : null };
  } catch {
    return { ok: false, status: 0, error: null };
  }
}
