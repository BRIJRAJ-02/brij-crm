import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { SlotList } from '../SlotList/SlotList.tsx';
import styles from './BookingChatGhost.module.css';

/** How many time boxes the ghost holds: the six the greeting offers. */
const GHOST_TIMES = 6;

const ignore = () => undefined;

/**
 * Book by chat's shape while the page's times load (4 November 2026): the greeting's bubble, a day's label over a
 * few times (SlotList's own offers, loading) and the prompt box at the foot, each where the loaded chat puts it, so
 * the times fill in rather than arriving into an empty card. Small and in the page's first load, unlike BookingChat,
 * which loads on its own.
 */
export function BookingChatGhost() {
  // Two parts, as the chat's own (its thread, its prompt box), straight into the view's column: the thread takes the
  // room, the box stands at the foot.
  return (
    <>
      <div className={styles.thread} aria-busy="true">
        <div className={styles.bubble}>
          <Skeleton shape="fill" />
        </div>
        <SlotList
          variant="offers"
          layout="grid"
          heading=""
          slots={[]}
          value={undefined}
          onChange={ignore}
          isLoading
          ghosts={GHOST_TIMES}
        />
      </div>
      <div className={styles.composer}>
        <Skeleton shape="fill" />
      </div>
    </>
  );
}
