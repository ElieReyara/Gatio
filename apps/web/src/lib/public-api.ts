import { apiUrl } from './api';

type Schema<T> = { parse(data: unknown): T };

// Lecture publique de l'API par les pages du site (sans session). « null » = introuvable.
export async function getPublic<T>(path: string, schema: Schema<T>): Promise<T | null> {
  const response = await fetch(`${apiUrl()}/api/v1${path}`, { cache: 'no-store' });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) throw new Error(`API ${path}: ${response.status}`);
  return schema.parse(await response.json());
}
