import { Icon } from '@crm/ui';
import type { FeatureGroup } from '../../features.ts';
import styles from './AllFeatures.module.css';

/** Props for AllFeatures. */
export interface AllFeaturesProps {
  readonly groups: readonly FeatureGroup[];
}

const PANEL_ID = 'all-features';

/**
 * Every feature, one click away: a quiet button that opens a panel listing each area and what it holds. A native
 * popover (no script): the button opens and closes it, Escape or a click outside closes it, and its content follows
 * the button in the tab order.
 */
export function AllFeatures({ groups }: AllFeaturesProps) {
  return (
    <>
      <button className={styles.trigger} type="button" popoverTarget={PANEL_ID}>
        All features
        <Icon name="arrow-up-right" size="xs" />
      </button>
      <div className={styles.panel} id={PANEL_ID} popover="auto" role="dialog" aria-labelledby={`${PANEL_ID}-title`}>
        <div className={styles.header}>
          <h2 className={styles.title} id={`${PANEL_ID}-title`}>
            Everything in Timefix
          </h2>
          <button
            className={styles.close}
            type="button"
            popoverTarget={PANEL_ID}
            popoverTargetAction="hide"
            aria-label="Close"
          >
            <Icon name="x" size="sm" />
          </button>
        </div>
        <div className={styles.groups}>
          {groups.map((group) => (
            <section className={styles.group} key={group.id} aria-labelledby={`${PANEL_ID}-${group.id}`}>
              <h3 className={styles.groupTitle} id={`${PANEL_ID}-${group.id}`}>
                <Icon name={group.icon} tile={group.hue} />
                {group.title}
              </h3>
              <ul className={styles.features}>
                {group.features.map((feature) => (
                  <li className={styles.feature} key={feature}>
                    {feature}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
