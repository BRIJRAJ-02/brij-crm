import { LinkChip } from '../../atoms/LinkChip/LinkChip.tsx';
import { ChipRow, EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import { asList, isFlatSurface } from '../values.ts';
import { urlHref } from './href.ts';
import { describeLink } from './social.ts';

/**
 * Url: a link chip, or a row of them with "+N" when the attribute holds
 * several. A profile on a social network shows the network's mark and the
 * handle; any other link shows its domain. The whole link is the tooltip,
 * and it opens in a new tab.
 */
export function UrlDisplay({ attribute, value, surface, maxVisible }: DisplayProps<'url'>) {
  const values = asList<string>(value);
  if (values.length === 0) return <EmptyValue surface={surface} />;
  return (
    <ChipRow
      label={attribute.name}
      {...(maxVisible === undefined ? {} : { maxVisible })}
      chips={values.map((item) => {
        const { label, network } = describeLink(item);
        return {
          key: item,
          node: (
            <LinkChip
              href={urlHref(item)}
              isFlat={isFlatSurface(surface)}
              title={item}
              {...(network === undefined ? {} : { mark: network })}
            >
              {label}
            </LinkChip>
          ),
        };
      })}
    />
  );
}
