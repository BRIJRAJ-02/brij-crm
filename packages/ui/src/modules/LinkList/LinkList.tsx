import { useState, type ReactNode } from 'react';
import { GridList, GridListItem } from 'react-aria-components';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button, ButtonGroup } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import styles from './LinkList.module.css';
import { strings } from './strings.ts';

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
  /** Its address, inline after the title and muted ("/acme/intro-call", "/f/contact-us"). */
  readonly address: string;
  /** Up to two lines under the title (a page's description). */
  readonly description?: string;
  /** Short facts as chips under the title ("30 min", "60 min"; "4 questions", "12 responses"). */
  readonly chips: readonly string[];
  /** A grey badge before the switch, only when it isn't taking people ("Off", "Not published", "Copying…"). */
  readonly badge?: string;
  /** Off (not taking people): the title reads in the secondary colour, as the switch says. */
  readonly isOff?: boolean;
  readonly toggle?: LinkToggle;
  /** Open, Copy link and the row menu: secondary icon Buttons, joined into one ButtonGroup at the end. */
  readonly actions: ReactNode;
  /** Shown before the server made it (a copy on its way): drawn quieter, and it doesn't open yet. */
  readonly isPending?: boolean;
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
}

/** How many skeleton rows stand in while the list loads. */
const SKELETON_ROWS = 3;

/** Whether a row matches the search, by title or address, ignoring case. */
function matches(row: LinkRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return true;
  return row.title.toLocaleLowerCase().includes(needle) || row.address.toLocaleLowerCase().includes(needle);
}

/**
 * Links as rows, not a table (spec 0025's Cal.com alignment, the event types
 * list; spec 0023's forms list): a search field and the list's action above
 * rows about 60px tall. Each row opens its link, with the title and its
 * address inline, facts as chips under them, and at the end an Off badge when
 * it is off, its switch, and one joined group of icon actions. Arrows move
 * between rows, Enter opens one, and left and right reach a row's controls.
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
}: LinkListProps) {
  const [query, setQuery] = useState('');
  const showSkeleton = useDelayedLoading(status === 'loading');
  if (status === 'no-access') {
    return (
      <EmptyState tone="locked" title={strings.noAccess}>
        {strings.noAccessBody}
      </EmptyState>
    );
  }
  if (status === 'ready' && rows.length === 0) return <>{emptyState}</>;
  const isLoading = status === 'loading';
  const isFailed = status === 'error';
  const shown = rows.filter((row) => matches(row, query));
  const toolbar = (
    <div className={styles.toolbar}>
      <span className={styles.search}>
        <Field
          label={searchLabel}
          isLabelHidden
          placeholder={strings.search}
          variant="search"
          type="search"
          value={query}
          onChange={setQuery}
          isDisabled={isLoading || isFailed}
        />
      </span>
      {!isLoading && actions !== undefined && <div className={styles.listActions}>{actions}</div>}
    </div>
  );
  // A list that didn't load keeps its toolbar (New still works), the failure where the rows go.
  if (isFailed) {
    return (
      <div className={styles.frame}>
        {toolbar}
        <EmptyState tone="error" title={errorTitle ?? strings.failed} {...(onRetry === undefined ? {} : { onRetry })} />
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className={styles.frame}>
        {toolbar}
        <div className={styles.root} aria-busy="true">
          {showSkeleton &&
            Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <div key={index} className={styles.row} data-loading="">
                <div className={styles.main}>
                  <span className={styles.skeletonTitle}>
                    <Skeleton width="medium" />
                  </span>
                  <span className={styles.skeletonChips}>
                    <Skeleton width="short" />
                  </span>
                </div>
              </div>
            ))}
          <VisuallyHidden>{strings.loading(label)}</VisuallyHidden>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.frame}>
      {toolbar}
      {shown.length === 0 ? (
        <EmptyState
          icon="search"
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
      ) : (
        <GridList
          className={styles.root}
          aria-label={label}
          items={shown}
          disabledKeys={shown.flatMap((row) => (row.isPending === true ? [row.id] : []))}
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
            >
              <div className={styles.main}>
                <div className={styles.titleLine}>
                  <span className={styles.title}>{row.title}</span>
                  <span className={styles.address}>{row.address}</span>
                </div>
                {row.description !== undefined && row.description !== '' && (
                  <p className={styles.description}>{row.description}</p>
                )}
                {row.chips.length > 0 && (
                  <ul className={styles.chips}>
                    {row.chips.map((chip) => (
                      <li key={chip}>
                        <Badge text={chip} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className={styles.end}>
                {row.badge !== undefined && <Badge text={row.badge} />}
                {row.toggle !== undefined && <RowSwitch toggle={row.toggle} isPending={row.isPending === true} />}
                <ButtonGroup label={row.title}>{row.actions}</ButtonGroup>
              </div>
            </GridListItem>
          )}
        </GridList>
      )}
    </div>
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
