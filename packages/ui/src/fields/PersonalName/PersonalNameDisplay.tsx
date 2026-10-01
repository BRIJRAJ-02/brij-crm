import type { PersonalNameValue } from '@crm/contracts/values';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';

/** Personal name: the full name, on one line. */
export function PersonalNameDisplay({ value, surface }: DisplayProps<'personal_name'>) {
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  return <TruncatedText>{(value as PersonalNameValue).fullName}</TruncatedText>;
}
