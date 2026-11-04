// The frame every screen inside the app sits in (spec 0003, the app shell):
// the sidebar, then the main column of the three bars over the view, with an
// optional side panel. Below bp-page-compact the sidebar folds to its rail.
import {
  createContext,
  useCallback,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { PanelPushContext, type PanelWidth } from '../../molecules/Panel/Panel.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { breakpointToken } from '../../lib/token-values.ts';
import styles from './AppShell.module.css';
import { strings } from './strings.ts';

/**
 * What the shell tells the pieces inside it: whether the page is narrower than `bp-page-compact`, and (for the
 * sidebar alone) whether it fills a phone's whole width as a list (`phoneSidebar="full"`).
 */
export const AppShellContext = createContext({ isCompact: false, isFull: false });

const COMPACT_QUERY = `(width < ${String(breakpointToken('bp-page-compact'))}px)`;
/** A phone: the width under which a container drops to one column (`bp-container-md`, 480px). */
const PHONE_QUERY = `(width < ${String(breakpointToken('bp-container-md'))}px)`;

// Whether the window matches `media`, kept current as it resizes.
const watch = (media: string) => (onChange: () => void) => {
  const query = window.matchMedia(media);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
};
const subscribe = watch(COMPACT_QUERY);
const subscribePhone = watch(PHONE_QUERY);
const isCompactNow = () => window.matchMedia(COMPACT_QUERY).matches;
const isPhoneNow = () => window.matchMedia(PHONE_QUERY).matches;

/**
 * What the sidebar is on a phone (under 480px): `rail` (the default) keeps the icon rail beside the page; `hidden`
 * gives the page the whole width (a settings page, whose way back is its TopBar's `back`); `full` shows the sidebar
 * alone, open and the whole width, as the list a phone's settings open on (iOS's and Linear's mobile settings).
 */
export type PhoneSidebar = 'rail' | 'hidden' | 'full';

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
  /**
   * A state of the whole app for this person, under the bars on every page:
   * a `Callout` with `placement="banner"` (a disconnected calendar, spec 0024).
   */
  readonly banner?: ReactNode;
  /** The view or page itself. */
  readonly children: ReactNode;
  /** A side panel beside the view: a record's details, a settings pane. */
  readonly panel?: ReactNode;
  /**
   * Names the page the view shows, for a frame that stays mounted across
   * pages: a new name draws a new view box (at its top), so another page
   * arrives fresh rather than as the last page's box moved under new bars.
   */
  readonly viewKey?: string;
  /** The sidebar on a phone (under 480px): the rail (default), hidden, or the whole screen as a list. */
  readonly phoneSidebar?: PhoneSidebar;
}

/** Props for AppShellSlot. */
export interface AppShellSlotProps {
  /** The element pages portal into. */
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * An empty place in one of the shell's bars that a page fills through a
 * portal, for a frame that stays mounted while its pages change. It draws no
 * box of its own (`display: contents`), so what lands in it lays out as if it
 * were passed to the bar directly.
 */
export function AppShellSlot({ ref }: AppShellSlotProps) {
  return <div ref={ref} className={styles.slot} />;
}

/**
 * The app's frame: the sidebar (folded to its rail below `bp-page-compact`),
 * then the main landmark, holding the bars over the view and the side panel.
 * A skip link, first in the tab order, jumps past the sidebar to the main
 * column. The view adapts to its width with container queries.
 */
export function AppShell({
  sidebar,
  topBar,
  viewBar,
  toolbar,
  banner,
  children,
  panel,
  viewKey,
  phoneSidebar = 'rail',
}: AppShellProps) {
  const mainId = useId();
  const isCompact = useSyncExternalStore(subscribe, isCompactNow, () => false);
  const isPhone = useSyncExternalStore(subscribePhone, isPhoneNow, () => false);
  // A phone's settings list: the sidebar open (not the rail) and the whole width, the page hidden behind it.
  const isFull = isPhone && phoneSidebar === 'full';
  // The panels open that asked for room (Panel's `pushesPage`), widest first: the main column narrows by the widest.
  const [pushes, setPushes] = useState<readonly PanelWidth[]>([]);
  const push = useCallback((width: PanelWidth) => {
    setPushes((before) => [...before, width]);
    return () => {
      setPushes((before) => {
        const at = before.indexOf(width);
        return at === -1 ? before : [...before.slice(0, at), ...before.slice(at + 1)];
      });
    };
  }, []);
  const pushed = isCompact || pushes.length === 0 ? undefined : pushes.includes('lg') ? 'lg' : 'md';
  // One object while the width class holds, so a panel opening (AppShell's state) doesn't re-render every reader.
  const shell = useMemo(() => ({ isCompact, isFull: false }), [isCompact]);
  const sidebarShell = useMemo(() => ({ isCompact: isCompact && !isFull, isFull }), [isCompact, isFull]);
  return (
    <AppShellContext value={shell}>
      <PanelPushContext value={push}>
        <div className={styles.root} data-phone-sidebar={phoneSidebar === 'rail' ? undefined : phoneSidebar}>
          <VisuallyHidden isFocusable>
            <a className={styles.skip} href={`#${mainId}`}>
              {strings.skipToContent}
            </a>
          </VisuallyHidden>
          <div className={styles.sidebar}>
            <AppShellContext value={sidebarShell}>{sidebar}</AppShellContext>
          </div>
          <main id={mainId} className={styles.main} tabIndex={-1} data-pushed={pushed}>
            {topBar}
            {viewBar}
            {toolbar}
            {banner}
            <div className={styles.content}>
              <div key={viewKey} className={styles.view}>
                {children}
              </div>
              {panel !== undefined && <aside className={styles.panel}>{panel}</aside>}
            </div>
          </main>
        </div>
      </PanelPushContext>
    </AppShellContext>
  );
}
