// A settings write's failure as a Form's refusals (spec 0012): each refusal
// that names a field of the form (`field`, from the engine, or an input
// issue's path) lands on that field, in the words the screen chooses; anything
// else shows in the form's banner.
import { isDataError, type ApiRefusal } from '@crm/data';
import type { FormRefusal } from '@crm/ui';
import { strings } from './strings.ts';

/** The form's refusals for a failed write: on the fields in `fields`, else above them. */
export function formRefusals(
  error: unknown,
  fields: readonly string[],
  wordsFor: (refusal: ApiRefusal) => string = (refusal) => refusal.message,
): readonly FormRefusal[] {
  if (!isDataError(error)) return [{ code: 'INTERNAL', message: strings.somethingWrong }];
  const onField = (field: string | undefined) => (field !== undefined && fields.includes(field) ? field : undefined);
  const refusals = (error.data?.refusals ?? []).map((refusal): FormRefusal => {
    const field = onField(refusal.field);
    return { code: refusal.code, message: wordsFor(refusal), ...(field === undefined ? {} : { attributeId: field }) };
  });
  const issues = (error.data?.issues ?? []).map((issue): FormRefusal => {
    const [first] = issue.path;
    const field = onField(typeof first === 'string' ? first : undefined);
    return { code: error.code, message: issue.message, ...(field === undefined ? {} : { attributeId: field }) };
  });
  const all = [...refusals, ...issues];
  return all.length > 0 ? all : [{ code: error.code, message: error.message }];
}

/** The words an object write's refusal shows in: the screens' own for a taken or reserved API name. */
export function objectWords(refusal: ApiRefusal): string {
  if (refusal.code === 'SLUG_TAKEN') return strings.apiNameTaken;
  return refusal.message;
}
