import type { FormStrings } from '@crm/contracts/forms';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { DragHandle } from '../atoms/DragHandle/DragHandle.tsx';
import { VisuallyHidden } from '../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { FieldGroup } from '../molecules/FieldGroup/FieldGroup.tsx';
import styles from './RankingQuestion.module.css';

/** Props for RankingQuestion. */
export interface RankingQuestionProps {
  readonly questionKey: string;
  /** The question's label, with its "(optional)" aside when it has one. */
  readonly label: string;
  readonly words: FormStrings;
  /** The question's choices, in the order the form gives them. */
  readonly choices: readonly string[];
  /** The visitor's order once they have moved anything; until then the form's order shows, and nothing is answered. */
  readonly value: unknown;
  readonly error: string | undefined;
  readonly onChange: (order: readonly string[]) => void;
}

/** A row on its way: which, and the place it would land at (an index into the order). */
interface Lift {
  readonly id: string;
  readonly to: number;
}

/** `order` with `id` moved to index `to`, the others closing up around it. */
function moved(order: readonly string[], id: string, to: number): readonly string[] {
  const rest = order.filter((each) => each !== id);
  return [...rest.slice(0, to), id, ...rest.slice(to)];
}

/** Where a pointer at `y` would drop the row, by the middles of the other rows. */
function dropAt(middles: readonly { readonly id: string; readonly middle: number }[], id: string, y: number): number {
  const others = middles.filter((row) => row.id !== id);
  const at = others.findIndex((row) => y < row.middle);
  return at === -1 ? others.length : at;
}

/**
 * A hosted form's Ranking question (spec 0063, AC-6307, AC-6308): the choices as an ordered list the visitor sorts by
 * dragging a row's grip, or from the keyboard (Space or Enter on a grip picks it up, the arrows move it, Space or
 * Enter drops it, Escape puts it back), each move said aloud. A line marks where the row lands. The answer is the
 * whole order, first is most.
 *
 * Why the grip drives the move itself (DragHandle's `manual` variant, as the sidebar's sections do) rather than
 * through the drag wrapper: the wrapper brings dnd-kit, about 18 kB gzipped, four times this chunk's 6 kB budget, to
 * a page every visitor loads; a list of a few rows needs only its middles.
 */
export function RankingQuestion({ questionKey, label, words, choices, value, error, onChange }: RankingQuestionProps) {
  const offered = choices.filter((choice) => choice.trim() !== '');
  const held = Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];
  // The visitor's order while it still names exactly the form's choices; else the form's own.
  const order = held.length === offered.length && held.every((each) => offered.includes(each)) ? held : offered;
  const count = order.length;
  const isAnswered = order === held;
  const [lift, setLift] = useState<Lift | undefined>(undefined);
  const [said, setSaid] = useState('');
  const helpId = useId();
  const list = useRef<HTMLOListElement>(null);
  // After a drop the moved row's grip keeps focus (React moving its row can drop it).
  const refocus = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const id = refocus.current;
    if (id === undefined) return;
    refocus.current = undefined;
    list.current?.querySelector<HTMLElement>(`[data-ranking-row="${CSS.escape(id)}"] button`)?.focus();
  });
  // Rows glide from where they were to where they are after an order changes; at once under reduced motion.
  const places = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const box = list.current;
    if (box === null) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const style = getComputedStyle(box);
    const duration = Number.parseFloat(style.getPropertyValue('--duration-move'));
    const easing = style.getPropertyValue('--ease-in-out').trim();
    for (const row of box.querySelectorAll<HTMLElement>('[data-ranking-row]')) {
      const id = row.dataset.rankingRow ?? '';
      const top = row.offsetTop;
      const before = places.current.get(id);
      places.current.set(id, top);
      if (still || before === undefined || before === top || !Number.isFinite(duration)) continue;
      row.animate([{ transform: `translateY(${String(before - top)}px)` }, { transform: 'none' }], {
        duration,
        ...(easing === '' ? {} : { easing }),
      });
    }
  }, [order]);
  // A pointer drag that outlives the question ends with it.
  const dragEnd = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => {
      dragEnd.current?.();
    },
    [],
  );

  const drop = (id: string, to: number) => {
    setLift(undefined);
    // A drop where it was still answers: the visitor has looked at the order and kept it.
    if (order.indexOf(id) !== to) refocus.current = id;
    onChange(moved(order, id, to));
    setSaid(words.moveDropped(id, to + 1, count));
  };

  const keys = (id: string) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const from = order.indexOf(id);
    const key = event.key;
    if (lift?.id !== id) {
      if (key !== ' ' && key !== 'Enter') return;
      event.preventDefault();
      setLift({ id, to: from });
      setSaid(words.moveLifted(id, from + 1, count));
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      const to = Math.min(Math.max(lift.to + (key === 'ArrowUp' ? -1 : 1), 0), count - 1);
      setLift({ id, to });
      setSaid(words.movePlace(id, to + 1, count));
      return;
    }
    if (key === ' ' || key === 'Enter') {
      event.preventDefault();
      drop(id, lift.to);
      return;
    }
    if (key === 'Escape' || key === 'Tab') {
      if (key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
      setLift(undefined);
      setSaid(words.moveCancelled(id, from + 1, count));
    }
  };

  const pointer = (id: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || lift !== undefined) return;
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('[data-ranking-row]') ?? [])];
    const middles = rows.map((row) => {
      const box = row.getBoundingClientRect();
      return { id: row.dataset.rankingRow ?? '', middle: box.top + box.height / 2 };
    });
    event.preventDefault();
    let to = order.indexOf(id);
    setLift({ id, to });
    // Middles as measured at the grab, kept against the page, so a scroll during the drag still lands right.
    const scrolled = window.scrollY;
    const move = (moving: PointerEvent) => {
      const next = dropAt(middles, id, moving.clientY + window.scrollY - scrolled);
      if (next === to) return;
      to = next;
      setLift({ id, to });
    };
    const stop = () => {
      dragEnd.current = undefined;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape, true);
    };
    const up = () => {
      stop();
      drop(id, to);
    };
    const cancel = () => {
      stop();
      setLift(undefined);
    };
    const escape = (pressed: globalThis.KeyboardEvent) => {
      if (pressed.key !== 'Escape') return;
      pressed.preventDefault();
      pressed.stopPropagation();
      cancel();
    };
    dragEnd.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape, true);
  };

  // The line goes before the row the lifted one would land at when it moves up, after it when it moves down.
  const from = lift === undefined ? -1 : order.indexOf(lift.id);
  const lineOf = (index: number): 'before' | 'after' | undefined => {
    if (lift === undefined || lift.to === from || index !== lift.to) return undefined;
    return lift.to < from ? 'before' : 'after';
  };

  return (
    <FieldGroup label={label} {...(error === undefined ? {} : { error })}>
      <ol ref={list} className={styles.list} data-question-ranking={questionKey}>
        {order.map((choice, index) => (
          <li
            key={choice}
            className={styles.row}
            data-ranking-row={choice}
            data-lifted={lift?.id === choice || undefined}
            data-drop={lineOf(index)}
          >
            <DragHandle
              label={words.moveItem(choice)}
              manual={{
                isLifted: lift?.id === choice,
                describedBy: helpId,
                onKeyDown: keys(choice),
                onPointerDown: pointer(choice),
                onBlur: () => {
                  if (lift?.id === choice && dragEnd.current === undefined) setLift(undefined);
                },
              }}
            />
            {/* Unranked until the visitor makes the order theirs (critique c, 9): a number before then read as an
                answer they never gave. The place keeps its width, so nothing moves when the numbers come. */}
            <span className={styles.place} data-answered={isAnswered || undefined} aria-hidden="true">
              {isAnswered ? index + 1 : ''}
            </span>
            <span>{choice}</span>
          </li>
        ))}
      </ol>
      <VisuallyHidden id={helpId}>{words.moveHelp}</VisuallyHidden>
      <VisuallyHidden>
        <span aria-live="polite">{said}</span>
      </VisuallyHidden>
    </FieldGroup>
  );
}
