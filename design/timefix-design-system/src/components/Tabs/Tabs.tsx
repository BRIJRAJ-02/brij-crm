import { Tabs as AriaTabs, TabList, Tab, TabPanel as AriaTabPanel, type Key, type TabPanelProps as AriaTabPanelProps } from 'react-aria-components';
import { useState, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { Count } from '../Tag/Tag.tsx';
import { useSlidingIndicator } from './useSlidingIndicator.ts';
import './Tabs.css';

/** One tab: an id, a label, an optional 16px icon and an optional count. */
export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly count?: number;
  readonly isDisabled?: boolean;
}

/** Props for Tabs. Controlled with `selectedKey`, or uncontrolled with `defaultSelectedKey`. */
export interface TabsProps {
  readonly items: ReadonlyArray<TabItem>;
  readonly 'aria-label': string;
  readonly selectedKey?: string;
  readonly defaultSelectedKey?: string;
  readonly onSelectionChange?: (key: string) => void;
  /** `TabPanel`s whose `id` matches an item. Leave out when the tabs drive a route instead. */
  readonly children?: ReactNode;
  readonly className?: string;
}

/** Underline tabs that switch sections of one page (Overview, Activity, Notes). The accent line slides to the chosen tab; the bar scrolls when the tabs overflow. */
export function Tabs({ items, selectedKey, defaultSelectedKey, onSelectionChange, children, className, ...rest }: TabsProps) {
  const [inner, setInner] = useState<string>(defaultSelectedKey ?? items[0]?.id ?? '');
  const key = selectedKey ?? inner;
  const barRef = useSlidingIndicator(key);
  const change = (k: Key) => { setInner(String(k)); onSelectionChange?.(String(k)); };
  return (
    <AriaTabs selectedKey={key} onSelectionChange={change} className={cx('tf-tabs', className)}>
      <div className="tf-tabs__bar" ref={barRef}>
        <TabList aria-label={rest['aria-label']} className="tf-tabs__list" items={items}>
          {(item) => (
            <Tab id={item.id} isDisabled={item.isDisabled} className="tf-tabs__tab">
              {item.icon}
              <span>{item.label}</span>
              {item.count !== undefined && <Count>{item.count.toLocaleString('en-US')}</Count>}
            </Tab>
          )}
        </TabList>
        <span className="tf-tabs__line" aria-hidden="true" />
      </div>
      {children}
    </AriaTabs>
  );
}

/** The content for one tab; `id` matches the tab's. */
export function TabPanel({ className, ...rest }: Omit<AriaTabPanelProps, 'className'> & { readonly className?: string }) {
  return <AriaTabPanel {...rest} className={cx('tf-tabs__panel', className)} />;
}
