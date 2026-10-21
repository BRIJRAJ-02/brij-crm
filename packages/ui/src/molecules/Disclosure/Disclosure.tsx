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
  readonly isExpanded?: boolean;
  readonly defaultExpanded?: boolean;
  readonly onExpandedChange?: (isExpanded: boolean) => void;
  readonly isDisabled?: boolean;
  /**
   * `label` draws the title as a sidebar section label: 11px, quiet, its
   * chevron after it. `fields` stacks the panel's content `space-16` apart, as
   * a Form stacks its fields, for more fields folded inside a form ("Add more
   * fields" in a create dialog).
   */
  readonly variant?: 'default' | 'label' | 'fields';
  /**
   * Quiet controls after the title, outside its toggle (a sidebar section's
   * grip and its menu, spec 0034). In the `label` variant they show while the
   * row is hovered or holds focus, and always to the keyboard.
   */
  readonly actions?: ReactNode;
}

/** A section that opens and closes under its title: attribute groups, advanced settings, sidebar sections. */
export function Disclosure({
  title,
  children,
  id,
  count,
  isExpanded,
  defaultExpanded,
  onExpandedChange,
  isDisabled,
  variant = 'default',
  actions,
}: DisclosureProps) {
  // Directly in a settings page's body, the title row runs to the page's edges, its chevron on the content edge.
  const atPageEdge = useContext(PageEdge) && variant === 'default';
  // At the page edge its title is a heading at the level a card's title takes there (an h2 right under a
  // settings page's TopBar), so headings never skip a level; anywhere else an h3, as before.
  const level = useContext(CardTitleLevel);
  const heading = (
    <Heading className={styles.heading} level={atPageEdge ? level : 3}>
      <AriaButton slot="trigger" className={styles.trigger}>
        <span className={styles.chevron}>
          <Icon name="chevron-right" size={variant === 'label' ? 'xs' : 'sm'} />
        </span>
        <span className={styles.title}>{title}</span>
        {count !== undefined && <Badge count={count} />}
      </AriaButton>
    </Heading>
  );
  return (
    <AriaDisclosure
      className={styles.root}
      data-variant={variant}
      data-edge={atPageEdge ? 'page' : undefined}
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
        <PanelContent>{children}</PanelContent>
      </DisclosurePanel>
    </AriaDisclosure>
  );
}

/** The panel's content, inert while folded, so links and fields inside it take no focus. */
function PanelContent({ children }: { readonly children: ReactNode }) {
  const state = useContext(DisclosureStateContext);
  return (
    <div className={styles.content} inert={state?.isExpanded === false}>
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
