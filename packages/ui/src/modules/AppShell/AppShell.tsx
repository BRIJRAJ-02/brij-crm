// The frame every screen inside the app sits in (spec 0003, the app shell):
// the sidebar, then the main column of the three bars over the view, with an
// optional side panel. Below bp-page-compact the sidebar folds to its rail.
import { createContext, useId, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { breakpointToken } from '../../lib/token-values.ts';
import styles from './AppShell.module.css';
import { strings } from './strings.ts';

/** What the shell tells the pieces inside it: whether the page is narrower than `bp-page-compact`. */
export const AppShellContext = createContext({ isCompact: false });

const COMPACT_QUERY = `(width < ${String(breakpointToken('bp-page-compact'))}px)`;

// Whether the window is narrower than the compact breakpoint, kept current as it resizes.
function subscribe(onChange: () => void) {
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}
const isCompactNow = () => window.matchMedia(COMPACT_QUERY).matches;

/** Props for AppShell. */
export interface AppShellProps {
  /** The `Sidebar`. */
  readonly sidebar: ReactElement;
  /** The `TopBar`, with the page's title. */
  readonly topBar?: ReactNode;
  /** The `ViewBar`, on a view. */
  readonly viewBar?: ReactNode;
  /** The `Toolbar`, on a view. */
  readonly toolbar?: ReactNode;
  /** The view or page itself. */
  readonly children: ReactNode;
  /** A side panel beside the view: a record's details, a settings pane. */
  readonly panel?: ReactNode;
}

/**
 * The app's frame: the sidebar (folded to its rail below `bp-page-compact`),
 * then the main landmark, holding the bars over the view and the side panel.
 * A skip link, first in the tab order, jumps past the sidebar to the main
 * column. The view adapts to its width with container queries.
 */
export function AppShell({ sidebar, topBar, viewBar, toolbar, children, panel }: AppShellProps) {
  const mainId = useId();
  const isCompact = useSyncExternalStore(subscribe, isCompactNow, () => false);
  return (
    <AppShellContext value={{ isCompact }}>
      <div className={styles.root}>
        <VisuallyHidden isFocusable>
          <a className={styles.skip} href={`#${mainId}`}>
            {strings.skipToContent}
          </a>
        </VisuallyHidden>
        <div className={styles.sidebar}>{sidebar}</div>
        <main id={mainId} className={styles.main} tabIndex={-1}>
          {topBar}
          {viewBar}
          {toolbar}
          <div className={styles.content}>
            <div className={styles.view}>{children}</div>
            {panel !== undefined && <aside className={styles.panel}>{panel}</aside>}
          </div>
        </main>
      </div>
    </AppShellContext>
  );
}
