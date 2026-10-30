import type { PhoneValue } from '@crm/contracts/values';
import { LinkChip } from '../../atoms/LinkChip/LinkChip.tsx';
import { flagOf } from '../../lib/countries.ts';
import { ChipRow, EmptyValue, ValueActions } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import { asList, isFlatSurface } from '../values.ts';
import { usePhoneLibrary, type PhoneLibrary } from './phone-library.ts';

/** The number written the international way (+44 20 7123 4567), or as stored until the library loads. */
export function formatPhone(value: PhoneValue, library: PhoneLibrary | undefined): string {
  return library?.parsePhoneNumberFromString(value.number)?.formatInternational() ?? value.number;
}

/**
 * Phone: a LinkChip to `tel:` led by its country's flag (as Calendly's
 * picker shows it), formatted the international way; several are a row with
 * "+N". On a card the chip is flat text, with no flag. Copy beside each on
 * the panel copies the E.164 number.
 */
export function PhoneDisplay({ attribute, value, surface, maxVisible }: DisplayProps<'phone'>) {
  const library = usePhoneLibrary();
  const phones = asList<PhoneValue>(value);
  if (phones.length === 0) return <EmptyValue surface={surface} />;
  const isFlat = isFlatSurface(surface);
  return (
    <ChipRow
      label={attribute.name}
      {...(maxVisible === undefined ? {} : { maxVisible })}
      chips={phones.map((phone) => ({
        key: phone.number,
        node: (
          <ValueActions surface={surface} copy={phone.number}>
            <LinkChip href={`tel:${phone.number}`} isFlat={isFlat} {...(isFlat ? {} : { flag: flagOf(phone.country) })}>
              {formatPhone(phone, library)}
            </LinkChip>
          </ValueActions>
        ),
      }))}
    />
  );
}
