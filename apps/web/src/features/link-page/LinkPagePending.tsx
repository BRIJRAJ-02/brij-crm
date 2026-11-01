// The link page while its route loads: the same frame the screen opens on (its bar, the overview card beside the
// phone), as skeletons, so nothing moves when they arrive. No trail to Profile: the page is the workspace's own.
import { Card, LinkPage, PreviewLayout, Skeleton, TopBar } from '@crm/ui';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { strings } from './strings.ts';

/** The link page, loading. */
export function LinkPagePending() {
  return (
    <WorkspacePage
      currentPage="linkPage"
      page={{
        topBar: <TopBar title={strings.title} icon="id-card" isLoading />,
        body: (
          <PreviewLayout preview={<LinkPage isPreview />} previewShare="wide">
            <Card title={strings.yourPage} isBusy>
              <Skeleton shape="block" width="full" />
            </Card>
          </PreviewLayout>
        ),
      }}
    />
  );
}
