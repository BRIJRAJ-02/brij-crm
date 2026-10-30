import { LinkChip } from '../../atoms/LinkChip/LinkChip.tsx';
import { useSiteIcons } from '../../provider/site-icons.ts';
import { ChipRow, EmptyValue, ValueActions } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import { asList, isFlatSurface } from '../values.ts';
import { urlHref } from './href.ts';
import { describeLink } from './social.ts';

/** The host a link points at, without `www.`, or undefined when it doesn't parse. */
function hostOf(link: string): string | undefined {
  try {
    return new URL(link).hostname.replace(/^www\./u, '');
  } catch {
    return undefined;
  }
}

/**
 * Url: a link chip, or a row of them with "+N" when the attribute holds
 * several. A profile on a social network shows the network's mark and the
 * handle; any other link shows its site's icon (when the app serves icons),
 * its domain and path. It opens in a new tab; Copy sits beside it on the panel.
 */
export function UrlDisplay({ attribute, value, surface, maxVisible }: DisplayProps<'url'>) {
  const iconOf = useSiteIcons();
  const values = asList<string>(value);
  if (values.length === 0) return <EmptyValue surface={surface} />;
  return (
    <ChipRow
      label={attribute.name}
      {...(maxVisible === undefined ? {} : { maxVisible })}
      chips={values.map((item) => {
        const { label, network } = describeLink(item);
        const host = network === undefined ? hostOf(item) : undefined;
        const iconSrc = host === undefined ? undefined : iconOf?.(host);
        return {
          key: item,
          node: (
            <ValueActions surface={surface} copy={item}>
              <LinkChip
                href={urlHref(item)}
                isFlat={isFlatSurface(surface)}
                {...(network === undefined ? {} : { mark: network })}
                {...(iconSrc === undefined ? {} : { iconSrc })}
              >
                {label}
              </LinkChip>
            </ValueActions>
          ),
        };
      })}
    />
  );
}
