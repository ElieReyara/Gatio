import { errorResponseSchema, type ErrorResponse } from '@gatio/shared';

// Appels de l'API depuis le navigateur, par le relais /api/v1 du site (même origine).
export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; status: number; error: ErrorResponse['error'] | null };

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function sendJson<T>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  return send<T>(
    method,
    path,
    body === undefined ? undefined : JSON.stringify(body),
    'application/json',
  );
}

export function postJson<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  return sendJson<T>('POST', path, body);
}

// Image envoyée telle quelle, avec son type (pas de multipart).
export function uploadImage<T>(path: string, file: File): Promise<ApiResult<T>> {
  return send<T>('POST', path, file, file.type || 'application/octet-stream');
}

async function send<T>(
  method: Method,
  path: string,
  body: BodyInit | undefined,
  contentType: string,
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`/api/v1${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': contentType },
      body,
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
