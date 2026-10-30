// Create an option from a form (the field polish pass, 30 Oct 2026): New
// record, a board column's New record and Bulk edit offer "Create "<typed>""
// in a select or status, as a table cell does, for people who may shape the
// schema. The option is made through the data layer optimistically: its id is
// answered at once for the form to set, its label shows from the layer's
// pending options, and a refusal says why and hands the id back to drop.
import { isDataError } from '@crm/data';
import { useRouteContext } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { strings } from './strings.ts';

/** Makes an option and answers its id at once; `onRefused` gets the id back if the server refuses it. */
export type OptionMaker = (
  attributeId: string,
  label: string,
  onRefused: (optionId: string) => void,
) => string | undefined;

/**
 * Makes an option on one of `objectId`'s select or status attributes from what was typed, answering its id at once
 * (undefined for an empty label). A refusal is toasted and handed to `onRefused`, for the form to drop the id.
 * Undefined for someone who may not change the schema. Stable across renders while its inputs are.
 */
export function useOptionMaker(slug: string, objectId: string): OptionMaker | undefined {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const canChangeSchema = useCan('schema.manage');
  const make = useCallback<OptionMaker>(
    (attributeId, label, onRefused) => {
      const making = data.options.make(slug, objectId, attributeId, label);
      if (making === undefined) return undefined;
      making.made.catch((error: unknown) => {
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.optionNotMade });
        onRefused(making.id);
      });
      return making.id;
    },
    [data, toasts, slug, objectId],
  );
  return canChangeSchema ? make : undefined;
}
