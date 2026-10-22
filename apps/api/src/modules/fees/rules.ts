import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { feeRules } from '../../db/schema.js';
import type { PercentFixedParams } from './compute.js';

// R4 : règles actives à la date dont la portée concerne la catégorie ; la plus précise
// l'emporte (catégorie > événement > organisateur > plateforme) ; à égalité, la plus récente.
export type FeeTarget = { organizerId: string; eventId?: string; categoryId?: string };
export type AppliedRule = { id: string; currency: string; params: PercentFixedParams };

const precision = sql<number>`case ${feeRules.scope}
  when 'category' then 4 when 'event' then 3 when 'organizer' then 2 else 1 end`;

export async function resolveFeeRule(db: DbOrTx, target: FeeTarget): Promise<AppliedRule> {
  const scopes = [
    eq(feeRules.scope, 'platform'),
    and(eq(feeRules.scope, 'organizer'), eq(feeRules.scopeId, target.organizerId)),
    ...(target.eventId
      ? [and(eq(feeRules.scope, 'event'), eq(feeRules.scopeId, target.eventId))]
      : []),
    ...(target.categoryId
      ? [and(eq(feeRules.scope, 'category'), eq(feeRules.scopeId, target.categoryId))]
      : []),
  ];
  const [rule] = await db
    .select({
      id: feeRules.id,
      calcType: feeRules.calcType,
      params: feeRules.params,
      currency: feeRules.currency,
    })
    .from(feeRules)
    .where(
      and(
        eq(feeRules.isActive, true),
        lte(feeRules.validFrom, sql`now()`),
        or(isNull(feeRules.validTo), gt(feeRules.validTo, sql`now()`)),
        or(...scopes),
      ),
    )
    .orderBy(desc(precision), desc(feeRules.validFrom), desc(feeRules.createdAt))
    .limit(1);
  if (!rule) throw new Error('no active fee rule');
  // Un seul type de calcul construit au lancement (§9) ; les paliers existent dans la structure.
  if (rule.calcType !== 'percent_fixed')
    throw new Error(`fee calc type not built: ${rule.calcType}`);
  const params = rule.params as { percent_bps: number; fixed_amount: number };
  return {
    id: rule.id,
    currency: rule.currency,
    params: { percentBps: params.percent_bps, fixedAmount: params.fixed_amount },
  };
}
