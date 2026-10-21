// Comments as the library draws them (spec 0038, value sourcing): plain
// functions with no React, so they test in Node. An author, a resolver and
// who reacted are named from the members ("Former member" for one no longer
// active), and a `thread` search param names one thread by its id.
import type { ActorDisplay, MemberSummary, ShownComment, ShownThread } from '@crm/data';
import type { CommentItem, CommentThreadItem } from '@crm/ui';
import { actorDisplay } from '../notes/entries.ts';
import { strings } from './strings.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `?thread=` names a thread: a uuid, anything else is dropped. */
export function isThreadParam(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** The active members as the composer's `@` list and the mentions' names. */
export function memberDisplays(members: readonly MemberSummary[]): readonly ActorDisplay[] {
  return members.map((member) => ({ type: 'member', id: member.id, name: member.name, email: member.email }));
}

/** A member's name by id, "Former member" for one no longer here. */
const nameOf = (members: readonly MemberSummary[], memberId: string) =>
  members.find((member) => member.id === memberId)?.name ?? strings.formerMember;

/** One comment as CommentThread's row. */
export function toCommentItem(comment: ShownComment, members: readonly MemberSummary[]): CommentItem {
  return {
    id: comment.id,
    isDeleted: comment.isDeleted,
    ...(comment.isSending === true ? { isSending: true } : {}),
    ...(comment.createdBy === undefined ? {} : { author: actorDisplay(members, comment.createdBy) }),
    createdAt: comment.createdAt,
    ...(comment.editedAt === undefined ? {} : { editedAt: comment.editedAt }),
    body: comment.body,
    reactions: comment.reactions.map((reaction) => ({
      emoji: reaction.emoji,
      count: reaction.count,
      mine: reaction.mine,
      names: reaction.memberIds.map((id) => nameOf(members, id)),
    })),
    canEdit: comment.canEdit,
    canDelete: comment.canDelete,
  };
}

/** A thread as CommentThread takes it. */
export function toThreadItem(thread: ShownThread, members: readonly MemberSummary[]): CommentThreadItem {
  return {
    id: thread.id,
    ...(thread.resolvedAt === undefined ? {} : { resolvedAt: thread.resolvedAt }),
    ...(thread.resolvedBy === undefined ? {} : { resolvedBy: actorDisplay(members, thread.resolvedBy) }),
    earlierCount: thread.earlierCount,
    comments: thread.comments.map((comment) => toCommentItem(comment, members)),
  };
}
