import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import type { Hue } from '../../hue.ts';
import styles from './WorkspacePreview.module.css';
import { strings } from './strings.ts';

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
  /**
   * A believable sample workspace in place of the bars: a named workspace
   * and person, and a People table with names (sign in, verify, join, before
   * anyone has typed). First run leaves it off, so what is typed shows.
   */
  readonly sample?: boolean;
}

/** A row of the sketched navigation: its icon (or an object's tile) and a bar for its name. */
interface SketchRow {
  readonly icon: IconName;
  readonly label: string;
  readonly tile?: Hue;
  readonly width: 'long' | 'medium' | 'short';
  readonly isCalendar?: boolean;
  readonly area?: WorkspacePreviewArea;
}

const NAV: readonly SketchRow[] = [
  { icon: 'house', label: strings.nav.home, width: 'medium' },
  { icon: 'inbox', label: strings.nav.inbox, width: 'short' },
  { icon: 'square-check', label: strings.nav.tasks, width: 'medium' },
  { icon: 'calendar', label: strings.nav.calendar, width: 'long', isCalendar: true },
];

const AREA_ROWS: readonly SketchRow[] = [
  { icon: 'calendar-clock', label: strings.nav.booking, width: 'medium', area: 'booking' },
  { icon: 'clipboard-list', label: strings.nav.forms, width: 'short', area: 'forms' },
];

const RECORDS: readonly SketchRow[] = [
  { icon: 'user', label: strings.objects.people, tile: 'green', width: 'medium' },
  { icon: 'building', label: strings.objects.companies, tile: 'blue', width: 'long' },
  { icon: 'circle-dollar-sign', label: strings.objects.deals, tile: 'orange', width: 'short' },
];

/** Enough rows to run off the foot of the tallest window; the frame cuts the rest. */
const TABLE_ROWS = 18;

/**
 * A sketch of the app as it will look, drawn live from what a first run step
 * has typed (spec 0036): the sidebar with the workspace's initials tile and
 * name at its head, the app's own rows by name, the person's avatar and name at its
 * foot, and a table beside it, cut off by its frame. The part the step is
 * about is ringed. With `sample`, a sample workspace fills it (sign in). It
 * is decoration, hidden from assistive technology: its words are the app's
 * labels, a sample, or what the person just typed, which the form holds.
 */
export function WorkspacePreview({
  workspaceName,
  workspaceId,
  personName,
  personId,
  focus,
  areas = [],
  sample = false,
}: WorkspacePreviewProps) {
  const workspace = workspaceName.trim() === '' && sample ? strings.sampleWorkspace : workspaceName.trim();
  const person = personName.trim() === '' && sample ? strings.samplePerson : personName.trim();
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
      <span className={styles.label}>{each.label}</span>
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
          <span className={styles.section}>{strings.records}</span>
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
            <Icon name="user" tile="green" />
            <span className={styles.title}>{strings.objects.people}</span>
          </div>
          <ul className={styles.table}>
            {sample
              ? strings.samplePeople.map(([name, company]) => (
                  <li key={name} className={styles.line}>
                    <Avatar name={name} size="sm" isDecorative />
                    <span className={styles.cell}>{name}</span>
                    <span className={styles.muted}>{company}</span>
                  </li>
                ))
              : Array.from({ length: TABLE_ROWS }, (_, index) => (
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
