import { useContext, useEffect, useRef, type ReactNode } from 'react';
import { useFocusVisible } from 'react-aria';
import {
  SelectionIndicator,
  Tab,
  TabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  type Key,
} from 'react-aria-components';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { PageEdge } from '../../lib/page-edge.ts';
import { useScrollEdges } from '../../lib/scroll-edges.ts';
import styles from './Tabs.module.css';

/** One tab. */
export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** A count after the label (Notes 12). */
  readonly count?: number;
  /** The highest count shown as itself (99 by default); past it, "99+". */
  readonly countMax?: number;
  /** The count is a floor, not the total ("10,000+" for a capped count). */
  readonly isCountAtLeast?: boolean;
  readonly isDisabled?: boolean;
  /**
   * Marks the tab with a small danger dot after its label, and says this text to screen readers ("Needs a fix"):
   * a field on that tab holds an error the person can't see from the tab they are on (the booking page editor).
   */
  readonly alert?: string;
  /**
   * The address choosing it moves to, when each tab is a page of its own (Captures' Links · Forms). It doesn't
   * navigate by itself (`onSelectionChange` still does); it says where the tab leads as `data-href`, so the app
   * can load that page while a pointer rests on the tab.
   */
  readonly href?: string;
}

/**
 * The chosen tab's underline. React Aria slides it from the last tab by
 * setting an inline `translate` and `width` for one frame. When its layout
 * effect runs twice for one change (React's StrictMode does, and a route
 * that re-renders mid change can), it keeps the overridden values as the ones
 * to return to, and the line stays under the last tab (the form editor's
 * Submissions with the line under Install). Two frames on, after its own
 * frame, any override left is dropped, so the line always settles on its tab.
 */
function Indicator() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        ref.current?.style.removeProperty('translate');
        ref.current?.style.removeProperty('width');
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  });
  return <SelectionIndicator ref={ref} className={styles.indicator} />;
}

/** Props for Tabs. */
export interface TabsProps {
  /** What the tabs switch between ("Record"). Read by screen readers. */
  readonly label: string;
  readonly tabs: readonly TabItem[];
  readonly selectedKey?: string;
  readonly defaultSelectedKey?: string;
  readonly onSelectionChange?: (id: string) => void;
  /** At the strip's far end, on its hairline: the chosen tab's own tools (a search, the week's arrows). */
  readonly end?: ReactNode;
  /**
   * `strip` (the default): 40px tabs on a hairline, inside a page (a record's tabs). `bar`: the tabs as a page's
   * second bar, the row People's ViewBar takes under the TopBar: size-bar tall on the surface, the same padding
   * and hairline, kept in place while the page under it scrolls (Captures, Bookings).
   */
  readonly variant?: 'strip' | 'bar';
  /**
   * `none` drops the strip's 16px inset at both ends, so the first tab's label
   * lines up with a full width Table's first column under it and the tools
   * end at the table's edge (a settings page's Members, Invitations). The
   * default keeps the inset a record panel's tabs need from the panel's edge.
   * Directly in a settings page's body (SettingsLayout) neither applies: the
   * strip runs out to the page's edges, the bar's height, its first label on
   * the content edge where the body's headings and table text start.
   */
  readonly inset?: 'default' | 'none';
  /**
   * One TabPanel per tab, with the same ids. Leave it off for a strip whose
   * chosen tab is drawn by the page under it (a published form's Form,
   * Settings, Install and Submissions, each its own address).
   */
  readonly children?: ReactNode;
}

/**
 * Sections of one page, one at a time: a record's Activity, Notes, Tasks and
 * Files. An underline slides to the chosen tab (at once for the keyboard).
 * The arrow keys move between tabs; Tab moves into the panel. `end` puts the
 * chosen tab's own tools (Captures' search and New) at the strip's far end.
 */
export function Tabs({
  label,
  tabs,
  selectedKey,
  defaultSelectedKey,
  onSelectionChange,
  end,
  variant = 'strip',
  inset = 'default',
  children,
}: TabsProps) {
  const { isFocusVisible } = useFocusVisible();
  // Directly in a settings page's body, the strip runs to the page's edges with its first label on the content edge.
  const atPageEdge = useContext(PageEdge) && variant === 'strip';
  // Tabs past the bar's end (a phone) fade there, so the row shows it scrolls, as a scrollable Table does.
  const { edges, ref: listRef } = useScrollEdges(true);
  const fade = edges.start ? (edges.end ? 'both' : 'start') : edges.end ? 'end' : undefined;
  return (
    <AriaTabs
      className={styles.root}
      {...(selectedKey === undefined ? {} : { selectedKey })}
      {...(defaultSelectedKey === undefined ? {} : { defaultSelectedKey })}
      {...(onSelectionChange === undefined
        ? {}
        : {
            onSelectionChange: (key: Key) => {
              onSelectionChange(String(key));
            },
          })}
    >
      <div
        className={styles.bar}
        data-variant={variant === 'bar' ? 'bar' : undefined}
        data-inset={inset === 'none' && !atPageEdge ? 'none' : undefined}
        data-edge={atPageEdge ? 'page' : undefined}
      >
        <TabList
          ref={listRef}
          className={styles.list}
          aria-label={label}
          items={tabs}
          data-instant={isFocusVisible || undefined}
          data-fade={fade}
        >
          {(tab) => (
            <Tab
              id={tab.id}
              className={styles.tab}
              {...(tab.isDisabled === undefined ? {} : { isDisabled: tab.isDisabled })}
              data-href={tab.href}
            >
              {tab.icon !== undefined && <Icon name={tab.icon} size="sm" />}
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <Badge
                  count={tab.count}
                  {...(tab.countMax === undefined ? {} : { max: tab.countMax })}
                  {...(tab.isCountAtLeast === true ? { isAtLeast: true } : {})}
                />
              )}
              {tab.alert !== undefined && (
                <span className={styles.alert}>
                  <VisuallyHidden>{`, ${tab.alert}`}</VisuallyHidden>
                </span>
              )}
              <Indicator />
            </Tab>
          )}
        </TabList>
        {end !== undefined && <div className={styles.end}>{end}</div>}
      </div>
      {children}
    </AriaTabs>
  );
}

/** Props for TabPanel. */
export interface TabPanelProps {
  /** The id of its tab. */
  readonly id: string;
  /**
   * `fields` stacks the panel's content `space-16` apart, as a Form stacks its fields, for a tab that holds a
   * group of fields with no Card around them. `fill` makes the panel a flex column, so a page layout inside it
   * (PreviewLayout, in the Captures editors) can fill the view's height. The default lays out nothing.
   */
  readonly variant?: 'default' | 'fields' | 'fill';
  readonly children: ReactNode;
}

/** The content of one tab. */
export function TabPanel({ id, variant = 'default', children }: TabPanelProps) {
  return (
    <AriaTabPanel id={id} className={styles.panel} data-variant={variant === 'default' ? undefined : variant}>
      {children}
    </AriaTabPanel>
  );
}
