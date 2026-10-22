// Le web ne décide de rien : il lit l'API côté serveur (instructions générales, règle 2).
export function apiUrl(): string {
  const url = process.env.API_URL;
  if (url) return url;
  if (process.env.NODE_ENV === 'production') throw new Error('Configuration manquante : API_URL');
  return 'http://127.0.0.1:4000';
}
