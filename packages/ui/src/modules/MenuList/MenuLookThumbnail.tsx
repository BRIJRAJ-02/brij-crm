// A guest look as a small picture of itself (spec 0065, AC-6570 as amended), for a preset's tile on the Design page:
// the look's ground, a heading in its face, a price in its highlight and a button in its accent. It draws from the same
// custom properties the guest menu does, set on its own root, so a tile can't drift from what guests see.
import { usePageVariables, type PageVariables } from '../../lib/page-variables.ts';
import { checkedLookVariables } from './look-variables.ts';
import '@crm/tokens/packs.css';
import styles from './MenuLookThumbnail.module.css';
import { strings } from './strings.ts';

/** Props for MenuLookThumbnail. */
export interface MenuLookThumbnailProps {
  /** The look's custom properties, as `menuLookShape` and `menuLookColours` make them. */
  readonly variables: PageVariables;
  /** The side the picture draws on, so a dark preset is dark in a light app. */
  readonly scheme: 'light' | 'dark';
}

/** A look's tile: decoration, since the tile's own name says which look it is. */
export function MenuLookThumbnail({ variables, scheme }: MenuLookThumbnailProps) {
  const ref = usePageVariables(variables, checkedLookVariables);
  return (
    <span ref={ref} className={styles.root} data-theme={scheme} aria-hidden="true">
      <span className={styles.heading}>{strings.thumbnailHeading}</span>
      <span className={styles.words} />
      <span className={styles.foot}>
        <span className={styles.price}>{strings.thumbnailPrice}</span>
        <span className={styles.button} />
      </span>
    </span>
  );
}
