import { LinkChip } from '../../atoms/LinkChip/LinkChip.tsx';
import { ChipRow, EmptyValue, ValueActions } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import { asList, isFlatSurface } from '../values.ts';
import { emailHref } from './href.ts';

/** Email: a link chip, or a row of them with "+N" when the attribute holds several; Copy beside each on the panel. */
export function EmailDisplay({ attribute, value, surface, maxVisible }: DisplayProps<'email'>) {
  const values = asList<string>(value);
  if (values.length === 0) return <EmptyValue surface={surface} />;
  return (
    <ChipRow
      label={attribute.name}
      {...(maxVisible === undefined ? {} : { maxVisible })}
      chips={values.map((item) => ({
        key: item,
        node: (
          <ValueActions surface={surface} copy={item}>
            <LinkChip href={emailHref(item)} isFlat={isFlatSurface(surface)}>
              {item}
            </LinkChip>
          </ValueActions>
        ),
      }))}
    />
  );
}
