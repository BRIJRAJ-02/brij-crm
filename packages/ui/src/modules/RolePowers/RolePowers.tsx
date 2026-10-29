import type { ReactNode } from 'react';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { Disclosure, DisclosureGroup } from '../../molecules/Disclosure/Disclosure.tsx';
import styles from './RolePowers.module.css';
import { strings } from './strings.ts';

/** How much of an area a role holds. */
export type RolePowerStanding = 'all' | 'some' | 'none';

/** One area of powers ("Forms and booking"), with what the role holds of it and what it doesn't. */
export interface RolePowerArea {
  readonly id: string;
  readonly title: string;
  readonly standing: RolePowerStanding;
  /** The powers held, in plain words ("Build, publish and pause forms"). */
  readonly held: readonly string[];
  /** The powers not held, so "what can't they do" is answerable too. */
  readonly withheld: readonly string[];
}

/** Props for RolePowers. */
export interface RolePowersProps {
  /** What the list is ("What an Admin can do"). */
  readonly label: string;
  /** For a control that opens it (`aria-controls`). */
  readonly id?: string;
  /** Goes first, above the summary: the role switch that picks which role is shown. */
  readonly header?: ReactNode;
  /** One line above the areas: what everyone can do whatever their role. */
  readonly summary?: string;
  readonly areas: readonly RolePowerArea[];
  /** Draws skeleton rows while the role is read. */
  readonly isLoading?: boolean;
}

const ICON: Readonly<Record<RolePowerStanding, IconName>> = {
  all: 'circle-check',
  some: 'circle-dot',
  none: 'minus',
};

/**
 * What a role lets someone do, area by area: each area one row with its standing (All, Some, None), opening to the
 * powers it holds and the ones it doesn't. Six rows rather than every permission, the detail one press away.
 */
export function RolePowers({ label, id, header, summary, areas, isLoading = false }: RolePowersProps) {
  if (isLoading) {
    return (
      <div className={styles.root} id={id} aria-label={strings.loading} aria-busy="true" role="group">
        {header}
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} width="long" />
        ))}
      </div>
    );
  }
  return (
    <section className={styles.root} id={id} aria-label={label}>
      {header}
      {summary !== undefined && <p className={styles.summary}>{summary}</p>}
      <DisclosureGroup allowsMultipleExpanded>
        {areas.map((area) => (
          <Disclosure
            key={area.id}
            id={area.id}
            title={area.title}
            headingLevel={4}
            leading={
              <span className={styles.mark} data-standing={area.standing}>
                <Icon name={ICON[area.standing]} size="sm" />
                {/* Inside the toggle, so the row's own name carries its standing ("Some, Records"); the Badge after
                    it sits outside the button. */}
                <VisuallyHidden>{strings.standingSpoken(strings.standing[area.standing])}</VisuallyHidden>
              </span>
            }
            actions={<Badge text={strings.standing[area.standing]} isWhole />}
          >
            <ul className={styles.powers}>
              {area.held.map((power) => (
                <li key={power} className={styles.power}>
                  <Icon name="check" size="sm" tone="success" />
                  {power}
                </li>
              ))}
              {area.withheld.map((power) => (
                <li key={power} className={styles.power} data-withheld="">
                  <Icon name="minus" size="sm" tone="muted" />
                  <VisuallyHidden>{strings.cannot}</VisuallyHidden>
                  {power}
                </li>
              ))}
            </ul>
          </Disclosure>
        ))}
      </DisclosureGroup>
    </section>
  );
}
