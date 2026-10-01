import type { ReactNode } from 'react';
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
import type { IconName } from '../../atoms/Icon/icons.ts';
import styles from './Tabs.module.css';

/** One tab. */
export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** A count after the label (Notes 12). */
  readonly count?: number;
  readonly isDisabled?: boolean;
}

/** Props for Tabs. */
export interface TabsProps {
  /** What the tabs switch between ("Record"). Read by screen readers. */
  readonly label: string;
  readonly tabs: readonly TabItem[];
  readonly selectedKey?: string;
  readonly defaultSelectedKey?: string;
  readonly onSelectionChange?: (id: string) => void;
  /** One TabPanel per tab, with the same ids. */
  readonly children: ReactNode;
}

/**
 * Sections of one page, one at a time: a record's Activity, Notes, Tasks and
 * Files. An underline slides to the chosen tab (at once for the keyboard).
 * The arrow keys move between tabs; Tab moves into the panel.
 */
export function Tabs({ label, tabs, selectedKey, defaultSelectedKey, onSelectionChange, children }: TabsProps) {
  const { isFocusVisible } = useFocusVisible();
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
      <TabList className={styles.list} aria-label={label} items={tabs} data-instant={isFocusVisible || undefined}>
        {(tab) => (
          <Tab
            id={tab.id}
            className={styles.tab}
            {...(tab.isDisabled === undefined ? {} : { isDisabled: tab.isDisabled })}
          >
            {tab.icon !== undefined && <Icon name={tab.icon} size="sm" />}
            <span>{tab.label}</span>
            {tab.count !== undefined && <Badge count={tab.count} />}
            <SelectionIndicator className={styles.indicator} />
          </Tab>
        )}
      </TabList>
      {children}
    </AriaTabs>
  );
}

/** Props for TabPanel. */
export interface TabPanelProps {
  /** The id of its tab. */
  readonly id: string;
  readonly children: ReactNode;
}

/** The content of one tab. */
export function TabPanel({ id, children }: TabPanelProps) {
  return (
    <AriaTabPanel id={id} className={styles.panel}>
      {children}
    </AriaTabPanel>
  );
}
