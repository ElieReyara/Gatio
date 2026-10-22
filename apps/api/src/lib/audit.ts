import type { DbOrTx } from '../db/client.js';
import { auditLog } from '../db/schema.js';

// S6 : chaque action sensible laisse une trace (qui, quoi, avant, après, d'où).
export async function writeAudit(
  db: DbOrTx,
  entry: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    before: unknown;
    after: unknown;
    ip: string;
  },
) {
  await db.insert(auditLog).values(entry);
}
