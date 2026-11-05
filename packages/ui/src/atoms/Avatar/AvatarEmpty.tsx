import { Avatar, type AvatarProps } from './Avatar.tsx';
import styles from './AvatarEmpty.module.css';

/**
 * An Avatar that is an empty slot: no fill, a dashed control edge, the mark in the quiet text colour, inside the tile's
 * own size so a row keeps its line (a menu item with no photo yet). Apart from Avatar so its styles load only where it
 * is drawn.
 */
export function AvatarEmpty(props: Omit<AvatarProps, 'emptyClass'>) {
  return <Avatar {...props} emptyClass={styles.root ?? ''} />;
}
