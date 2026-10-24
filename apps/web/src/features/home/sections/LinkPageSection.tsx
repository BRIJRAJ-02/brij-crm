// Home's "Your link page" (spec 0051, AC-5121 to AC-5123): the card and its QR code load with their own chunk the
// first time Home draws them, so neither is in the app's first load nor in Home's own chunk. Its place holds a
// loading card meanwhile; a chunk that didn't load (a deploy moved it, the connection dropped) says so in place.
import { Card, Skeleton } from '@crm/ui';
import { lazy, Suspense, type ComponentType } from 'react';
import type { LinkPageHomeCardProps } from '../../link-page/LinkPageHomeCard.tsx';
import { homeStrings } from '../../link-page/home-strings.ts';
import type { HomeSectionProps } from '../registry.ts';
import { Failed } from './shared.tsx';

/** Stands in for a card whose code didn't load. */
function Unavailable() {
  return (
    <Card title={homeStrings.title}>
      <Failed
        title={homeStrings.failed}
        message={homeStrings.unavailable}
        onRetry={() => {
          window.location.reload();
        }}
      />
    </Card>
  );
}

const LinkPageHomeCard = lazy((): Promise<{ default: ComponentType<LinkPageHomeCardProps> }> =>
  import('../../link-page/LinkPageHomeCard.tsx').then(
    (module) => ({ default: module.LinkPageHomeCard }),
    () => ({ default: Unavailable }),
  ),
);

/** Your link page, drawn once its chunk is here. */
export function LinkPageSection({ context }: HomeSectionProps) {
  return (
    <Suspense
      fallback={
        <Card title={homeStrings.title} isBusy>
          <Skeleton shape="block" width="full" />
        </Card>
      }
    >
      <LinkPageHomeCard slug={context.slug} />
    </Suspense>
  );
}
