import { Fragment, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import styles from './PersonLine.module.css';
import { strings } from './strings.ts';

/** How a person's quiet line reads: `quiet` (secondary text) or `away` (time off, in the Away colour, strong). */
export type PersonLineTone = 'quiet' | 'away';

/** Props for PersonLine. */
export interface PersonLineProps {
  /** Seeds the picture's hue. */
  readonly id: string;
  readonly name: string;
  /**
   * The quiet line under the name, its parts in order and joined by a middle dot: the first is what the line is
   * about (the status, the week's hours), so the last, cut first, is the least needed (a job title).
   */
  readonly meta: readonly string[];
  /** The first part's tone. */
  readonly tone?: PersonLineTone;
  /** `sm` in a calendar's column head, `md` in a table row (the Team week). */
  readonly size?: 'sm' | 'md';
  /** At the end, beside the name: a status chip, a view only mark, a row's menu. */
  readonly end?: ReactNode;
  /** Hidden from screen readers when the thing it heads already names the person in full (a calendar column). */
  readonly isDecorative?: boolean;
}

/**
 * One person as a line of a roster: their picture, their name, and one quiet line under it, with room at the end for
 * a chip or a menu. Shared by the Team day's column heads and (next) the Team week's rows, so a person reads the same
 * in both.
 */
export function PersonLine({
  id,
  name,
  meta,
  tone = 'quiet',
  size = 'md',
  end,
  isDecorative = false,
}: PersonLineProps) {
  const [first, ...rest] = meta;
  return (
    <span className={styles.root} data-size={size} {...(isDecorative ? { 'aria-hidden': true } : {})}>
      <span className={styles.picture}>
        <Avatar name={name} id={id} size={size} isDecorative />
      </span>
      <span className={styles.who}>
        <span className={styles.name}>
          <TruncatedText>{name}</TruncatedText>
        </span>
        {first !== undefined && (
          <span className={styles.meta}>
            <span className={styles.lead} data-tone={tone}>
              {first}
            </span>
            {rest.map((part) => (
              <Fragment key={part}>
                {strings.separator}
                {part}
              </Fragment>
            ))}
          </span>
        )}
      </span>
      {end !== undefined && <span className={styles.end}>{end}</span>}
    </span>
  );
}
