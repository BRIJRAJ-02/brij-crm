// The record page's layout (spec 0017, 0017-screens.md): a header, a tab bar
// with the chosen tab's panel under it, and a fixed sidebar of details on the
// right. Below bp-container-md the sidebar moves above the tabs, folded into
// a Disclosure. It lays the page out; what goes in each slot comes from
// other modules (RecordHeader, AttributeList, ActivityFeed).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { focusLater } from '../../lib/focus-later.ts';
import { breakpointToken, sizeToken } from '../../lib/token-values.ts';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { TabPanel, Tabs, type TabItem } from '../../molecules/Tabs/Tabs.tsx';
import styles from './RecordLayout.module.css';
import { strings } from './strings.ts';

/** Props for RecordLayout. */
export interface RecordLayoutProps {
  /** The page's head: a RecordHeader. */
  readonly header: ReactNode;
  readonly tabs: readonly TabItem[];
  /** The tab whose panel shows (`children`). */
  readonly selectedTab: string;
  readonly onTabChange: (id: string) => void;
  /** The chosen tab's panel. It fills the space under the tabs and scrolls inside it. */
  readonly children: ReactNode;
  /** The record's details and related records: AttributeList, then its sections. */
  readonly sidebar: ReactNode;
  /** The sidebar's name, and its Disclosure's title on a narrow page ("Details"). */
  readonly sidebarLabel: string;
  /** What the tabs switch between, for screen readers ("Record" when absent). */
  readonly tabsLabel?: string;
  /** On a narrow page, whether the sidebar's Disclosure is open (closed by default). */
  readonly isSidebarExpanded?: boolean;
  readonly onSidebarExpandedChange?: (isExpanded: boolean) => void;
  /** A notice over the whole page, such as a danger Callout for a deleted record. */
  readonly notice?: ReactNode;
  /** The record is still coming: the page is marked busy; the header, sidebar and panel show their own skeletons. */
  readonly isLoading?: boolean;
}

/**
 * The container width (px) below which the sidebar folds above the tabs: the
 * sidebar's own width (`size-panel`) plus a main column of `bp-container-md`,
 * so the header and tabs never get less than a medium container beside it.
 */
const NARROW_BELOW = breakpointToken('bp-container-md') + sizeToken('size-panel');

/** Whether the element is narrower than `bp-container-md`, kept current as it resizes. */
function useIsNarrow(): [ref: RefObject<HTMLDivElement | null>, isNarrow: boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [isNarrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = (width: number) => {
      // Not laid out yet (a hidden tab, a story before its frame): keep what it was.
      if (width > 0) setNarrow(width < NARROW_BELOW);
    };
    measure(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, isNarrow];
}

/**
 * A record's page: the header over the tabs and the chosen tab's panel, and
 * the details in a fixed sidebar on the right, each scrolling on its own at
 * the page's full height. On a page narrower than `bp-container-md` the
 * sidebar sits above the tabs in a Disclosure, closed until opened, and the
 * panel keeps the page's height so a feed still scrolls inside it.
 */
export function RecordLayout({
  header,
  tabs,
  selectedTab,
  onTabChange,
  children,
  sidebar,
  sidebarLabel,
  tabsLabel = strings.tabs,
  isSidebarExpanded,
  onSidebarExpandedChange,
  notice,
  isLoading = false,
}: RecordLayoutProps) {
  const [ref, isNarrow] = useIsNarrow();
  // When the tab changes from inside the panel (a "View all" there), the control pressed goes with the panel:
  // focus moves to the chosen tab, rather than to the page.
  const panelHadFocus = useRef(false);
  const shownTab = useRef(selectedTab);
  useEffect(() => {
    if (shownTab.current === selectedTab) return;
    shownTab.current = selectedTab;
    if (!panelHadFocus.current) return;
    panelHadFocus.current = false;
    focusLater(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return undefined;
      return ref.current?.querySelector<HTMLElement>(`[role="tab"][data-key="${CSS.escape(selectedTab)}"]`);
    });
  }, [selectedTab, ref]);
  const tabbed = (
    <div className={styles.tabs}>
      <Tabs label={tabsLabel} tabs={tabs} selectedKey={selectedTab} onSelectionChange={onTabChange}>
        {/* A panel per tab, so each tab names its own; only the chosen one draws, and it holds `children`. */}
        {tabs.map((tab) => (
          <TabPanel key={tab.id} id={tab.id}>
            {tab.id === selectedTab && (
              <div
                className={styles.panel}
                onFocus={() => {
                  panelHadFocus.current = true;
                }}
                onBlur={(event) => {
                  // Focus moving elsewhere on the page; a control unmounting with the panel blurs to nothing.
                  if (event.relatedTarget !== null) panelHadFocus.current = false;
                }}
              >
                {children}
              </div>
            )}
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
  return (
    <div
      ref={ref}
      className={styles.root}
      data-layout={isNarrow ? 'narrow' : 'wide'}
      aria-busy={isLoading || undefined}
    >
      {notice !== undefined && <div className={styles.notice}>{notice}</div>}
      {isNarrow ? (
        <div className={styles.stack}>
          <div className={styles.header}>{header}</div>
          <aside className={styles.folded} aria-label={sidebarLabel}>
            <Disclosure
              title={sidebarLabel}
              {...(isSidebarExpanded === undefined ? { defaultExpanded: false } : { isExpanded: isSidebarExpanded })}
              {...(onSidebarExpandedChange === undefined ? {} : { onExpandedChange: onSidebarExpandedChange })}
            >
              {sidebar}
            </Disclosure>
          </aside>
          {tabbed}
        </div>
      ) : (
        <div className={styles.columns}>
          <div className={styles.main}>
            <div className={styles.header}>{header}</div>
            {tabbed}
          </div>
          <aside className={styles.sidebar} aria-label={sidebarLabel}>
            {sidebar}
          </aside>
        </div>
      )}
    </div>
  );
}
