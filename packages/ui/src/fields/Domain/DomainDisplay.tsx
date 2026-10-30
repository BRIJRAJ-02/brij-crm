import { LinkChip } from '../../atoms/LinkChip/LinkChip.tsx';
import { useSiteIcons } from '../../provider/site-icons.ts';
import { ChipRow, EmptyValue, ValueActions } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import { asList, isFlatSurface } from '../values.ts';
import { domainHref } from './href.ts';

/**
 * Domain: a link chip led by the site's icon (when the app serves icons, its
 * first letter otherwise), or a row of them with "+N" when the attribute
 * holds several; Copy beside each on the panel.
 */
export function DomainDisplay({ attribute, value, surface, maxVisible }: DisplayProps<'domain'>) {
  const iconOf = useSiteIcons();
  const values = asList<string>(value);
  if (values.length === 0) return <EmptyValue surface={surface} />;
  return (
    <ChipRow
      label={attribute.name}
      {...(maxVisible === undefined ? {} : { maxVisible })}
      chips={values.map((item) => {
        const iconSrc = iconOf?.(item);
        return {
          key: item,
          node: (
            <ValueActions surface={surface} copy={item}>
              <LinkChip
                href={domainHref(item)}
                isFlat={isFlatSurface(surface)}
                {...(iconSrc === undefined ? {} : { iconSrc })}
              >
                {item}
              </LinkChip>
            </ValueActions>
          ),
        };
      })}
    />
  );
}
