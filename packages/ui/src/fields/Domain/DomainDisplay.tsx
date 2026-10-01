import { LinkChip } from '../../atoms/LinkChip/LinkChip.tsx';
import { ChipRow, EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import { asList } from '../values.ts';
import { domainHref } from './href.ts';

/** Domain: a link chip, or a row of them with "+N" when the attribute holds several. */
export function DomainDisplay({ attribute, value, surface, maxVisible }: DisplayProps<'domain'>) {
  const values = asList<string>(value);
  if (values.length === 0) return <EmptyValue surface={surface} />;
  return (
    <ChipRow
      label={attribute.name}
      {...(maxVisible === undefined ? {} : { maxVisible })}
      chips={values.map((item) => ({ key: item, node: <LinkChip href={domainHref(item)}>{item}</LinkChip> }))}
    />
  );
}
