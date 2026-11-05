import styles from './TouchTarget.module.css';

/**
 * Button's `touchTarget`: drawn small, pressed across 44px, with nothing drawn changing (a guest's thumb on the guest
 * menu's + and steppers). A class from its own stylesheet, so only a page that draws such a button loads it.
 */
export const TOUCH_TARGET = styles.root ?? '';
