// Brief
// Purpose: the workspace's landing page (owner, 21 October 2026), the sidebar's first row, as in timefix.
// Main task: for now, say what Home will hold; the Home dashboard lane fills it from timefix's dashboard module.
// Leaves out: every widget, until that lane builds them with the library's components.
import { EmptyState, TopBar } from '@crm/ui';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { strings } from './strings.ts';

/** Home: a title and a placeholder, full width, until the dashboard lands. */
export function HomeScreen() {
  return (
    <WorkspacePage
      currentPage="home"
      page={{
        topBar: <TopBar title={strings.home} icon="house" />,
        body: (
          <EmptyState icon="house" title={strings.comingTitle}>
            {strings.comingText}
          </EmptyState>
        ),
      }}
    />
  );
}
