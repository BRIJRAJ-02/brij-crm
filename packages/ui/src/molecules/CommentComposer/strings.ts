/** CommentComposer's built in copy. */
export const strings = {
  /** The field's name for screen readers, and its placeholder, on a new thread. */
  newComment: 'Add a comment',
  editComment: 'Edit comment',
  placeholder: 'Add a comment. Type @ to mention someone.',
  replyPlaceholder: 'Reply. Type @ to mention someone.',
  /** Send on a new thread. */
  comment: 'Comment',
  reply: 'Reply',
  save: 'Save',
  cancel: 'Cancel',
  /** The refusal's title, over its reason, with Retry. */
  notSent: 'Your comment wasn’t sent.',
  notSaved: 'Your edit wasn’t saved.',
  retry: 'Retry',
  /** Saving an edit with no text left (AC-1155). */
  emptyEdit: 'A comment can’t be empty. Delete it instead.',
  /** Announced while the list of members shows. */
  members: 'People to mention',
} as const;
