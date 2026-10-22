import { Button, ButtonLink, Icon, Modal, ModalTrigger } from '@crm/ui';
import type { FeatureGroup } from '../../features.ts';
import { LINKS } from '../../site.ts';
import styles from './AllFeatures.module.css';

/** Props for AllFeatures. */
export interface AllFeaturesProps {
  readonly groups: readonly FeatureGroup[];
}

const sectionId = (group: FeatureGroup) => `all-features-${group.id}`;

/** Scrolls the sheet to the area and puts focus on it, so the keyboard carries on from there. */
function jumpTo(group: FeatureGroup) {
  const section = document.getElementById(sectionId(group));
  if (section === null) return;
  section.scrollIntoView({ block: 'start' });
  section.focus({ preventScroll: true });
}

/**
 * Every feature, one click away: a quiet button that opens the library's Modal (the `window` variant), laid out as
 * the app's settings page is: the areas down the left as quiet rows, each a jump to its section on the right, where
 * every feature is a checked row. The title bar counts them, and the foot holds Close and the one call to action.
 * The Modal brings focus in and holds it, Escape and a click outside, the enter and exit motion, and the return of
 * focus to the trigger.
 */
export function AllFeatures({ groups }: AllFeaturesProps) {
  const total = groups.reduce((sum, group) => sum + group.features.length, 0);
  return (
    <ModalTrigger>
      <Button variant="ghost" icon="layout-grid">
        All features
      </Button>
      <Modal
        variant="window"
        isWide
        title="Everything in Timefix"
        icon="layout-grid"
        context={`${total} features, all live today`}
        actions={
          <>
            <Button slot="close" kbd="ESC">
              Close
            </Button>
            <ButtonLink href={LINKS.getStarted} variant="primary" iconRight="arrow-right">
              Claim your page
            </ButtonLink>
          </>
        }
      >
        <div className={styles.sheet}>
          <div className={styles.layout}>
            <nav className={styles.nav} aria-label="Areas">
              {groups.map((group) => (
                <Button key={group.id} variant="ghost" icon={group.icon} isFullWidth onPress={() => jumpTo(group)}>
                  {group.title}
                </Button>
              ))}
            </nav>
            <div className={styles.sections}>
              {groups.map((group) => (
                <section
                  className={styles.section}
                  key={group.id}
                  id={sectionId(group)}
                  tabIndex={-1}
                  aria-labelledby={`${sectionId(group)}-title`}
                >
                  <h3 className={styles.sectionTitle} id={`${sectionId(group)}-title`}>
                    <Icon name={group.icon} tile={group.hue} />
                    <span className={styles.sectionLabel}>{group.title}</span>
                    <span className={styles.sectionCount}>{group.features.length}</span>
                  </h3>
                  <ul className={styles.features}>
                    {group.features.map((feature) => (
                      <li className={styles.feature} key={feature}>
                        <Icon name="check" size="xs" tone="muted" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </ModalTrigger>
  );
}
