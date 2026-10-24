// The link page editor while its route loads: the same layout, the list's rows and the phone's page as skeletons,
// so nothing moves when they arrive.
import { Card, LinkList, LinkListRowOrder, LinkPage, PreviewLayout } from '@crm/ui';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { strings } from './strings.ts';

/** Settings › Account › Link page, loading. */
export function LinkPagePending() {
  return (
    <SettingsPage title={strings.title} fillsView>
      <PreviewLayout preview={<LinkPage isPreview />}>
        <Card title={strings.blocks} description={strings.blocksText} isBusy>
          <LinkList
            label={strings.blocks}
            searchLabel={strings.blocks}
            placement="card"
            isToolbarHidden
            hasLeading
            rows={[]}
            status="loading"
            onOpen={() => undefined}
            onMove={() => undefined}
            rowOrder={LinkListRowOrder}
          />
        </Card>
      </PreviewLayout>
    </SettingsPage>
  );
}
