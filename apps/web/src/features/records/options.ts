// Create an option from a form (the field polish pass, 30 Oct 2026): New
// record, a board column's New record and Bulk edit offer "Create "<typed>""
// in a select or status, as a table cell does, for people who may shape the
// schema. The option is made through the data layer (server confirmed, the
// hue the next one), and its id handed back for the form to set.
import { isDataError } from '@crm/data';
import { useRouteContext } from '@tanstack/react-router';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { strings } from './strings.ts';

/**
 * Makes an option on one of `objectId`'s select or status attributes from what was typed, and answers its id
 * (undefined on a refusal, which a toast says). Undefined for someone who may not change the schema.
 */
export function useOptionMaker(
  slug: string,
  objectId: string,
): ((attributeId: string, label: string) => Promise<string | undefined>) | undefined {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const canChangeSchema = useCan('schema.manage');
  if (!canChangeSchema) return undefined;
  return async (attributeId, label) => {
    try {
      const option = await data.options.create(slug, objectId, attributeId, {
        id: data.attributes.newId(),
        label: label.trim(),
      });
      return option.id;
    } catch (error) {
      toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.optionNotMade });
      return undefined;
    }
  };
}
