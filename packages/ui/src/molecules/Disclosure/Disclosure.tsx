import { useContext, type ReactNode } from 'react';
import {
  Button as AriaButton,
  Disclosure as AriaDisclosure,
  DisclosureGroup as AriaDisclosureGroup,
  DisclosurePanel,
  DisclosureStateContext,
  Heading,
} from 'react-aria-components';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { PageEdge } from '../../lib/page-edge.ts';
import { RowInset } from '../../lib/row-inset.ts';
import { CardTitleLevel } from '../Card/Card.tsx';
import styles from './Disclosure.module.css';

/** Props for Disclosure. */
export interface DisclosureProps {
  /** The section's title, which is also its toggle. */
  readonly title: string;
  readonly children: ReactNode;
  /** An id, when it sits in a DisclosureGroup. */
  readonly id?: string;
  /** A count after the title (Attributes 14). */
  readonly count?: number;
  /**
   * What the count counts, read after the number by screen readers ("people"),
   * and shown whole however large: a record's related section says "Team
   * 150,000" rather than "99+" (spec 0017). Without it the count caps at 99+.
   */
  readonly countLabel?: string;
  readonly isExpanded?: boolean;
  readonly defaultExpanded?: boolean;
  readonly onExpandedChange?: (isExpanded: boolean) => void;
  readonly isDisabled?: boolean;
  /** Something before the title, inside the toggle: an account's provider mark in the calendars list. */
  readonly leading?: ReactNode;
  /**
   * `label` draws the title as a sidebar section label: 11px, quiet, its
   * chevron after it. `fields` stacks the panel's content `space-16` apart, as
   * a Form stacks its fields, for more fields folded inside a form ("Add more
   * fields" in a create dialog). `quiet` folds the rest of a list under a
   * control sized to its words, like a ghost Button: its chevron sits in the
   * rows' 16px icon column, its words on their text line, and the panel is
   * flush, so the rows it holds line up with the rows above (Home's setup
   * checklist's done steps).
   */
  readonly variant?: 'default' | 'label' | 'fields' | 'quiet';
  /**
   * Quiet controls after the title, outside its toggle (a sidebar section's
   * grip and its menu, spec 0034). In the `label` variant they show while the
   * row is hovered or holds focus, and always to the keyboard.
   */
  readonly actions?: ReactNode;
  /**
   * The title's heading level where the default (3) would sit beside its container's own heading: 4 inside a
   * Card whose title is an h3 (Home's setup checklist's done steps).
   */
  readonly headingLevel?: 2 | 3 | 4 | 5;
  /**
   * A hairline over the section and a little air under it, setting it apart from what sits above: a record's
   * sidebar sections (Lists, each related object), one after another under the record's details.
   */
  readonly isRuled?: boolean;
}

/** A section that opens and closes under its title: attribute groups, advanced settings, sidebar sections. */
export function Disclosure({
  title,
  children,
  id,
  count,
  countLabel,
  isExpanded,
  defaultExpanded,
  onExpandedChange,
  isDisabled,
  leading,
  variant = 'default',
  actions,
  headingLevel,
  isRuled = false,
}: DisclosureProps) {
  // Directly in a settings page's body, the title row runs to the page's edges, its chevron on the content edge.
  const atPageEdge = useContext(PageEdge) && variant === 'default';
  // Under rows inset by space-8 (a TaskList's footer), a quiet fold lines up with those rows instead.
  const atRowInset = useContext(RowInset) && variant === 'quiet';
  // At the page edge its title is a heading at the level a card's title takes there (an h2 right under a
  // settings page's TopBar), so headings never skip a level; anywhere else an h3, as before.
  const level = useContext(CardTitleLevel);
  const heading = (
    <Heading className={styles.heading} level={headingLevel ?? (atPageEdge ? level : 3)}>
      <AriaButton
        slot="trigger"
        className={styles.trigger}
        data-variant={variant}
        data-edge={atPageEdge ? 'page' : undefined}
        data-inset={atRowInset ? 'row' : undefined}
      >
        <span className={styles.chevron}>
          <Icon name="chevron-right" size={variant === 'label' ? 'xs' : 'sm'} />
        </span>
        {leading}
        <span className={styles.title}>{title}</span>
        {count !== undefined &&
          (countLabel === undefined ? (
            <Badge count={count} />
          ) : (
            <Badge count={count} max={Number.MAX_SAFE_INTEGER} label={countLabel} />
          ))}
      </AriaButton>
    </Heading>
  );
  return (
    <AriaDisclosure
      className={styles.root}
      data-variant={variant}
      data-edge={atPageEdge ? 'page' : undefined}
      data-inset={atRowInset ? 'row' : undefined}
      data-ruled={isRuled || undefined}
      {...(id === undefined ? {} : { id })}
      {...(isExpanded === undefined ? {} : { isExpanded })}
      {...(defaultExpanded === undefined ? {} : { defaultExpanded })}
      {...(onExpandedChange === undefined ? {} : { onExpandedChange })}
      {...(isDisabled === undefined ? {} : { isDisabled })}
    >
      {actions === undefined ? (
        heading
      ) : (
        <div className={styles.headingRow}>
          {heading}
          <span className={styles.actions} data-quiet={variant === 'label' || undefined}>
            {actions}
          </span>
        </div>
      )}
      <DisclosurePanel className={styles.panel}>
        <PanelContent variant={variant} edge={atPageEdge ? 'page' : undefined}>
          {children}
        </PanelContent>
      </DisclosurePanel>
    </AriaDisclosure>
  );
}

/** The panel's content, inert while folded, so links and fields inside it take no focus. */
function PanelContent({
  variant,
  edge,
  children,
}: {
  readonly variant: string;
  readonly edge: 'page' | undefined;
  readonly children: ReactNode;
}) {
  const state = useContext(DisclosureStateContext);
  return (
    <div className={styles.content} data-variant={variant} data-edge={edge} inert={state?.isExpanded === false}>
      {children}
    </div>
  );
}

/** Props for DisclosureGroup. */
export interface DisclosureGroupProps {
  readonly children: ReactNode;
  /** Lets several sections be open at once; otherwise opening one closes the others. */
  readonly allowsMultipleExpanded?: boolean;
  readonly defaultExpandedKeys?: Iterable<string>;
}

/** A stack of Disclosures, one open at a time unless `allowsMultipleExpanded`. */
export function DisclosureGroup({
  children,
  allowsMultipleExpanded = false,
  defaultExpandedKeys,
}: DisclosureGroupProps) {
  return (
    <AriaDisclosureGroup
      className={styles.group}
      allowsMultipleExpanded={allowsMultipleExpanded}
      {...(defaultExpandedKeys === undefined ? {} : { defaultExpandedKeys })}
    >
      {children}
    </AriaDisclosureGroup>
  );
}
