// The inbox's rows (spec 0038, AC-1169 to AC-1171, the inventory's
// NotificationInbox): who did what ("Ada mentioned you"), or a form's new
// submission ("Contact us got a new submission", spec 0023) under the form's
// mark, the record, the comment's start or the task's title, when, and an
// unread dot. Pressing a row
// (or Enter) opens what it is about; each row's menu, and U and E on a focused
// row, mark it read or unread, done or back in the inbox. Rows come through a
// ListSource, and only the rows on screen draw.
import type { ActorDisplay, RecordRefDisplay } from '@crm/contracts/values';
import { useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { GridList, GridListItem, ListLayout, Virtualizer } from 'react-aria-components';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { ACTOR_ICONS, RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { useFontsSettled } from '../../lib/fonts-settled.ts';
import { itemOfKey, keyedRows, type KeyedRow } from '../../lib/keyed-rows.ts';
import type { ListSource } from '../../lib/list-source.ts';
import type { LoadStatus } from '../../lib/load-status.ts';
import { RowShown, useRangeReporter } from '../../lib/range-reporter.tsx';
import { sizeToken } from '../../lib/token-values.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { useDelayedLoading } from '../../provider/useDelayedLoading.ts';
import { CommentText } from '../CommentThread/CommentThread.tsx';
import styles from './NotificationList.module.css';
import { strings } from './strings.ts';

/** Why a member was notified. */
export type NotificationItemKind = 'mention' | 'reply' | 'task_assigned' | 'form_submission';

/** One notification, as the inbox shows it. */
export interface NotificationItem {
  readonly id: string;
  readonly kind: NotificationItemKind;
  /** Who did it. */
  readonly actor: ActorDisplay;
  /** ISO 8601 in UTC. */
  readonly createdAt: string;
  readonly isRead: boolean;
  readonly isDone: boolean;
  /** The record it is about, when there is one. */
  readonly record?: RecordRefDisplay;
  /** A mention in a note, not a comment: the sentence says so. */
  readonly isNote?: boolean;
  /** A form's new submission: the form's name, which its sentence names ("New submission to Contact us"). */
  readonly formName?: string;
  /** The comment's start (mention tokens kept), or the task's title. */
  readonly excerpt: string;
}

/** A change to one notification from its menu or its keys. */
export interface NotificationMark {
  readonly read?: boolean;
  readonly done?: boolean;
}

/** Props for NotificationList. */
export interface NotificationListProps {
  /** The list's name ("Inbox"). */
  readonly label: string;
  readonly items: ListSource<NotificationItem>;
  /** Every member, so a mention in an excerpt reads by name. */
  readonly members: readonly ActorDisplay[];
  /** The name of someone no longer a member. */
  readonly formerMember: string;
  /** A press or Enter on a row: open what it is about (the screen marks it read). */
  readonly onAction: (id: string) => void;
  /** Mark as read or unread, done or back in the inbox. */
  readonly onMark: (id: string, mark: NotificationMark) => void;
  readonly status?: LoadStatus;
  readonly onRetry?: () => void;
  /** What an empty list says, in place of "You’re all caught up.". */
  readonly emptyTitle?: string;
  readonly emptyIcon?: 'inbox' | 'check' | 'list-filter';
  /** A line under the empty title saying what will land here, so an empty inbox teaches what it is for. */
  readonly emptyBody?: string;
  /** Under the empty title: Clear filters. */
  readonly emptyActions?: ReactNode;
}

/** A row's estimated height before it is measured: the sentence and the excerpt, about two rows. */
const ESTIMATED_ROW = 2;

/** The skeleton a row draws while its notification loads. */
function RowSkeleton() {
  return (
    <span className={styles.skeleton}>
      <Skeleton width="medium" />
      <Skeleton width="long" />
    </span>
  );
}

/**
 * Notifications as a React Aria grid list, newest first as the screen orders
 * them: an unread dot, the actor's avatar, the sentence with the record's
 * chip and the time, then the excerpt, and a menu. Unread rows read bolder.
 */
export function NotificationList({
  label,
  items,
  members,
  formerMember,
  onAction,
  onMark,
  status = 'ready',
  onRetry,
  emptyTitle,
  emptyBody,
  emptyIcon = 'inbox',
  emptyActions,
}: NotificationListProps) {
  const showSkeleton = useDelayedLoading(status === 'loading');
  const onShown = useRangeReporter(items);
  const rows = useMemo(() => keyedRows(items), [items]);
  const fontsSettled = useFontsSettled();
  const names = useMemo(() => new Map(members.map((member) => [member.id ?? '', member.name])), [members]);
  const nameOf = (memberId: string) => names.get(memberId) ?? formerMember;

  if (status === 'error') {
    return (
      <EmptyState tone="error" icon="inbox" title={strings.failed} {...(onRetry === undefined ? {} : { onRetry })} />
    );
  }
  if (status === 'no-access') return <EmptyState tone="locked" title={strings.noAccess} />;
  if (status === 'loading') {
    return (
      <div className={styles.root} aria-busy="true">
        {showSkeleton &&
          [0, 1, 2, 3].map((row) => (
            <div key={row} className={styles.row}>
              <RowSkeleton />
            </div>
          ))}
        <VisuallyHidden>{strings.loading}</VisuallyHidden>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle ?? strings.empty}
        {...(emptyActions === undefined ? {} : { actions: emptyActions })}
      >
        {emptyBody}
      </EmptyState>
    );
  }

  // U and E on a focused row: read or unread, done or back in the inbox (AC-1171).
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'u' && key !== 'e') return;
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-notification]') : null;
    const id = target?.getAttribute('data-notification');
    if (id === null || id === undefined) return;
    let item: NotificationItem | undefined;
    for (let index = 0; index < items.count && item === undefined; index += 1) {
      const candidate = items.getItem(index);
      if (candidate?.id === id) item = candidate;
    }
    if (item === undefined) return;
    event.preventDefault();
    onMark(item.id, key === 'u' ? { read: !item.isRead } : { done: !item.isDone });
  };

  const renderRow = (row: KeyedRow): ReactNode => {
    const item = items.getItem(row.index);
    if (item === undefined) {
      return (
        <GridListItem id={row.id} className={styles.row} textValue="" isDisabled data-loading="">
          <RowShown index={row.index} onShown={onShown} />
          <RowSkeleton />
        </GridListItem>
      );
    }
    const sentence =
      item.kind === 'form_submission'
        ? strings.submission(item.formName ?? strings.someForm)
        : item.isNote === true
          ? strings.mentionInNote(item.actor.name)
          : strings.sentence[item.kind](item.actor.name);
    return (
      <GridListItem
        id={row.id}
        className={styles.row}
        textValue={sentence}
        data-pressable=""
        data-unread={!item.isRead || undefined}
        data-notification={item.id}
      >
        <RowShown index={row.index} onShown={onShown} />
        <span className={styles.dot} data-unread={!item.isRead || undefined} aria-hidden="true" />
        {item.actor.type === 'member' ? (
          <Avatar
            name={item.actor.name}
            id={item.actor.id ?? item.actor.name}
            size="sm"
            isDecorative
            {...(item.actor.imageSrc === undefined ? {} : { src: item.actor.imageSrc })}
            {...(item.actor.hue === undefined ? {} : { hue: item.actor.hue })}
          />
        ) : (
          // Not a person (a form, the system): its mark on the soft gray tile, so it reads beside people's tints.
          <Avatar
            name={item.actor.name}
            size="sm"
            shape="square"
            hue="gray"
            mark={<Icon name={ACTOR_ICONS[item.actor.type]} size="xs" />}
            isDecorative
          />
        )}
        <span className={styles.main}>
          <span className={styles.line}>
            {!item.isRead && <VisuallyHidden>{`${strings.unread} `}</VisuallyHidden>}
            <span className={styles.sentence}>{sentence}</span>
            {item.record !== undefined && <RecordChip display={item.record} />}
            <span className={styles.time}>
              <RelativeTime value={item.createdAt} />
            </span>
          </span>
          {item.excerpt !== '' && (
            <span className={styles.excerpt}>
              <CommentText body={item.excerpt} nameOf={nameOf} isQuiet />
            </span>
          )}
        </span>
        <span className={styles.menu}>
          <MenuTrigger>
            <Button variant="ghost" icon="ellipsis" label={strings.moreActions} />
            <Menu
              label={strings.moreActions}
              onAction={(key) => {
                if (key === 'read') onMark(item.id, { read: !item.isRead });
                else onMark(item.id, { done: !item.isDone });
              }}
            >
              <MenuItem id="read" kbd="U" icon={item.isRead ? 'mail' : 'mail-open'}>
                {item.isRead ? strings.markUnread : strings.markRead}
              </MenuItem>
              <MenuItem id="done" kbd="E" icon={item.isDone ? 'inbox' : 'check'}>
                {item.isDone ? strings.moveToInbox : strings.markDone}
              </MenuItem>
            </Menu>
          </MenuTrigger>
        </span>
      </GridListItem>
    );
  };

  return (
    // Keys on a focused row bubble here; the grid keeps its own arrows and Enter.
    // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- the grid's rows take focus; this only hears their U and E
    <div className={styles.frame} onKeyDown={keyDown}>
      <Virtualizer layout={ListLayout} layoutOptions={{ estimatedRowHeight: ESTIMATED_ROW * sizeToken('size-row') }}>
        <GridList
          className={styles.root}
          aria-label={label}
          // U and E act on the focused row; typing a letter must not move focus to a row first.
          disallowTypeAhead
          items={rows}
          dependencies={[items, fontsSettled, names]}
          onAction={(key) => {
            const item = itemOfKey(items, rows, key);
            if (item !== undefined) onAction(item.id);
          }}
        >
          {renderRow}
        </GridList>
      </Virtualizer>
    </div>
  );
}
