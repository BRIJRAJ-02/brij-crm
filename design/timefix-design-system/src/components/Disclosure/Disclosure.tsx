import { Disclosure as AriaDisclosure, DisclosureGroup as AriaDisclosureGroup, DisclosurePanel, Heading, Button as AriaButton, type Key } from 'react-aria-components';
import { useState, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { TextSwap } from '../Motion/Motion.tsx';
import './Disclosure.css';

/** The chevron that flips from "v" to "^" (transitions.dev 21). Symmetric about its viewBox so the flip lands exactly. */
export function FlipChevron({ size = 16 }: { readonly size?: number }) {
  return (
    <span className="tf-flip-chevron" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5L8 10.5L12 6.5" /></svg>
    </span>
  );
}

/** Props for DisclosureGroup. */
export interface DisclosureGroupProps {
  readonly children: ReactNode;
  /** Several rows open at once (filters, FAQs). Off: opening one closes the others (settings groups). */
  readonly allowsMultipleExpanded?: boolean;
  readonly defaultExpandedKeys?: Iterable<Key>;
  readonly expandedKeys?: Iterable<Key>;
  readonly onExpandedChange?: (keys: Set<Key>) => void;
  /** `card` puts the rows inside a bordered surface; `plain` is rows with hairlines only. */
  readonly variant?: 'card' | 'plain';
}

/** A stack of accordion rows, one or several open at a time. */
export function DisclosureGroup({ children, variant = 'card', ...rest }: DisclosureGroupProps) {
  return <AriaDisclosureGroup {...rest} className={cx('tf-acc', `tf-acc--${variant}`)}>{children}</AriaDisclosureGroup>;
}

/** Props for DisclosureItem. */
export interface DisclosureItemProps {
  readonly id?: Key;
  readonly title: string;
  /** A grey one-liner under the title. */
  readonly description?: string;
  readonly icon?: ReactNode;
  /** Something at the right of the head before the chevron: a Count, a Tag. */
  readonly end?: ReactNode;
  readonly children: ReactNode;
  readonly defaultExpanded?: boolean;
  readonly isDisabled?: boolean;
}

/** One accordion row: a 44px head that opens a panel below it. Use inside a DisclosureGroup, or alone. */
export function DisclosureItem({ id, title, description, icon, end, children, defaultExpanded, isDisabled }: DisclosureItemProps) {
  return (
    <AriaDisclosure id={id} defaultExpanded={defaultExpanded} isDisabled={isDisabled} className="tf-acc__item">
      <Heading className="tf-acc__heading">
        <AriaButton slot="trigger" className="tf-acc__head">
          {icon !== undefined && <span className="tf-acc__icon">{icon}</span>}
          <span className="tf-acc__titles">
            <span className="tf-acc__title">{title}</span>
            {description !== undefined && <span className="tf-acc__desc">{description}</span>}
          </span>
          {end}
          <FlipChevron />
        </AriaButton>
      </Heading>
      <DisclosurePanel className="tf-acc__panel"><div className="tf-acc__inner">{children}</div></DisclosurePanel>
    </AriaDisclosure>
  );
}

/** The settings "Show advanced" link: a quiet text button whose label swaps and whose chevron flips, revealing extra fields below. */
export function ShowMore({ children, showLabel = 'Show advanced settings', hideLabel = 'Hide advanced settings', defaultExpanded = false }: { readonly children: ReactNode; readonly showLabel?: string; readonly hideLabel?: string; readonly defaultExpanded?: boolean }) {
  const [open, setOpen] = useState(defaultExpanded);
  return (
    <AriaDisclosure isExpanded={open} onExpandedChange={setOpen} className="tf-acc__item tf-showmore">
      <AriaButton slot="trigger" className="tf-showmore__trigger">
        <TextSwap swapKey={String(open)}>{open ? hideLabel : showLabel}</TextSwap>
        <FlipChevron size={14} />
      </AriaButton>
      <DisclosurePanel className="tf-acc__panel"><div className="tf-acc__inner tf-showmore__inner">{children}</div></DisclosurePanel>
    </AriaDisclosure>
  );
}
