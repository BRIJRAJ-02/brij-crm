// One thread of comments on a record (spec 0038, AC-1151 to AC-1158): its
// first comment and replies in order, each with its author, time, text (with
// mentions as the Mention atom, links clickable, line breaks kept), "edited"
// with its earlier versions, reactions and a menu; Reply under the last one;
// the resolved line on a resolved thread. Data comes in through props: the
// screen sends every change and confirms a delete.
import type { ActorDisplay } from '@crm/contracts/values';
import { bodySegments, COMMENT_EMOJI, type CommentEmoji } from '@crm/contracts/mentions';
import { Fragment, useState, type ReactNode } from 'react';
import { Dialog, DialogTrigger } from 'react-aria-components';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Button, ToggleButton } from '../../atoms/Button/Button.tsx';
import { Link } from '../../atoms/Link/Link.tsx';
import { Mention } from '../../atoms/Mention/Mention.tsx';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { safeHref } from '../../lib/safe-href.ts';
import { CommentComposer } from '../../molecules/CommentComposer/CommentComposer.tsx';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { Popover } from '../../molecules/Popover/Popover.tsx';
import styles from './CommentThread.module.css';
import { strings } from './strings.ts';

/** A reaction on a comment as the reader sees it. */
export interface CommentReactionItem {
  readonly emoji: CommentEmoji;
  readonly count: number;
  /** One of them is the reader's: the chip shows pressed. */
  readonly mine: boolean;
  /** The first who reacted, by name, for the tooltip. */
  readonly names: readonly string[];
}

/** One comment, as a thread shows it. */
export interface CommentItem {
  readonly id: string;
  /** A deleted comment kept while its thread still reads: no author, text or reactions. */
  readonly isDeleted: boolean;
  /** This tab's comment on its way to the server. */
  readonly isSending?: boolean;
  readonly author?: ActorDisplay;
  /** ISO 8601 in UTC. */
  readonly createdAt: string;
  readonly editedAt?: string;
  /** The text, mentions as `<@member-uuid>` tokens. */
  readonly body: string;
  readonly reactions: readonly CommentReactionItem[];
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}

/** One earlier text of a comment, for the "edited" popover. */
export interface CommentVersionItem {
  readonly version: number;
  readonly body: string;
  readonly at: string;
}

/** A thread as a screen hands it over. */
export interface CommentThreadItem {
  readonly id: string;
  readonly resolvedAt?: string;
  readonly resolvedBy?: ActorDisplay;
  /** Replies before the ones shown, which "Show earlier replies" brings. */
  readonly earlierCount: number;
  readonly comments: readonly CommentItem[];
}

/** Props for CommentThread. */
export interface CommentThreadProps {
  readonly thread: CommentThreadItem;
  /** Every active member: mentions' names and the reply composer's `@` list. */
  readonly members: readonly ActorDisplay[];
  /** The name a mention of someone no longer a member shows ("Former member"). */
  readonly formerMember: string;
  /** Nothing changes it (a record in the trash): no composer, no menus, no reaction buttons. */
  readonly isReadOnly?: boolean;
  /** Opened from a link: highlighted for a moment. */
  readonly isHighlighted?: boolean;
  /** Sends a reply; answers a refusal's reason, or nothing. */
  readonly onReply: (body: string) => Promise<string | undefined>;
  /** Saves an edit; answers a refusal's reason, or nothing. */
  readonly onEdit: (commentId: string, body: string) => Promise<string | undefined>;
  /** Asks to delete a comment (the screen confirms first). */
  readonly onDelete: (commentId: string) => void;
  readonly onResolve: (resolved: boolean) => void;
  readonly onReact: (commentId: string, emoji: CommentEmoji, on: boolean) => void;
  /** Loads a comment's earlier texts, newest first; undefined when they failed. */
  readonly onLoadVersions: (commentId: string) => Promise<readonly CommentVersionItem[] | undefined>;
  /** Shows the replies before the newest ones. */
  readonly onShowEarlier?: () => void;
}

/** A URL in a comment's text, made a link when `safeHref` lets it through. */
const URL_PATTERN = /https?:\/\/[^\s<>]+[^\s<>.,;:!?)\]'"]/g;

/** A comment's text: plain text with its links, and each mention as the Mention atom named from the members. */
export function CommentText({
  body,
  nameOf,
  isQuiet = false,
}: {
  readonly body: string;
  readonly nameOf: (memberId: string) => string;
  /** In the secondary colour: an excerpt under a heading (the inbox). */
  readonly isQuiet?: boolean;
}) {
  const parts: ReactNode[] = [];
  bodySegments(body).forEach((segment, index) => {
    if (segment.kind === 'mention') {
      parts.push(<Mention key={`m${String(index)}`}>{`@${nameOf(segment.memberId)}`}</Mention>);
      return;
    }
    let at = 0;
    for (const match of segment.text.matchAll(URL_PATTERN)) {
      const href = safeHref(match[0]);
      if (href === undefined) continue;
      if (match.index > at) parts.push(segment.text.slice(at, match.index));
      parts.push(
        <Link key={`l${String(index)}-${String(match.index)}`} href={href}>
          {match[0]}
        </Link>,
      );
      at = match.index + match[0].length;
    }
    if (at < segment.text.length) parts.push(segment.text.slice(at));
  });
  return (
    <span className={styles.text} data-quiet={isQuiet || undefined}>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </span>
  );
}

/** The "edited" button and its popover of earlier versions, loaded as it opens. */
function EditedVersions({
  onLoad,
  nameOf,
}: {
  readonly onLoad: () => Promise<readonly CommentVersionItem[] | undefined>;
  readonly nameOf: (memberId: string) => string;
}) {
  const [versions, setVersions] = useState<readonly CommentVersionItem[] | 'loading' | 'failed'>('loading');
  return (
    <DialogTrigger
      onOpenChange={(isOpen) => {
        if (!isOpen) return;
        setVersions('loading');
        void onLoad().then((loaded) => {
          setVersions(loaded ?? 'failed');
        });
      }}
    >
      <Button variant="ghost" size="sm">
        {strings.edited}
      </Button>
      <Popover label={strings.earlierVersions} width="menu">
        <Dialog className={styles.versions} aria-label={strings.earlierVersions}>
          {versions === 'loading' ? (
            <div aria-busy="true">
              <Skeleton lines={2} />
              <VisuallyHidden>{strings.loadingVersions}</VisuallyHidden>
            </div>
          ) : versions === 'failed' ? (
            <p className={styles.muted}>{strings.versionsFailed}</p>
          ) : (
            <ol className={styles.versionList}>
              {versions.map((version) => (
                <li key={version.version} className={styles.version}>
                  <span className={styles.meta}>
                    <RelativeTime value={version.at} />
                  </span>
                  <CommentText body={version.body} nameOf={nameOf} />
                </li>
              ))}
            </ol>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

/** One comment: avatar, name, time, "edited", its text or its edit composer, reactions and its menu. */
function CommentRow({
  comment,
  isFirst,
  thread,
  props,
  nameOf,
  isEditing,
  onStartEdit,
  onStopEdit,
}: {
  readonly comment: CommentItem;
  readonly isFirst: boolean;
  readonly thread: CommentThreadItem;
  readonly props: CommentThreadProps;
  readonly nameOf: (memberId: string) => string;
  readonly isEditing: boolean;
  readonly onStartEdit: () => void;
  readonly onStopEdit: () => void;
}) {
  const { isReadOnly = false } = props;
  if (comment.isDeleted) {
    return (
      <li className={styles.comment} data-deleted="">
        <span className={styles.deletedMark} aria-hidden="true" />
        <p className={styles.muted}>{strings.deleted}</p>
      </li>
    );
  }
  const author = comment.author;
  const name = author?.name ?? props.formerMember;
  const isResolved = thread.resolvedAt !== undefined;
  const canAct = !isReadOnly && comment.isSending !== true;
  const menuItems = [
    ...(comment.canEdit ? [{ id: 'edit', label: strings.edit, icon: 'pencil' as const }] : []),
    ...(isFirst
      ? [{ id: 'resolve', label: isResolved ? strings.reopen : strings.resolve, icon: 'circle-check' as const }]
      : []),
    ...(comment.canDelete ? [{ id: 'delete', label: strings.delete, icon: 'trash' as const, isDanger: true }] : []),
  ];
  return (
    <li className={styles.comment} aria-busy={comment.isSending === true || undefined}>
      <Avatar
        name={name}
        id={author?.id ?? name}
        size="sm"
        isDecorative
        {...(author?.imageSrc === undefined ? {} : { src: author.imageSrc })}
        {...(author?.hue === undefined ? {} : { hue: author.hue })}
      />
      <div className={styles.main}>
        <div className={styles.head}>
          <span className={styles.author}>{name}</span>
          <span className={styles.meta}>
            {comment.isSending === true ? strings.sending : <RelativeTime value={comment.createdAt} />}
          </span>
          {comment.editedAt !== undefined && comment.isSending !== true && (
            <EditedVersions onLoad={() => props.onLoadVersions(comment.id)} nameOf={nameOf} />
          )}
          {canAct && (
            <span className={styles.tools}>
              <MenuTrigger>
                <Button variant="ghost" icon="face-slightly-smiling-plus" label={strings.addReaction} />
                <Menu
                  label={strings.addReaction}
                  onAction={(key) => {
                    const emoji = COMMENT_EMOJI.find((each) => each === key);
                    if (emoji === undefined) return;
                    const mine = comment.reactions.some((reaction) => reaction.emoji === emoji && reaction.mine);
                    props.onReact(comment.id, emoji, !mine);
                  }}
                >
                  {COMMENT_EMOJI.map((emoji) => (
                    <MenuItem key={emoji} id={emoji}>
                      {emoji}
                    </MenuItem>
                  ))}
                </Menu>
              </MenuTrigger>
              {menuItems.length > 0 && (
                <MenuTrigger>
                  <Button variant="ghost" icon="ellipsis" label={strings.moreActions} />
                  <Menu
                    label={strings.moreActions}
                    onAction={(key) => {
                      if (key === 'edit') onStartEdit();
                      else if (key === 'delete') props.onDelete(comment.id);
                      else if (key === 'resolve') props.onResolve(!isResolved);
                    }}
                  >
                    {menuItems.map((item) => (
                      <MenuItem key={item.id} id={item.id} icon={item.icon} isDanger={item.isDanger === true}>
                        {item.label}
                      </MenuItem>
                    ))}
                  </Menu>
                </MenuTrigger>
              )}
            </span>
          )}
        </div>
        {isEditing ? (
          <CommentComposer
            mode="edit"
            members={props.members}
            initialBody={comment.body}
            formerMember={props.formerMember}
            // eslint-disable-next-line jsx-a11y-x/no-autofocus -- Edit was pressed on purpose; the text to change takes focus
            autoFocus
            onCancel={onStopEdit}
            onSubmit={async (body) => {
              const reason = await props.onEdit(comment.id, body);
              if (reason === undefined) onStopEdit();
              return reason;
            }}
          />
        ) : (
          <CommentText body={comment.body} nameOf={nameOf} />
        )}
        {comment.reactions.length > 0 && (
          <div className={styles.reactions}>
            {comment.reactions.map((reaction) => (
              <Tooltip key={reaction.emoji} content={strings.reactedBy(reaction.names, reaction.count)}>
                <ToggleButton
                  size="md"
                  isSelected={reaction.mine}
                  isDisabled={!canAct}
                  onChange={(on) => {
                    props.onReact(comment.id, reaction.emoji, on);
                  }}
                >
                  {strings.reaction(reaction.emoji, reaction.count)}
                </ToggleButton>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * A thread: the resolved line when resolved, its comments in order (deleted
 * ones as "This comment was deleted."), "Show earlier replies" when the
 * newest ones only were read, and Reply, which opens a reply composer under
 * the last comment. Up in an empty reply composer edits the reader's last
 * comment.
 */
export function CommentThread(props: CommentThreadProps) {
  const { thread, members, formerMember, isReadOnly = false, isHighlighted = false } = props;
  const [isReplying, setIsReplying] = useState(false);
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const names = new Map(members.map((member) => [member.id ?? '', member.name]));
  const nameOf = (memberId: string) => names.get(memberId) ?? formerMember;
  const [first, ...replies] = thread.comments;
  if (first === undefined) return null;
  const starter = first.author?.name ?? formerMember;
  const lastMine = [...thread.comments].reverse().find((comment) => comment.canEdit && !comment.isDeleted);
  const row = (comment: CommentItem, isFirst: boolean) => (
    <CommentRow
      key={comment.id}
      comment={comment}
      isFirst={isFirst}
      thread={thread}
      props={props}
      nameOf={nameOf}
      isEditing={editing === comment.id}
      onStartEdit={() => {
        setEditing(comment.id);
      }}
      onStopEdit={() => {
        setEditing(undefined);
      }}
    />
  );
  return (
    <article
      className={styles.root}
      aria-label={strings.thread(starter)}
      data-highlighted={isHighlighted || undefined}
      data-resolved={thread.resolvedAt !== undefined || undefined}
    >
      {thread.resolvedAt !== undefined && (
        <p className={styles.resolved}>
          <span>{strings.resolvedBy(thread.resolvedBy?.name ?? formerMember)}</span>
          <span aria-hidden="true">{strings.separator}</span>
          <RelativeTime value={thread.resolvedAt} />
        </p>
      )}
      <ol className={styles.comments}>
        {row(first, true)}
        {thread.earlierCount > 0 && props.onShowEarlier !== undefined && (
          <li className={styles.earlier}>
            <Button variant="ghost" onPress={props.onShowEarlier}>
              {strings.earlierReplies(thread.earlierCount)}
            </Button>
          </li>
        )}
        {replies.map((comment) => row(comment, false))}
      </ol>
      {!isReadOnly &&
        (isReplying ? (
          <div className={styles.reply}>
            <CommentComposer
              mode="reply"
              members={members}
              formerMember={formerMember}
              // eslint-disable-next-line jsx-a11y-x/no-autofocus -- Reply was pressed on purpose; the reply field takes focus
              autoFocus
              onCancel={() => {
                setIsReplying(false);
              }}
              {...(lastMine === undefined
                ? {}
                : {
                    onEditLast: () => {
                      setIsReplying(false);
                      setEditing(lastMine.id);
                    },
                  })}
              onSubmit={props.onReply}
            />
          </div>
        ) : (
          <div className={styles.replyBar}>
            <Button
              variant="ghost"
              icon="message-square"
              onPress={() => {
                setIsReplying(true);
              }}
            >
              {strings.reply}
            </Button>
          </div>
        ))}
    </article>
  );
}
