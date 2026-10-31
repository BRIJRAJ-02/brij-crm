// Adding one record to a list from outside the Lists section (the command menu, spec 0048, AC-4827), through the data
// layer: the same rules as the record page's menu, said in the same words.
import type { AttributeDefinition, DataLayer, ListView } from '@crm/data';
import type { Toasts } from '@crm/ui';
import { strings } from './strings.ts';

/**
 * Adds the record to the list at once and says so in a Toast. A list with a required field of its own needs a value
 * first, which only the record page's Add to list can ask for, so it says that instead of adding.
 */
export async function addRecordToList(
  data: DataLayer,
  toasts: Toasts,
  slug: string,
  list: ListView,
  record: { readonly recordId: string; readonly name: string },
): Promise<void> {
  const fields = await data.lists.fields(slug, list).catch(() => [] as readonly AttributeDefinition[]);
  if (fields.some((field) => field.isRequired && !field.isSystem && !field.isArchived)) {
    toasts.toast({ tone: 'info', message: strings.needsValues(list.name) });
    return;
  }
  const layer = await data.lists.entries();
  const outcome = await layer.add(slug, list, record.recordId);
  toasts.toast(
    outcome.kind === 'added'
      ? { tone: 'success', message: strings.added(record.name, list.name) }
      : { tone: 'danger', message: outcome.message },
  );
}
