// A link page's next times block (spec 0061, AC-6110), its own chunk: loaded only on a page that has one.
import { useEffect, useId, useRef } from 'react';
import { ButtonLink } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { memoIntl } from '../../lib/intl-memo.ts';
import { useFormatSettings } from '../../provider/context.ts';
import type { LinkPageBlock } from './LinkPage.tsx';
import styles from './LinkPageTimes.module.css';
import { strings } from './strings.ts';

/** Props for LinkPageTimes. */
export interface LinkPageTimesProps {
  readonly block: Extract<LinkPageBlock, { kind: 'times' }>;
  /** Under the person's name, or under a section's heading. */
  readonly level: 2 | 3;
  /** A chip or More times was pressed (a press counter's beacon). */
  readonly onPress?: () => void;
  /** The block neared the screen with no times yet: the caller reads them, once. */
  readonly onNear?: (id: string) => void;
}

/** How many chips hold their places while the times load. */
const LOADING_CHIPS = 3;

/** How far ahead of the screen the block asks for its times, so they are there as it scrolls in. */
const NEAR = '200px';

/** A chip's address: the booking page on that day, that time chosen (`at`) for that length (`len`). */
export function chipHref(href: string, start: string, minutes: number): string {
  return `${href}?at=${encodeURIComponent(start)}&len=${String(minutes)}`;
}

/**
 * A booking page's next open times (AC-6110): its title, up to 6 starts as chips in the visitor's own time zone,
 * each opening the booking page with that time chosen, and More times. The times are read only once the block nears
 * the screen. With none in the next two weeks it says so and keeps More times; a read that failed keeps More times
 * alone, which still books.
 */
export function LinkPageTimes({ block, level, onPress, onNear }: LinkPageTimesProps) {
  const { locale, timeZone } = useFormatSettings();
  const titleId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const times = block.times;
  const isWaiting = times === undefined;
  useEffect(() => {
    const root = rootRef.current;
    if (!isWaiting || onNear === undefined || root === null) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      onNear(block.id);
      return undefined;
    }
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          watch.disconnect();
          onNear(block.id);
        }
      },
      { rootMargin: NEAR },
    );
    watch.observe(root);
    return () => {
      watch.disconnect();
    };
  }, [isWaiting, onNear, block.id]);
  const format = memoIntl(
    `link-times:${locale}:${timeZone}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
      }),
  );
  const Title = level === 2 ? 'h2' : 'h3';
  const isLoading = times === undefined || times.status === 'loading';
  return (
    <section ref={rootRef} className={styles.root} aria-labelledby={titleId} aria-busy={isLoading || undefined}>
      <Title id={titleId} className={styles.title}>
        {block.title}
      </Title>
      {isLoading ? (
        <div className={styles.chips}>
          <VisuallyHidden>{strings.timesLoading}</VisuallyHidden>
          {Array.from({ length: LOADING_CHIPS }, (_, index) => (
            <span key={index} className={styles.chipLoading} aria-hidden="true">
              <Skeleton shape="fill" />
            </span>
          ))}
        </div>
      ) : times.status === 'ready' && times.starts.length > 0 ? (
        <ul className={styles.chips} aria-label={strings.times(block.title)}>
          {times.starts.map((start) => (
            <li key={start} className={styles.chip}>
              <ButtonLink
                size="touch"
                href={chipHref(block.href, start, block.duration)}
                label={strings.timeChip(format.format(new Date(start)), block.duration)}
                {...(onPress === undefined ? {} : { onPress })}
              >
                {format.format(new Date(start))}
              </ButtonLink>
            </li>
          ))}
        </ul>
      ) : times.status === 'ready' ? (
        <p className={styles.none}>{strings.noTimes}</p>
      ) : null}
      <span className={styles.more}>
        <ButtonLink
          variant="ghost"
          iconRight="arrow-right"
          href={block.href}
          {...(onPress === undefined ? {} : { onPress })}
        >
          {strings.moreTimes}
        </ButtonLink>
      </span>
    </section>
  );
}
