// The stored match keys of likely duplicates (spec 0049, AC-4902): written with
// each value row (`values.ts`), and written again here for every current value
// of an attribute whose kind changed, when a custom object is named by another
// attribute (late trap #15). The keys are always `crm_match_key` over
// `crm_match_kind`, both in SQL (migration 0145), so nothing here normalises.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';

/**
 * Writes the match key of every current item of `attributeId` again, by the kind the attribute has now: null on
 * a former name attribute that is no email or domain, the name key on a new one. One statement, under the write's
 * own transaction, found through `values_text` (it leads with the attribute).
 */
export async function rekeyMatches(tx: WorkspaceTx, attributeId: string): Promise<void> {
  await tx.execute(sql`
    update "values" v set match_key = crm_match_key(k.kind, v.text_value)
    from (select crm_match_kind(${attributeId}::uuid) as kind) k
    where v.attribute_id = ${attributeId}::uuid and v.active_until is null and v.record_id is not null
      and v.text_value is not null and v.match_key is distinct from crm_match_key(k.kind, v.text_value)
  `);
}
