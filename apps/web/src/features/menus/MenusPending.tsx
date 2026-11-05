// The Menus editor while its route or its draft loads: the same frame it opens on (the tab bar, a section's rows beside
// the phone), as skeletons, so nothing moves when they arrive.
import { LinkList, PreviewLayout, SectionList, Skeleton, TabPanel, Tabs, TopBar } from '@crm/ui';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { strings } from './strings.ts';

const NOT_YET = () => undefined;
/** The tabs have their counts once the draft arrives, the only thing in the bar that moves. */
const TABS = [
  { id: 'structure', label: strings.tabStructure },
  { id: 'dishes', label: strings.tabAllDishes, isDisabled: true },
  { id: 'options', label: strings.tabAllOptions, isDisabled: true },
];

/** The Menus editor, loading. */
export function MenusPending() {
  return (
    <WorkspacePage
      currentPage="menus"
      page={{
        topBar: <TopBar title={strings.title} icon="utensils" isLoading />,
        body: (
          <Tabs variant="bar" label={strings.menuSettings} tabs={TABS} selectedKey="structure">
            <TabPanel id="structure" variant="fill">
              <PreviewLayout previewShare="wide" previewSurface="device" preview={<Skeleton shape="fill" />}>
                <SectionList
                  label={strings.sectionsLabel}
                  isTitleInset
                  sections={['first', 'second'].map((id) => ({
                    id,
                    isTitleLoading: true,
                    content: (
                      <LinkList
                        label={strings.title}
                        density="media"
                        status="loading"
                        rows={[]}
                        onOpen={NOT_YET}
                        searchLabel={strings.search}
                        isToolbarHidden
                        leadingLoading={<Skeleton shape="tile" size="title" />}
                      />
                    ),
                  }))}
                />
              </PreviewLayout>
            </TabPanel>
          </Tabs>
        ),
      }}
    />
  );
}
