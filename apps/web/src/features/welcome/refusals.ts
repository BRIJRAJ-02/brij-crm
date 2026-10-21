// What first run says when making the workspace is refused: the server's
// refusals and input problems on the fields they name, anything else above
// them, in the server's words. Pure, so the rules are tested on their own.
import { isDataError } from '@crm/data';
import { strings } from './strings.ts';

/** A refusal for first run's forms: the field it is about by `name`, or none (shown above the fields). */
export interface WelcomeRefusal {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

/** The server's refusals and input problems as this form's refusals; anything else above the fields. */
export function refusalsOf(error: unknown): WelcomeRefusal[] {
  if (!isDataError(error)) return [{ code: 'INTERNAL', message: strings.somethingWrong }];
  const refusals = (error.data?.refusals ?? []).map((refusal) => ({
    code: refusal.code,
    message: refusal.message,
    ...(refusal.field === undefined ? {} : { field: refusal.field }),
  }));
  const issues = (error.data?.issues ?? []).map((issue) => {
    const [field] = issue.path;
    return { code: error.code, message: issue.message, ...(typeof field === 'string' ? { field } : {}) };
  });
  const all = [...refusals, ...issues];
  return all.length > 0 ? all : [{ code: error.code, message: error.message }];
}
