// Home's Recently viewed (spec 0041): the records the member opened last, as
// RecordChips, newest first; only records they may still see (the server's
// rule), read each time Home is shown.
import { useHomeRecents } from '@crm/data/react';
import { Card, RecordChipList, type RecordChipItem } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo } from 'react';
import { recordLinks } from '../../records/timeline.ts';
import type { HomeSectionProps } from '../registry.ts';
import { strings } from '../strings.ts';

/** How many recent records the section shows. */
export const RECENT_SHOWN = 12;

/** Recently viewed: the member's last records, each opening its page. */
export function RecentSection({ context }: HomeSectionProps) {
  const { slug, objects } = context;
  const { data } = useRouteContext({ from: '__root__' });
  const view = useMemo(() => data.home.recents(slug), [data, slug]);
  const state = useHomeRecents(view);
  const link = useMemo(() => recordLinks(slug, objects), [slug, objects]);
  const records = useMemo(
    (): readonly RecordChipItem[] =>
      state.status !== 'ready'
        ? []
        : state.items
            .flatMap((item) => (item.kind === 'record' ? [item.ref] : []))
            .slice(0, RECENT_SHOWN)
            .map((ref) => {
              const href = link(ref.objectId, ref.recordId);
              return { display: ref, ...(href === undefined ? {} : { href }) };
            }),
    [state, link],
  );
  return (
    <Card title={strings.recent} isBusy={state.status === 'loading'}>
      <RecordChipList
        label={strings.recent}
        records={records}
        status={state.status}
        onRetry={() => {
          view.reload();
        }}
        emptyTitle={strings.noRecent}
        emptyText={strings.noRecentText}
      />
    </Card>
  );
}
