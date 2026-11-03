import type { ScanManifest } from '@gatio/shared';

// IndexedDB : seul stockage fiable pour des milliers d'entrées hors ligne (conception §3.7).
// Les passages restent ici jusqu'à leur envoi au serveur.

export type LocalResult = 'valid' | 'already_used' | 'void' | 'invalid';

export type LocalPassage = {
  id: string;
  // Événement de la liste au moment du scan : seuls ceux de la liste en cours partent.
  eventId: string;
  ticketId: string | null;
  scannedAt: string;
  localResult: LocalResult;
  verifyMs: number;
  // QR lu (sans donnée personnelle), dont le serveur vérifie la signature.
  qr: string | null;
};

const DB_NAME = 'gatio-scan';
const MANIFEST = 'manifest';
const PASSAGES = 'passages';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(MANIFEST);
      request.result.createObjectStore(PASSAGES, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    // Réussite seulement quand la transaction est validée (un quota plein l'annule après coup).
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = action(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? request.error);
      transaction.onerror = () => reject(transaction.error ?? request.error);
    });
  } finally {
    db.close();
  }
}

export function saveManifest(manifest: ScanManifest): Promise<IDBValidKey> {
  return run(MANIFEST, 'readwrite', (store) => store.put(manifest, 'current'));
}

export async function loadManifest(): Promise<ScanManifest | null> {
  return (
    (await run<ScanManifest | undefined>(MANIFEST, 'readonly', (store) => store.get('current'))) ??
    null
  );
}

export function addPassage(passage: LocalPassage): Promise<IDBValidKey> {
  return run(PASSAGES, 'readwrite', (store) => store.add(passage));
}

export function listPassages(): Promise<LocalPassage[]> {
  return run<LocalPassage[]>(PASSAGES, 'readonly', (store) => store.getAll());
}

// Passages reçus par le serveur (réponse de POST /scan/passages) : retirés de la file.
export async function removePassages(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(PASSAGES, 'readwrite');
      const store = transaction.objectStore(PASSAGES);
      for (const id of ids) store.delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

// Nouvel événement sur ce téléphone : la file de l'ancien ne peut plus être envoyée.
export function clearPassages(): Promise<undefined> {
  return run(PASSAGES, 'readwrite', (store) => store.clear());
}
