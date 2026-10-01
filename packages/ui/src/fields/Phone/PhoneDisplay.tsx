import type { PhoneValue } from '@crm/contracts/values';
import { LinkChip } from '../../atoms/LinkChip/LinkChip.tsx';
import { ChipRow, EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import { asList } from '../values.ts';
import { usePhoneLibrary, type PhoneLibrary } from './phone-library.ts';

/** The number written the international way (+44 20 7123 4567), or as stored until the library loads. */
export function formatPhone(value: PhoneValue, library: PhoneLibrary | undefined): string {
  return library?.parsePhoneNumberFromString(value.number)?.formatInternational() ?? value.number;
}

/** Phone: a LinkChip to `tel:`, formatted the international way; several are a row with "+N". */
export function PhoneDisplay({ attribute, value, surface, maxVisible }: DisplayProps<'phone'>) {
  const library = usePhoneLibrary();
  const phones = asList<PhoneValue>(value);
  if (phones.length === 0) return <EmptyValue surface={surface} />;
  return (
    <ChipRow
      label={attribute.name}
      {...(maxVisible === undefined ? {} : { maxVisible })}
      chips={phones.map((phone) => ({
        key: phone.number,
        node: <LinkChip href={`tel:${phone.number}`}>{formatPhone(phone, library)}</LinkChip>,
      }))}
    />
  );
}
