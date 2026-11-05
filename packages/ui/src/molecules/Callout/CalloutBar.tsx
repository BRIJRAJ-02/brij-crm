import { Callout, type CalloutProps } from './Callout.tsx';
import styles from './CalloutBar.module.css';

/**
 * A Callout in a toolbar: no fill or edge, only its tone's colour on the icon and words, one line that gives way before
 * the bar's tools do (Live updates paused). Apart from Callout so its styles load only where a bar draws one: a public
 * page never does.
 */
export function CalloutBar(props: Omit<CalloutProps, 'placement' | 'barStyles'>) {
  return <Callout {...props} barStyles={styles} />;
}
