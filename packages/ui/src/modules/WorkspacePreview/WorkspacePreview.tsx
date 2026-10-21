import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import type { Hue } from '../../hue.ts';
import styles from './WorkspacePreview.module.css';

/** The part of the sketch a first run step is about, ringed: the person, the workspace, or the calendar. */
export type WorkspacePreviewFocus = 'person' | 'workspace' | 'calendar' | 'areas';

/** A part of the product the person picked on first run's About you, drawn as a row of its own in the sketch. */
export type WorkspacePreviewArea = 'booking' | 'forms';

/** Props for WorkspacePreview. */
export interface WorkspacePreviewProps {
  /** The workspace's name as typed. A bar stands in while it is empty. */
  readonly workspaceName: string;
  /** Seeds the workspace tile's hue (the workspace's id), so its colour holds while the name changes. */
  readonly workspaceId?: string;
  /** The person's name as typed. A bar stands in while it is empty. */
  readonly personName: string;
  /** Seeds the person's avatar hue (their user id), as everywhere else they appear. */
  readonly personId?: string;
  /** The part the step is about, ringed. */
  readonly focus?: WorkspacePreviewFocus;
  /** The areas picked on About you: each adds its row (Bookings, Forms) under the calendar, ringed with `focus="areas"`. */
  readonly areas?: readonly WorkspacePreviewArea[];
}

/** A row of the sketched navigation: its icon (or an object's tile) and a bar for its name. */
interface SketchRow {
  readonly icon: IconName;
  readonly tile?: Hue;
  readonly width: 'long' | 'medium' | 'short';
  readonly isCalendar?: boolean;
  readonly area?: WorkspacePreviewArea;
}

const NAV: readonly SketchRow[] = [
  { icon: 'house', width: 'medium' },
  { icon: 'inbox', width: 'short' },
  { icon: 'square-check', width: 'medium' },
  { icon: 'calendar', width: 'long', isCalendar: true },
];

const AREA_ROWS: readonly SketchRow[] = [
  { icon: 'calendar-clock', width: 'medium', area: 'booking' },
  { icon: 'clipboard-list', width: 'short', area: 'forms' },
];

const RECORDS: readonly SketchRow[] = [
  { icon: 'user', tile: 'green', width: 'medium' },
  { icon: 'building', tile: 'blue', width: 'long' },
  { icon: 'circle-dollar-sign', tile: 'orange', width: 'short' },
];

const TABLE_ROWS = 9;

/**
 * A sketch of the app as it will look, drawn live from what a first run step
 * has typed (spec 0036): the sidebar with the workspace's initials tile and
 * name at its head, a few quiet rows, the person's avatar and name at its
 * foot, and a table beside it, cut off by its frame. The part the step is
 * about is ringed. It is decoration, hidden from assistive technology: every
 * word in it is something the person just typed, which the form already
 * holds.
 */
export function WorkspacePreview({
  workspaceName,
  workspaceId,
  personName,
  personId,
  focus,
  areas = [],
}: WorkspacePreviewProps) {
  const workspace = workspaceName.trim();
  const person = personName.trim();
  const row = (each: SketchRow) => (
    <li
      key={each.icon}
      className={styles.row}
      data-focused={
        (each.isCalendar === true && focus === 'calendar') || (each.area !== undefined && focus === 'areas')
          ? ''
          : undefined
      }
    >
      {each.tile === undefined ? (
        <Icon name={each.icon} size="sm" tone="muted" />
      ) : (
        <Icon name={each.icon} tile={each.tile} />
      )}
      <Skeleton width={each.width} isStill />
    </li>
  );
  return (
    <div className={styles.root} aria-hidden="true">
      <div className={styles.window}>
        <div className={styles.sidebar}>
          <div className={styles.head}>
            <span className={styles.part} data-focused={focus === 'workspace' ? '' : undefined}>
              {workspace === '' ? (
                <Skeleton shape="tile" isStill />
              ) : (
                <Avatar
                  name={workspace}
                  shape="square"
                  isDecorative
                  {...(workspaceId === undefined ? {} : { id: workspaceId })}
                />
              )}
              {workspace === '' ? (
                <Skeleton width="medium" isStill />
              ) : (
                <span className={styles.name}>{workspace}</span>
              )}
              <Icon name="chevron-down" size="xs" tone="muted" />
            </span>
          </div>
          <span className={styles.search}>
            <Icon name="search" size="sm" tone="muted" />
            <Skeleton width="short" isStill />
          </span>
          <ul className={styles.list}>
            {[...NAV, ...AREA_ROWS.filter((each) => each.area !== undefined && areas.includes(each.area))].map(row)}
          </ul>
          <span className={styles.label}>
            <Skeleton width="short" isStill />
          </span>
          <ul className={styles.list}>{RECORDS.map(row)}</ul>
          <div className={styles.foot}>
            <span className={styles.part} data-focused={focus === 'person' ? '' : undefined}>
              {person === '' ? (
                <Skeleton shape="circle" isStill />
              ) : (
                <Avatar name={person} isDecorative {...(personId === undefined ? {} : { id: personId })} />
              )}
              {person === '' ? <Skeleton width="medium" isStill /> : <span className={styles.person}>{person}</span>}
            </span>
          </div>
        </div>
        <div className={styles.main}>
          <div className={styles.bar}>
            <Skeleton width="short" isStill />
          </div>
          <ul className={styles.table}>
            {Array.from({ length: TABLE_ROWS }, (_, index) => (
              <li key={index} className={styles.line}>
                <Skeleton shape="circle" isStill />
                <Skeleton width={index % 3 === 0 ? 'long' : index % 3 === 1 ? 'medium' : 'short'} isStill />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
