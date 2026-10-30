import { PersonalNameValue as PersonalNameSchema, type PersonalNameValue } from '@crm/contracts/values';
import { cleanText } from '../../lib/parse-input.ts';

/** "Lovelace, Ada" or "Ada Lovelace" as a name: a comma means last name first; otherwise split at the first space. */
export function nameFromText(text: string): PersonalNameValue | undefined {
  const trimmed = cleanText(text);
  const [lastPart, firstPart] = trimmed.includes(',') ? trimmed.split(',', 2).map((part) => part.trim()) : [];
  const [firstName, ...rest] = trimmed.includes(',') ? [firstPart ?? ''] : trimmed.split(/\s+/);
  const lastName = trimmed.includes(',') ? lastPart : rest.join(' ');
  const parsed = PersonalNameSchema.safeParse({
    ...(firstName === undefined || firstName === '' ? {} : { firstName }),
    ...(lastName === undefined || lastName === '' ? {} : { lastName }),
  });
  return parsed.success ? parsed.data : undefined;
}
