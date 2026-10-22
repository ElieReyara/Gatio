import type { ScanManifest } from '@gatio/shared';

// IndexedDB : seul stockage fiable pour des milliers d'entrées hors ligne (conception §3.7).
// Les passages restent ici jusqu'à leur envoi au serveur (tranche 10).

export type LocalResult = 'valid' | 'already_used' | 'void' | 'invalid';

export type LocalPassage = {
  id: string;
  ticketId: string | null;
  scannedAt: string;
  localResult: LocalResult;
  verifyMs: number;
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
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(store, mode).objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
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
