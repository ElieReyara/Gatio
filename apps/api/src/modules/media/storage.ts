import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

// Port Stockage (conception §3.11) : disque en développement, stockage S3 en production.
export type StoragePort = {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
};

export function diskStorage(root: string): StoragePort {
  const base = resolve(root);
  const pathOf = (key: string) => {
    const path = resolve(join(base, key));
    // Une clé ne sort jamais du dossier de stockage.
    if (!path.startsWith(base + sep)) throw new Error('invalid storage key');
    return path;
  };
  return {
    async put(key, data) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    async get(key) {
      try {
        return await readFile(pathOf(key));
      } catch {
        return null;
      }
    },
  };
}

export function memoryStorage(): StoragePort & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async put(key, data) {
      files.set(key, data);
    },
    async get(key) {
      return files.get(key) ?? null;
    },
  };
}
