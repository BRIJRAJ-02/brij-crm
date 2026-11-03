// The business page's menu (spec 0066, AC-6642; the menu itself is spec 0065 H1's): each section's heading over its
// items, an item's name and price on one line and its description under it. Read only here: ordering is the Menu
// app's own page. Draws nothing for a menu with no items.
import styles from './BusinessMenu.module.css';

/** One section of the menu, as the published snapshot has it. */
export interface BusinessMenuSection {
  readonly name: string;
  readonly items: readonly {
    readonly name: string;
    readonly description?: string | undefined;
    /** Already in the place's currency and language ("₹450"). */
    readonly price?: string | undefined;
  }[];
}

/** Props for BusinessMenu. */
export interface BusinessMenuProps {
  readonly sections: readonly BusinessMenuSection[];
  /** The heading level a section's name takes under the page's own section heading. */
  readonly headingLevel?: 3 | 4;
}

/** The menu's sections, each a list of its items. */
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
            {section.items.map((item) => (
              <li key={item.name} className={styles.item}>
                <span className={styles.line}>
                  <span className={styles.name}>{item.name}</span>
                  {item.price !== undefined && <span className={styles.price}>{item.price}</span>}
                </span>
                {item.description !== undefined && <span className={styles.description}>{item.description}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
