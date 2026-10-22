import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { apiUrl } from './api';

type Schema<T> = { parse(data: unknown): T };

// Lecture de l'API par les pages du site, avec la session de l'organisateur.
// Sans session valide : retour à la connexion ; ressource d'un autre : page introuvable.
export async function getAsOrganizer<T>(path: string, schema: Schema<T>): Promise<T> {
  const session = (await cookies()).get('gatio_session')?.value;
  if (!session) redirect('/organisateur/connexion');
  const response = await fetch(`${apiUrl()}/api/v1${path}`, {
    headers: { cookie: `gatio_session=${session}` },
    cache: 'no-store',
  });
  if (response.status === 401) redirect('/organisateur/connexion');
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error(`API ${path}: ${response.status}`);
  return schema.parse(await response.json());
}
