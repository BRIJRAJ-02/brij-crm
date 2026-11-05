import { SlotList, type SlotListProps } from './SlotList.tsx';
import styles from './SlotListGroups.module.css';

/**
 * SlotList's `groups`: the times under their small headings (a restaurant's Lunch and Dinner, spec 0066 B7), in one list
 * that scrolls as one, three across. Apart from SlotList so its styles load only where it is drawn.
 */
export function SlotListGroups(props: Omit<SlotListProps, 'look'>) {
  return <SlotList {...props} look={styles} />;
}
