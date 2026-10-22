import { Button, Icon, SegmentedControl } from '@crm/ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { slideSrc, type ShowcaseArea } from '../../showcase.ts';
import styles from './Slides.module.css';

/** Props for Slides. */
export interface SlidesProps {
  readonly area: ShowcaseArea;
  /** The first area on the page: its first screen loads with the page, ahead of everything else. */
  readonly isFirst: boolean;
  /** Called when the play has shown the last screen for its time: the showcase moves on to the next area. */
  readonly onEnd?: () => void;
}

/** How long each screen stays before the next. */
const DWELL_MS = 4000;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Whether the reader asked for reduced motion; false on the server and until hydrated. */
function useReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const motion = window.matchMedia(REDUCED_MOTION);
      motion.addEventListener('change', onChange);
      return () => motion.removeEventListener('change', onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/** Whether the page is hidden (another tab, a minimised window); false on the server. */
function usePageHidden() {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
    () => document.visibilityState === 'hidden',
    () => false,
  );
}

/**
 * An area's screens in the app's window, playing in turn: the bar holds the lights and the address of the screen on
 * show; a glass pill floating at the foot holds a segment per screen (the library's SegmentedControl, so the arrow
 * keys move between them) and a pause. The screens are stacked, whole, cross fading, and the window fades out at
 * its foot (the owner, 23 October 2026: nothing cut, faded). The play stops while the pointer or focus is on the window, while the
 * page is hidden, when paused, and for anyone who asked for reduced motion.
 */
export function Slides({ area, isFirst, onEnd }: SlidesProps) {
  const [current, setCurrent] = useState(area.slides[0]?.id ?? '');
  const [isPaused, setIsPaused] = useState(false);
  const [isHeld, setIsHeld] = useState(false);
  // A screen that failed to load is skipped by the play, so the window never sits empty.
  const [broken, setBroken] = useState<readonly string[]>([]);
  const isStill = usePageHidden();
  const isReduced = useReducedMotion();

  const isPlaying = !isPaused && !isHeld && !isStill && !isReduced && area.slides.length > 1;

  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = window.setTimeout(() => {
      const index = area.slides.findIndex((slide) => slide.id === current);
      // The next screen after this one, or, past the last, the next area.
      const next = area.slides.slice(index + 1).find((slide) => !broken.includes(slide.id));
      if (next === undefined) onEnd?.();
      else setCurrent(next.id);
    }, DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [isPlaying, area.slides, current, broken, onEnd]);

  const shown = area.slides.find((slide) => slide.id === current) ?? area.slides[0];

  return (
    <figure
      className={styles.window}
      onPointerEnter={() => setIsHeld(true)}
      onPointerLeave={() => setIsHeld(false)}
      onFocus={() => setIsHeld(true)}
      onBlur={() => setIsHeld(false)}
    >
      <div className={styles.frame}>
        <div className={styles.bar}>
          <span className={styles.lights} aria-hidden="true">
            <span className={styles.light} data-tone="red" />
            <span className={styles.light} data-tone="yellow" />
            <span className={styles.light} data-tone="green" />
          </span>
          <span className={styles.address} aria-hidden="true">
            <Icon name="lock" size="xs" />
            {shown?.address}
          </span>
        </div>
        <div className={styles.viewport}>
          {area.slides.map((slide, index) => {
            const isShown = slide.id === current;
            const isEager = isFirst && index === 0;
            return (
              <picture className={styles.shot} key={slide.id} data-shown={isShown || undefined}>
                <source media="(width < 1024px)" srcSet={slideSrc(slide, 'phone')} width={1170} height={2532} />
                <img
                  className={styles.image}
                  src={slideSrc(slide)}
                  alt={slide.alt}
                  width={3840}
                  height={2400}
                  decoding="async"
                  loading={isEager ? 'eager' : 'lazy'}
                  aria-hidden={isShown ? undefined : 'true'}
                  onError={() => setBroken((ids) => (ids.includes(slide.id) ? ids : [...ids, slide.id]))}
                  {...(isEager ? { fetchPriority: 'high' as const } : {})}
                />
              </picture>
            );
          })}
        </div>
      </div>
      <span className={styles.controls}>
        <SegmentedControl
          label={`${area.label} screen`}
          size="compact"
          isFitted
          segments={area.slides.map((slide) => ({ value: slide.id, label: slide.caption }))}
          value={current}
          onChange={setCurrent}
        />
        <Button
          variant="ghost"
          icon={isPaused ? 'play' : 'pause'}
          label={isPaused ? 'Play the screens' : 'Pause the screens'}
          onPress={() => setIsPaused((paused) => !paused)}
        />
      </span>
    </figure>
  );
}
