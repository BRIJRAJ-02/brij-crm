import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { GridList, GridListItem } from 'react-aria-components';
import { Badge, type BadgeTone } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
import { safeHref } from '../../lib/safe-href.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import styles from './LinkList.module.css';
import { LinkListToolbar } from './LinkListToolbar.tsx';
import type { RowGrip, RowOrderProps } from './RowOrder.tsx';
import { strings } from './strings.ts';

/** LinkList's search and action, in their own file (the guest profile page draws only these); kept here too. */
export { LinkListToolbar, type LinkListToolbarProps } from './LinkListToolbar.tsx';

/** A row's on or off switch: a booking page's visibility, a form's Accepting. */
export interface LinkToggle {
  /** Its name for screen readers ("Intro call is live"). */
  readonly label: string;
  readonly isSelected: boolean;
  readonly onChange: (isSelected: boolean) => void;
  /** Can't be switched (never published, no permission, still on its way). */
  readonly isDisabled?: boolean;
  /** Why it can't, shown in a tooltip on the switch ("Publish it first"). */
  readonly disabledReason?: string;
}

/** One link's row. */
export interface LinkRow {
  readonly id: string;
  readonly title: string;
  /**
   * The muted text inline after the title: its address ("/acme/intro-call", "/f/contact-us"), or in a list
   * that is about something else, that ("Mon to Fri, 9:00 AM to 5:00 PM", Availability's pages). The search
   * matches it. Empty draws nothing: a profile's rows (BookingProfile) are on the page they open from.
   */
  readonly address: string;
  /** Up to two lines under the title (a page's description). Left out of `density="compact"`'s one line rows. */
  readonly description?: string;
  /**
   * Short facts ("30 min", "60 min"; "4 questions", "12 responses"): Badges under the title, or in
   * `density="compact"` one cell of muted text after it ("30 min · 60 min"), lined up down the list, so they
   * read apart from the states, which keep their Badge.
   */
  readonly chips: readonly string[];
  /**
   * A Badge right after the title, for what the row is rather than whether it takes people: the default schedule
   * ("Default"), read with the name. States that come and go (`badge`) stay at the row's end.
   */
  readonly titleBadge?: string;
  /** With `titleBadge`, its tone: `strong` for a state that has to read at a glance down a list (an item Sold out). */
  readonly titleBadgeTone?: BadgeTone;
  /**
   * A tile before the title, for rows that are told apart at a glance by what they are (a link page's blocks: a
   * network's mark, an icon, a letter). Give every row one, and the list `leadingLoading`, so loading rows hold its place.
   */
  readonly leading?: ReactNode;
  /** A grey badge before the switch, only when it isn't taking people ("Off", "Not published", "Copying"). */
  readonly badge?: string;
  /** Off (not taking people): the title reads in the secondary colour, as the switch says. */
  readonly isOff?: boolean;
  readonly toggle?: LinkToggle;
  /**
   * Open, Copy link and the row menu: quiet (ghost) icon Buttons at the row's end, the way the app's rows carry
   * their actions. Left out, the row has none (the row itself opens).
   */
  readonly actions?: ReactNode;
  /** Shown before the server made it (a copy on its way): drawn quieter, and it doesn't open yet. */
  readonly isPending?: boolean;
  /**
   * The address opening it moves to. The row still opens through `onOpen`; this says where it leads as
   * `data-href`, so the app can load that page while a pointer rests on the row.
   */
  readonly href?: string;
  /**
   * `section` draws the row as the heading over the rows after it: the title as a small uppercase label, its
   * `count` beside it, no tile, and its actions at the end. It is still one row of the same list, so it is
   * dragged, moved by the keyboard and counted like any other; what it heads is simply whatever follows it.
   */
  readonly variant?: 'row' | 'section';
  /** With `variant="section"`: how many rows sit under it, drawn after the title. */
  readonly count?: number;
  /**
   * The row's `chips` are still on their way (a figure the screen reads apart from the rows, as the link page
   * reads its clicks): their line is drawn as a Skeleton from the first frame, so the row keeps its height and
   * nothing under it moves when the figure lands. Ignored once `chips` has anything in it.
   */
  readonly areChipsPending?: boolean;
  /**
   * One quiet number at the row's end, before its badge and actions (a link page block's clicks): `text` is drawn
   * ("12"), `label` is what a screen reader hears in its place ("12 clicks"). For a figure every row has, where a
   * Badge under each title made the list twice as tall and as loud as its titles (owner, 5 November 2026).
   */
  readonly figure?: { readonly text: string; readonly label: string };
  /**
   * With `density="media"`: what the row costs, its second most important thing, in a right aligned column of its own
   * so a scan down the list reads it. `quiet` is words rather than a figure (Market price), `alert` what still has to
   * be fixed (No price).
   */
  readonly amount?: { readonly text: string; readonly tone?: 'default' | 'quiet' | 'alert' };
  /**
   * With `density="media"`: one control the row is mostly opened for, beside its actions (Mark sold out). It waits for
   * the pointer or focus as they do, and is gone where there is no hover and on a narrow list, so give the same action
   * a home in the row's menu too.
   */
  readonly quickAction?: ReactNode;
  /**
   * The row is on its way out (deleted, with Undo in a toast): it fades and closes up, can't be opened, and the
   * list's `onLeft` says when it is gone, so the screen stops drawing it. With `hasRowMotion`.
   */
  readonly isLeaving?: boolean;
}

/** Props for LinkList. */
export interface LinkListProps {
  /** What the rows are ("Booking pages", "Forms"). */
  readonly label: string;
  readonly rows: readonly LinkRow[];
  /** Opens a row (pressing anywhere on it, or Enter on it). */
  readonly onOpen: (id: string) => void;
  /** The search field's name ("Search booking pages"); it narrows the rows by title and address. */
  readonly searchLabel: string;
  /** At the end of the search row: the list's own action (New booking page, New form). */
  readonly actions?: ReactNode;
  /** `loading` draws skeleton rows after the loading delay; `error` the failure with Try again. */
  readonly status?: LoadStatus;
  /** For `error`: Try again. */
  readonly onRetry?: () => void;
  /** For `error`: the screen's own words ("Booking pages didn’t load"). */
  readonly errorTitle?: string;
  /** Shown with no rows at all: usually an EmptyState. */
  readonly emptyState?: ReactNode;
  /**
   * The search, held by the page when it draws the toolbar elsewhere (Captures puts LinkListToolbar in its tab
   * strip); left out, the list keeps its own.
   */
  readonly query?: string;
  /** With `query`: the search changed. */
  readonly onQueryChange?: (query: string) => void;
  /** The page draws the toolbar itself (LinkListToolbar), so the list leaves its own out. */
  readonly isToolbarHidden?: boolean;
  /**
   * `comfortable` (the default): rows about 60px tall, with a description and the chips under the title, in a
   * raised, bordered box. `compact`: the records area's rows, one line at size-row, with no frame: the title and
   * address, the facts lined up in a column, then the badge, the switch and the actions, parted by hairlines.
   * `media`: rows told apart by a picture (a menu's items) inside a Card: a large `leading` tile, the title with its
   * `chips` as one quiet line of text under it, `amount` in a right aligned column, no frame and no hairlines; the
   * grip, `quickAction` and `actions` wait for the pointer or focus (always there where there is no hover).
   */
  readonly density?: 'comfortable' | 'compact' | 'media';
  /**
   * With `density="compact"`, where the list sits. `page` (the default) runs the rows edge to edge across the
   * view with the page's gutter inside them (Captures). `card` keeps them inside a Card's padding, inset like a
   * Table's cells (Bookings › Availability's pages).
   */
  readonly placement?: 'page' | 'card';
  /**
   * Each row is a plain link to its `href` (a list of `a` elements), for a public page whose visitors open rows in
   * a new tab, copy their address, and whose crawlers follow them: a profile's booking links (22 Oct 2026). The
   * rows then take no `onOpen`, `toggle` or `actions`.
   */
  readonly rowsAreLinks?: boolean;
  /**
   * The rows move (owner ask A102, Settings › Profile's order), with `rowOrder`: a grip starts each row, dragged, or
   * Space on it, the arrows and Space again, and a drop calls this with the row's id and its new index among `rows`.
   * Not while the search narrows the rows, nor with `rowsAreLinks`. A row alone in the list, or pending, keeps its
   * grip's place with no grip in it. Left out, the rows hold still.
   */
  readonly onMove?: (id: string, toIndex: number) => void;
  /**
   * With `onMove`, the drag wrapper the rows move in: pass `LinkListRowOrder`. It comes in from the screen rather
   * than from this file, so a page whose rows hold still (a public profile, through `@crm/ui/public-booking`) never
   * loads dnd-kit, and no lazy chunk splits the files every page loads first.
   */
  readonly rowOrder?: ComponentType<RowOrderProps>;
  /**
   * Every row has a `leading` tile, and this is the tile's loading form (`<LinkPageTile />`): loading rows draw it, so
   * the titles land where the lines stood. Set, the rows are laid out for a tile.
   */
  readonly leadingLoading?: ReactNode;
  /**
   * With `density="media"`: the list's own last line, under its rows or `emptyState`, lined up with the tiles (a menu
   * section's Add item, which turns into its field in place).
   */
  readonly footer?: ReactNode;
  /**
   * With `density="media"`: the tiles keep the grip's column clear even with no grips (read only, or while a search
   * has put them away), so they stay under a SectionList's `isTitleInset` titles.
   */
  readonly isTileInset?: boolean;
  /**
   * Rows move as they come and go (Availability's time off): a row that arrives after the first draw drops in (a
   * fade with a small rise, as `media` rows do), and a row marked `isLeaving` fades and closes up, then `onLeft` names
   * it. Why a prop: a list whose rows are added and deleted in place, with Undo, reads the change where it happened.
   */
  readonly hasRowMotion?: boolean;
  /** With `hasRowMotion`: a leaving row finished closing up (or its motion couldn't run), so the screen drops it. */
  readonly onLeft?: (id: string) => void;
}

/** How long a leaving row may take before it goes anyway: about 2.5 × `duration-fast`, well past its motion. */
const LEAVE_FALLBACK_MS = 600;

/** How many skeleton rows stand in while the list loads. */
const SKELETON_ROWS = 3;

/** Whether a row matches the search, by title or address, ignoring case. */
function matches(row: LinkRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return true;
  return row.title.toLocaleLowerCase().includes(needle) || row.address.toLocaleLowerCase().includes(needle);
}

/**
 * Links as rows, not a table (spec 0025; spec 0023's forms list): a search
 * field and the list's action above the rows. Each row opens its link, with
 * the title and its address inline, its facts as chips, and at the end an Off
 * badge when it is off, its switch, and its quiet icon actions. `compact`
 * draws the records area's one line rows with no frame (Captures). Arrows move
 * between rows, Enter opens one, and left and right reach a row's controls.
 * With `onMove` the rows move by their grips.
 */
export function LinkList({
  label,
  rows,
  onOpen,
  searchLabel,
  actions,
  status = 'ready',
  onRetry,
  errorTitle,
  emptyState,
  query: heldQuery,
  onQueryChange,
  isToolbarHidden = false,
  density = 'comfortable',
  placement = 'page',
  rowsAreLinks = false,
  onMove,
  rowOrder: RowOrder,
  leadingLoading,
  footer,
  isTileInset = false,
  hasRowMotion = false,
  onLeft,
}: LinkListProps) {
  const hasLeading = leadingLoading !== undefined;
  const isCompact = density === 'compact';
  const isMedia = density === 'media';
  // Rows that arrive after the list first drew (an item added) ease in; the first draw just stands there.
  const [isSettled, setSettled] = useState(false);
  const arrives = isMedia || hasRowMotion;
  useEffect(() => {
    if (!arrives) return;
    const frame = requestAnimationFrame(() => {
      setSettled(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [arrives]);
  // A leaving row's motion ends in `onLeft`; should it never run (a hidden tab, animations off), it still goes.
  const leavingKey = rows.flatMap((row) => (row.isLeaving === true ? [row.id] : [])).join(' ');
  useEffect(() => {
    if (leavingKey === '' || onLeft === undefined) return undefined;
    const timer = setTimeout(() => {
      for (const id of leavingKey.split(' ')) onLeft(id);
    }, LEAVE_FALLBACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [leavingKey, onLeft]);
  const isCard = isCompact && placement === 'card';
  const [ownQuery, setOwnQuery] = useState('');
  const query = heldQuery ?? ownQuery;
  const setQuery = onQueryChange ?? setOwnQuery;
  // A narrowed list can't say where a row goes among the ones it hides, so a search puts the grips away.
  const moves =
    onMove !== undefined && RowOrder !== undefined && !rowsAreLinks && query.trim() === '' ? onMove : undefined;
  const frameProps = {
    className: styles.frame,
    'data-density': density,
    'data-placement': isCompact ? placement : undefined,
    'data-reorderable': moves === undefined ? undefined : '',
    'data-leading': hasLeading ? '' : undefined,
    'data-settled': arrives && isSettled ? '' : undefined,
    'data-motion': hasRowMotion ? '' : undefined,
    'data-tile-inset': isMedia && isTileInset && moves === undefined ? '' : undefined,
  };
  const foot =
    isMedia && footer !== undefined && footer !== null ? <div className={styles.footer}>{footer}</div> : undefined;
  const showSkeleton = useDelayedLoading(status === 'loading');
  if (status === 'no-access') {
    return (
      <EmptyState tone="locked" title={strings.noAccess}>
        {strings.noAccessBody}
      </EmptyState>
    );
  }
  if (status === 'ready' && rows.length === 0) {
    if (foot === undefined) return <>{emptyState}</>;
    return (
      <div {...frameProps}>
        {emptyState}
        {foot}
      </div>
    );
  }
  const isLoading = status === 'loading';
  const isFailed = status === 'error';
  const shown = rows.filter((row) => matches(row, query));
  const toolbar = isToolbarHidden ? undefined : (
    <LinkListToolbar
      searchLabel={searchLabel}
      query={query}
      onQueryChange={setQuery}
      isSearchDisabled={isLoading || isFailed}
      {...(isLoading || actions === undefined ? {} : { actions })}
    />
  );
  // A list that didn't load keeps its toolbar (New still works), the failure where the rows go.
  if (isFailed) {
    return (
      <div {...frameProps}>
        {toolbar}
        <EmptyState
          tone="error"
          title={errorTitle ?? strings.failed}
          // In a card the failure takes one row, as the card's other sections draw theirs.
          layout={isCard ? 'row' : 'block'}
          {...(onRetry === undefined ? {} : { onRetry })}
        >
          {isCard ? strings.failedBody : undefined}
        </EmptyState>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div {...frameProps}>
        {toolbar}
        <div className={styles.root} aria-busy="true">
          {showSkeleton && (
            <SkeletonRows
              count={SKELETON_ROWS}
              isCompact={isCompact}
              isMedia={isMedia}
              hasGrip={moves !== undefined}
              leadingLoading={leadingLoading}
            />
          )}
          <VisuallyHidden>{strings.loading(label)}</VisuallyHidden>
        </div>
      </div>
    );
  }
  // The rows as React Aria's grid, each starting with its grip when they move (`grip` absent: its place held).
  const grid = (grip: RowGrip | undefined) => (
    <GridList
      className={styles.root}
      aria-label={label}
      items={shown}
      // A row draws again when its grip comes or goes (a search puts the grips away), not only when its item changes.
      dependencies={[grip]}
      disabledKeys={shown.flatMap((row) => (row.isPending === true || row.isLeaving === true ? [row.id] : []))}
      onAction={(key) => {
        onOpen(String(key));
      }}
    >
      {(row) => (
        <GridListItem
          id={row.id}
          className={styles.row}
          textValue={row.title}
          data-pressable={row.isPending === true ? undefined : ''}
          data-pending={row.isPending === true || undefined}
          data-off={row.isOff === true || undefined}
          data-href={row.isPending === true ? undefined : row.href}
          data-variant={row.variant === 'section' ? 'section' : undefined}
          data-density={isMedia ? 'media' : undefined}
          data-leaving={row.isLeaving === true || undefined}
          onAnimationEnd={(event) => {
            // The close up is the last of a leaving row's motion (a fade alone with reduced motion).
            if (row.isLeaving === true && event.target === event.currentTarget && /row-close/.test(event.animationName))
              onLeft?.(row.id);
          }}
        >
          {moves !== undefined && (
            <span className={styles.grip}>
              {/* A row alone has nowhere to go, and a pending one isn't made yet: their grips' places stay empty. */}
              {grip?.(row.id, strings.move(row.title), row.isPending === true || shown.length < 2)}
            </span>
          )}
          <RowContent row={row} isCompact={isCompact} isMedia={isMedia} />
        </GridListItem>
      )}
    </GridList>
  );
  return (
    <div {...frameProps}>
      {toolbar}
      {shown.length === 0 ? (
        <EmptyState
          title={strings.noMatches(query.trim())}
          actions={
            <Button
              onPress={() => {
                setQuery('');
              }}
            >
              {strings.clearSearch}
            </Button>
          }
        >
          {strings.noMatchesBody}
        </EmptyState>
      ) : rowsAreLinks ? (
        <ul className={styles.root} data-links="" aria-label={label}>
          {shown.map((row) => (
            <li key={row.id} className={styles.item}>
              {/* Through safeHref: a refused address (javascript:, data:) draws the row as plain text, never a link. */}
              <a className={styles.row} href={safeHref(row.href)} data-off={row.isOff === true || undefined}>
                <RowContent row={row} isCompact={isCompact} isMedia={isMedia} />
              </a>
            </li>
          ))}
        </ul>
      ) : moves === undefined || RowOrder === undefined ? (
        grid(undefined)
      ) : (
        <RowOrder
          ids={shown.map((row) => row.id)}
          nameOf={(id) => shown.find((row) => row.id === id)?.title ?? id}
          onMove={moves}
        >
          {(grip) => grid(grip)}
        </RowOrder>
      )}
      {foot}
    </div>
  );
}

/** Rows standing in for rows on their way: each row's skeleton lines, after its grip's place when the rows move. */
function SkeletonRows({
  count,
  isCompact,
  isMedia,
  hasGrip,
  leadingLoading,
}: {
  readonly count: number;
  readonly isCompact: boolean;
  readonly isMedia: boolean;
  readonly hasGrip: boolean;
  readonly leadingLoading: ReactNode;
}) {
  return Array.from({ length: count }, (_, index) => (
    // The last one is marked: the loading words for screen readers follow it, so it isn't the last child. Static
    // placeholders that never reorder, so their place is their key (AC-16).
    <div key={index} className={styles.row} data-loading="" data-last={index === count - 1 || undefined}>
      {/* The grip's place, so the titles that follow land where these lines stood. */}
      {hasGrip && <span className={styles.grip} />}
      {leadingLoading !== undefined && <span className={styles.leading}>{leadingLoading}</span>}
      <div className={styles.main}>
        <span className={styles.skeletonTitle}>
          <Skeleton width="medium" />
        </span>
        {!isCompact && (
          <span className={styles.skeletonChips}>
            <Skeleton width="short" />
          </span>
        )}
      </div>
      {isMedia && (
        <span className={styles.skeletonAmount}>
          <Skeleton width="full" />
        </span>
      )}
    </div>
  ));
}

/** A row's title line, description and chips, and its end: the same in a GridList row and a link row. */
function RowContent({
  row,
  isCompact,
  isMedia,
}: {
  readonly row: LinkRow;
  readonly isCompact: boolean;
  readonly isMedia: boolean;
}) {
  // A section heads the rows after it: its title is the label, and its end keeps the row's own actions.
  if (row.variant === 'section') {
    return (
      <>
        <div className={styles.main}>
          <div className={styles.titleLine}>
            <span className={styles.sectionTitle}>{row.title}</span>
            {row.count !== undefined && <span className={styles.sectionCount}>{row.count}</span>}
          </div>
        </div>
        <div className={styles.end}>
          {row.badge !== undefined && <Badge text={row.badge} />}
          {row.actions !== undefined && row.actions !== null && (
            <div className={styles.rowActions} role="group" aria-label={row.title}>
              {row.actions}
            </div>
          )}
        </div>
      </>
    );
  }
  return (
    <>
      {row.leading !== undefined && <span className={styles.leading}>{row.leading}</span>}
      <div className={styles.main}>
        <div className={styles.titleLine}>
          <span className={styles.title} title={isCompact || isMedia ? row.title : undefined}>
            {row.title}
          </span>
          {row.titleBadge !== undefined && (
            <span className={styles.titleBadge}>
              <Badge
                text={row.titleBadge}
                {...(row.titleBadgeTone === undefined ? {} : { tone: row.titleBadgeTone })}
              />
            </span>
          )}
          {row.address !== '' && <span className={styles.address}>{row.address}</span>}
        </div>
        {!isCompact && !isMedia && row.description !== undefined && row.description !== '' && (
          <p className={styles.description}>{row.description}</p>
        )}
        {isMedia
          ? row.chips.length > 0 && <span className={styles.factLine}>{row.chips.join(' · ')}</span>
          : !isCompact && <Chips chips={row.chips} isPending={row.areChipsPending === true} />}
      </div>
      {isCompact && (
        <div className={styles.facts}>
          {row.chips.length > 0 && <span className={styles.factText}>{row.chips.join(' · ')}</span>}
        </div>
      )}
      {isMedia && row.amount !== undefined && (
        <span className={styles.amount} data-tone={row.amount.tone === 'default' ? undefined : row.amount.tone}>
          {row.amount.text}
        </span>
      )}
      {isMedia && row.quickAction !== undefined && row.quickAction !== null && (
        <div className={styles.quick}>{row.quickAction}</div>
      )}
      <div className={styles.end}>
        {row.figure !== undefined && (
          <span className={styles.figure}>
            <Icon name="mouse-pointer-2" size="xs" tone="muted" />
            <span aria-hidden>{row.figure.text}</span>
            <VisuallyHidden>{row.figure.label}</VisuallyHidden>
          </span>
        )}
        {row.badge !== undefined && <Badge text={row.badge} />}
        {row.toggle !== undefined && <RowSwitch toggle={row.toggle} isPending={row.isPending === true} />}
        {row.actions !== undefined && row.actions !== null && (
          <div className={styles.rowActions} role="group" aria-label={row.title}>
            {row.actions}
          </div>
        )}
      </div>
    </>
  );
}

/** A row's facts as neutral Badges, the line held by a Skeleton while they load, or nothing when it has none. */
function Chips({ chips, isPending = false }: { readonly chips: readonly string[]; readonly isPending?: boolean }) {
  if (chips.length === 0 && isPending) {
    return (
      <ul className={styles.chips} data-pending="" aria-hidden>
        <li>
          <Skeleton width="short" />
        </li>
      </ul>
    );
  }
  if (chips.length === 0) return null;
  return (
    <ul className={styles.chips}>
      {chips.map((chip) => (
        <li key={chip}>
          <Badge text={chip} />
        </li>
      ))}
    </ul>
  );
}

/** A row's switch, with the reason it is off limits in a tooltip when it is. */
function RowSwitch({ toggle, isPending }: { readonly toggle: LinkToggle; readonly isPending: boolean }) {
  const isDisabled = isPending || toggle.isDisabled === true;
  const control = (
    <Switch
      label={toggle.label}
      isLabelHidden
      isSelected={toggle.isSelected}
      onChange={toggle.onChange}
      isDisabled={isDisabled}
    />
  );
  if (!isDisabled || toggle.disabledReason === undefined) return <span className={styles.toggle}>{control}</span>;
  return (
    <Tooltip content={toggle.disabledReason} isTextTrigger>
      <span className={styles.toggle}>{control}</span>
    </Tooltip>
  );
}
