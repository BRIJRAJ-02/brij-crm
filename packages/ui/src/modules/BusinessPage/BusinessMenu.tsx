// The business page's menu (spec 0066, AC-6642; the menu itself is spec 0065 H1's): each section's heading over its
// dishes as the guest menu draws them (5 November 2026, after checklabs): a row a dish, its name, its description on
// two lines at most and its price under them, and its photo at the row's end when it has one. Read only here:
// ordering is the Menu app's own page. Draws nothing for a menu with no items.
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import styles from './BusinessMenu.module.css';
import { strings } from './strings.ts';

/** One section of the menu, as the published snapshot has it. */
export interface BusinessMenuSection {
  readonly name: string;
  readonly items: readonly {
    readonly name: string;
    readonly description?: string | undefined;
    /** Already in the place's currency and language ("₹450"). */
    readonly price?: string | undefined;
    /** The dish's small photo on our own origin (the guest menu's), when it has one. */
    readonly photo?: string | undefined;
  }[];
}

/** Props for BusinessMenu. */
export interface BusinessMenuProps {
  readonly sections: readonly BusinessMenuSection[];
  /** The heading level a section's name takes under the page's own section heading. */
  readonly headingLevel?: 3 | 4;
}

/** The menu's sections, each a list of its dishes as the guest menu's rows. */
export function BusinessMenu({ sections, headingLevel = 3 }: BusinessMenuProps) {
  const shown = sections.filter((section) => section.items.length > 0);
  if (shown.length === 0) return null;
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <div className={styles.root}>
      {shown.map((section) => (
        <section key={section.name} className={styles.section}>
          <Heading className={styles.heading}>{section.name}</Heading>
          <ul className={styles.items}>
            {section.items.map((item) => {
              const photo = item.photo === undefined ? undefined : safeImageSrc(item.photo);
              return (
                <li key={item.name} className={styles.item}>
                  <span className={styles.words}>
                    <span className={styles.name}>{item.name}</span>
                    {item.description !== undefined && <span className={styles.description}>{item.description}</span>}
                    {item.price !== undefined && <span className={styles.price}>{item.price}</span>}
                  </span>
                  {/* The dish's name beside it says what it is: the photo is decoration. */}
                  {photo !== undefined && (
                    <img
                      className={styles.photo}
                      src={photo}
                      alt={strings.decorative}
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
