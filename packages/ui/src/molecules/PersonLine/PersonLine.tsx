import { Fragment, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { SharedTooltipContext, TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import styles from './PersonLine.module.css';
import { strings } from './strings.ts';

/**
 * How the line's first part reads: `quiet` (secondary text), `away` (time off, in the Away colour, strong), or a day's
 * state on a calendar's head: `free` (the success colour) and `off` (tertiary). Booked stays `quiet`: the link colour
 * on words that can't be pressed would read as a link.
 */
export type PersonLineTone = 'quiet' | 'away' | 'free' | 'off';

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
  /**
   * A tooltip over the name and line, for what a short line leaves out (the Team day's job title): the name first, so
   * it also stands in for the name's own tooltip when that is cut. Screen readers get it from what the line heads.
   */
  readonly hint?: string;
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
  hint,
}: PersonLineProps) {
  const [first, ...rest] = meta;
  const who = (
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
  );
  return (
    <span className={styles.root} data-size={size} {...(isDecorative ? { 'aria-hidden': true } : {})}>
      <span className={styles.picture}>
        <Avatar name={name} id={id} size={size} isDecorative />
      </span>
      {hint === undefined ? (
        who
      ) : (
        // One tooltip for the whole: the name's own (when cut) would only repeat its first part.
        <SharedTooltipContext value>
          <Tooltip content={hint} isTextTrigger isTriggerShared>
            {who}
          </Tooltip>
        </SharedTooltipContext>
      )}
      {end !== undefined && <span className={styles.end}>{end}</span>}
    </span>
  );
}
