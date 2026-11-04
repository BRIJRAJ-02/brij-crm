// Spec 0068's stageshow demos (AC-6807): one key interaction each, on one surface at one size, playing on a loop,
// made from the library's own parts so what is filmed is what ships. A guest picks a time and sees the booking
// confirmed; an item sheet opens, a size is picked and the price pops; Publish turns into Published and the guest
// view updates. Stories only: never exported from the library's index, never in an app.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { NumberPop } from '../../atoms/NumberPop/NumberPop.tsx';
import { SuccessCheck } from '../../atoms/SuccessCheck/SuccessCheck.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import styles from './MotionDemos.module.css';
import { strings } from './strings.ts';

/** One beat of a demo's script: what the scene becomes, where the pointer goes, and how long it holds. */
interface Beat<Scene> {
  readonly scene: Scene;
  /** The element the pointer travels to, by its `data-target`; absent leaves it where it is. */
  readonly to?: string;
  /** Where across the target the pointer lands, 0 at its start to 1 at its end; absent is its middle. */
  readonly across?: number;
  /** The pointer presses as the beat begins. */
  readonly press?: boolean;
  /** How long the beat holds before the next, in milliseconds. */
  readonly hold: number;
}

/** Props every demo takes. */
export interface MotionDemoProps {
  /** Holds the demo on one beat (its poster, or a frame a story films); absent plays the loop. */
  readonly beat?: number;
}

/** Where the pointer sits over the stage, from the target's box: its centre, a touch down and right. */
function pointerAt(stage: HTMLElement, target: string, across = 0.5): { x: number; y: number } | undefined {
  const found = stage.querySelector(`[data-target="${target}"]`);
  if (found === null) return undefined;
  const box = found.getBoundingClientRect();
  const frame = stage.getBoundingClientRect();
  return { x: box.left - frame.left + box.width * across, y: box.top - frame.top + box.height / 2 };
}

/**
 * Plays a script on a loop: each beat's scene, the pointer moving to its target and pressing, then its hold. Under
 * reduced motion, and with `beat` given, it stays on one beat: the poster tells the story on its own.
 */
function useScript<Scene>(
  beats: readonly Beat<Scene>[],
  poster: number,
  held: number | undefined,
): { scene: Scene; stageRef: RefObject<HTMLDivElement | null>; pointer: ReactNode } {
  const stageRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(held ?? 0);
  const [point, setPoint] = useState<{ x: number; y: number; pressed: boolean } | undefined>(undefined);
  const isStill =
    held !== undefined ||
    (typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const shown = isStill ? (held ?? poster) : at;
  const beat = beats[shown] ?? beats[0];
  useEffect(() => {
    if (isStill || beat === undefined) return undefined;
    const timer = globalThis.setTimeout(() => {
      setAt((was) => (was + 1) % beats.length);
    }, beat.hold);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [isStill, beat, beats.length]);
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null || beat === undefined) return;
    // With no target the pointer rests in the stage's lower right, out of the story's way, and travels in from there.
    const next =
      beat.to === undefined
        ? { x: stage.clientWidth * 0.82, y: stage.clientHeight * 0.88 }
        : pointerAt(stage, beat.to, beat.across);
    if (next !== undefined) setPoint({ ...next, pressed: beat.press === true });
  }, [beat]);
  if (beat === undefined) throw new Error('A demo has at least one beat.');
  const pointer =
    point === undefined || isStill ? null : (
      <span
        className={styles.pointer}
        data-pressed={point.pressed || undefined}
        style={{ '--pointer-x': `${String(point.x)}px`, '--pointer-y': `${String(point.y)}px` }}
        aria-hidden="true"
      >
        <Icon name="mouse-pointer-2" size="md" />
      </span>
    );
  return { scene: beat.scene, stageRef, pointer };
}

/** A demo's stage: its surface at one size, its pointer above it, and a name for screen readers. */
function DemoStage({
  label,
  stageRef,
  pointer,
  children,
}: {
  readonly label: string;
  readonly stageRef: RefObject<HTMLDivElement | null>;
  readonly pointer: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <figure className={styles.stage} aria-label={label}>
      <div ref={stageRef} className={styles.surface} inert>
        {children}
        {pointer}
      </div>
    </figure>
  );
}

/** The booking demo's scenes: picking, picked, confirmed. */
type BookScene = 'pick' | 'picked' | 'booked';

const BOOK_BEATS: readonly Beat<BookScene>[] = [
  { scene: 'pick', hold: 700 },
  { scene: 'pick', to: 'time-2', hold: 900 },
  { scene: 'picked', to: 'time-2', press: true, hold: 900 },
  { scene: 'picked', to: 'confirm', hold: 800 },
  { scene: 'booked', to: 'confirm', press: true, hold: 2600 },
];

/** (a) A guest picks a time and sees the booking confirmed. */
export function BookDemo({ beat }: MotionDemoProps) {
  const { scene, stageRef, pointer } = useScript(BOOK_BEATS, 4, beat);
  const times = strings.times;
  return (
    <DemoStage label={strings.bookLabel} stageRef={stageRef} pointer={pointer}>
      <div className={styles.card}>
        <span className={styles.eyebrow}>{strings.bookPage}</span>
        {scene === 'booked' ? (
          <div key="booked" className={styles.done}>
            <SuccessCheck size="lg" />
            <span className={styles.title}>{strings.booked}</span>
            <span className={styles.quiet}>{strings.bookedWhen}</span>
          </div>
        ) : (
          <div key="pick" className={styles.body}>
            <span className={styles.title}>{strings.pickTime}</span>
            <div className={styles.times}>
              {times.map((time, at) => (
                <span
                  key={time}
                  className={styles.time}
                  data-target={`time-${String(at + 1)}`}
                  data-chosen={(scene === 'picked' && at === 1) || undefined}
                >
                  {time}
                </span>
              ))}
            </div>
          </div>
        )}
        <span className={styles.foot} data-target="confirm">
          <Button variant="primary" size="touch" isFullWidth="center" isDisabled={scene === 'pick'}>
            {scene === 'booked' ? strings.bookedButton : strings.confirm}
          </Button>
        </span>
      </div>
    </DemoStage>
  );
}

/** The item sheet demo's scenes: the menu, the sheet open, a size picked. */
type SheetScene = 'menu' | 'open' | 'large';

const SHEET_BEATS: readonly Beat<SheetScene>[] = [
  { scene: 'menu', hold: 600 },
  { scene: 'menu', to: 'item', hold: 800 },
  { scene: 'open', to: 'item', press: true, hold: 1300 },
  // Large is the control's second half: the pointer lands on it, never between the two.
  { scene: 'open', to: 'size', across: 0.75, hold: 700 },
  { scene: 'large', to: 'size', across: 0.75, press: true, hold: 2400 },
];

/** (b) An item sheet opens, a size is picked, the price pops. */
export function SheetDemo({ beat }: MotionDemoProps) {
  const { scene, stageRef, pointer } = useScript(SHEET_BEATS, 4, beat);
  const price = scene === 'large' ? strings.priceLarge : strings.priceRegular;
  return (
    <DemoStage label={strings.sheetLabel} stageRef={stageRef} pointer={pointer}>
      <div className={styles.menu}>
        <span className={styles.eyebrow}>{strings.menuSection}</span>
        <span className={styles.item} data-target="item">
          <span className={styles.dish} aria-hidden="true" />
          <span className={styles.itemWords}>
            <span className={styles.rowTitle}>{strings.dish}</span>
            <span className={styles.quiet}>{strings.dishLine}</span>
          </span>
          <span className={styles.rowTitle}>{strings.priceRegular}</span>
        </span>
        <span className={styles.item} data-dim="">
          <span className={styles.dish} aria-hidden="true" />
          <span className={styles.itemWords}>
            <span className={styles.rowTitle}>{strings.otherDish}</span>
          </span>
        </span>
        <div className={styles.sheet} data-open={scene !== 'menu' || undefined}>
          <span className={styles.title}>{strings.dish}</span>
          <span data-target="size">
            <SegmentedControl
              label={strings.size}
              segments={[
                { value: 'regular', label: strings.regular },
                { value: 'large', label: strings.large },
              ]}
              value={scene === 'large' ? 'large' : 'regular'}
            />
          </span>
          <span className={styles.price}>
            <NumberPop value={price} />
          </span>
        </div>
      </div>
    </DemoStage>
  );
}

/** The publish demo's scenes: one change waiting, publishing, published. */
type PublishScene = 'draft' | 'published';

const PUBLISH_BEATS: readonly Beat<PublishScene>[] = [
  { scene: 'draft', hold: 600 },
  { scene: 'draft', to: 'publish', hold: 900 },
  { scene: 'published', to: 'publish', press: true, hold: 2800 },
];

/** (c) Publish turns into Published, and the guest view updates beside it. */
export function PublishDemo({ beat }: MotionDemoProps) {
  const { scene, stageRef, pointer } = useScript(PUBLISH_BEATS, 2, beat);
  const isPublished = scene === 'published';
  return (
    <DemoStage label={strings.publishLabel} stageRef={stageRef} pointer={pointer}>
      <div className={styles.split}>
        <div className={styles.editor}>
          <span className={styles.bar}>
            <span className={styles.quiet}>{isPublished ? strings.upToDate : strings.oneChange}</span>
            <span data-target="publish">
              <Button variant={isPublished ? 'secondary' : 'primary'} icon={isPublished ? 'check' : 'upload'}>
                {isPublished ? strings.published : strings.publish}
              </Button>
            </span>
          </span>
          <span className={styles.field}>
            <span className={styles.quiet}>{strings.length}</span>
            <span className={styles.rowTitle}>{strings.newLength}</span>
          </span>
        </div>
        <div className={styles.guest}>
          <span className={styles.eyebrow}>{strings.guestView}</span>
          <span className={styles.card} data-small="">
            <span className={styles.rowTitle}>{strings.guestTitle}</span>
            <span key={scene} className={styles.fact} data-changed={isPublished || undefined}>
              {isPublished ? strings.newLength : strings.oldLength}
            </span>
          </span>
        </div>
      </div>
    </DemoStage>
  );
}
