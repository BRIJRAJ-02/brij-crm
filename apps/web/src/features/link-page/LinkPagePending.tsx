// The link page editor while its route loads: the same layout, the list's rows and the phone's page as skeletons,
// so nothing moves when they arrive.
import { Card, LinkList, LinkListRowOrder, LinkPage, LinkPageTile, PreviewLayout } from '@crm/ui';
import { useParams } from '@tanstack/react-router';
import { profileHref } from '../settings/nav.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { strings } from './strings.ts';

/** Settings › Account › Link page, loading. */
export function LinkPagePending() {
  const { slug = '' } = useParams({ strict: false });
  return (
    <SettingsPage
      title={strings.title}
      crumbs={[{ id: 'profile', label: strings.profile, href: profileHref(slug) }]}
      fillsView
    >
      <PreviewLayout preview={<LinkPage isPreview />} previewShare="wide">
        <Card title={strings.blocks} description={strings.blocksText} isBusy>
          <LinkList
            label={strings.blocks}
            searchLabel={strings.blocks}
            placement="card"
            isToolbarHidden
            leadingLoading={<LinkPageTile />}
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
