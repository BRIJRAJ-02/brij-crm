// A comment being written (spec 0038, AC-1152, AC-1154): a field one line
// tall at rest that grows to ten, and the `@` list of members under it. The
// person sees "@Name"; the comment stores the member's id. Comment (or ⌘Enter,
// Ctrl+Enter) sends; Esc clears focus, or cancels a reply or an edit.
import type { ActorDisplay } from '@crm/contracts/values';
import { COMMENT_MAX } from '@crm/contracts/mentions';
import { useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { MentionList, mentionOptionId } from '../../editor/MentionList.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Field } from '../Field/Field.tsx';
import styles from './CommentComposer.module.css';
import { bodyOf, draftOf, EMPTY_DRAFT, edited, matchingMembers, picked, queryAt, type Draft } from './draft.ts';
import { strings } from './strings.ts';

/** At most this many members show in the `@` list. */
const SHOWN_MEMBERS = 8;

/** What the composer is for: a new thread, a reply in one, or an edit of a comment. */
export type CommentComposerMode = 'new' | 'reply' | 'edit';

/** Props for CommentComposer. */
export interface CommentComposerProps {
  readonly mode?: CommentComposerMode;
  /** Every active member, for the `@` list; also what names a mention in an edited text. */
  readonly members: readonly ActorDisplay[];
  /** An edit's starting text, with its mention tokens. */
  readonly initialBody?: string;
  /** The name of a member no longer in the list ("Former member"). */
  readonly formerMember?: string;
  /**
   * Sends the text (mentions as tokens). A new comment or reply clears at once
   * and shows in the thread; answer a refusal's reason to put the text back
   * with it and a Retry, or nothing when it landed.
   */
  readonly onSubmit: (body: string) => Promise<string | undefined>;
  /** Esc or Cancel on a reply or an edit. */
  readonly onCancel?: () => void;
  /** Up in an empty reply composer: edit the person's last comment of the thread. */
  readonly onEditLast?: () => void;
  readonly autoFocus?: boolean;
  /** Read only (the record is in the trash): nothing to send. */
  readonly isDisabled?: boolean;
  /** Its text field, for a screen that sends focus here (after a delete took the focused comment away). */
  readonly fieldRef?: RefObject<HTMLTextAreaElement | null>;
}

/**
 * The comment composer: the growing field (it suggests from the `@` list), the
 * count past 9,000 characters, Comment with ⌘↵, and Cancel on a reply or an
 * edit. A refused comment comes back with its reason and a Retry.
 */
export function CommentComposer({
  mode = 'new',
  members,
  initialBody,
  formerMember = '',
  onSubmit,
  onCancel,
  onEditLast,
  autoFocus = false,
  isDisabled = false,
  fieldRef,
}: CommentComposerProps) {
  const listId = useId();
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const names = useMemo(() => new Map(members.map((member) => [member.id ?? '', member.name])), [members]);
  const [draft, setDraft] = useState<Draft>(() =>
    initialBody === undefined ? EMPTY_DRAFT : draftOf(initialBody, (id) => names.get(id) ?? formerMember),
  );
  const [caret, setCaret] = useState(draft.text.length);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | undefined>(undefined);
  const [refusal, setRefusal] = useState<
    { readonly reason: string; readonly draft: Draft; readonly canRetry: boolean } | undefined
  >(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const query = queryAt(draft, caret);
  const isOpen = query !== undefined && query.start !== dismissedAt && !isDisabled;
  const typed = query?.query;
  const shown = useMemo(
    () => (typed === undefined ? [] : matchingMembers(members, typed, SHOWN_MEMBERS)),
    [members, typed],
  );
  const activeIndex = Math.min(active, Math.max(shown.length - 1, 0));

  // A pick or a cut mention moves the caret where the text changed, once React has written the new text.
  const placeCaret = (at: number) => {
    requestAnimationFrame(() => {
      field.current?.setSelectionRange(at, at);
    });
  };

  const change = (text: string) => {
    const next = edited(draft, text);
    setDraft(next.draft);
    setRefusal(undefined);
    const at = next.caret ?? field.current?.selectionStart ?? text.length;
    setCaret(at);
    if (next.caret !== undefined) placeCaret(next.caret);
    setActive(0);
  };

  const pick = (member: ActorDisplay) => {
    if (query === undefined || member.id === null) return;
    const next = picked(draft, query.start, caret, { id: member.id, name: member.name });
    setDraft(next.draft);
    setCaret(next.caret);
    placeCaret(next.caret);
    setActive(0);
  };

  const send = async (from: Draft = draft) => {
    const body = bodyOf(from).trim();
    if (isSaving) return;
    if (body === '') {
      // An edit emptied of its text is refused here, with the way out (AC-1155); a new one just waits for text.
      if (mode === 'edit') setRefusal({ reason: strings.emptyEdit, draft: from, canRetry: false });
      return;
    }
    setRefusal(undefined);
    if (mode === 'edit') setIsSaving(true);
    else {
      // Shown in the thread at once, marked sending; the field is ready for the next one.
      setDraft(EMPTY_DRAFT);
      setCaret(0);
    }
    const reason = await onSubmit(body);
    setIsSaving(false);
    if (reason === undefined) return;
    setDraft(from);
    setRefusal({ reason, draft: from, canRetry: true });
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (isOpen && shown.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((activeIndex + step + shown.length) % shown.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const member = shown[activeIndex];
        if (member !== undefined) {
          event.preventDefault();
          pick(member);
        }
        return;
      }
    }
    if (isOpen && event.key === 'Escape') {
      event.preventDefault();
      setDismissedAt(query.start);
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (onCancel !== undefined) onCancel();
      else field.current?.blur();
      return;
    }
    if (event.key === 'ArrowUp' && draft.text === '' && onEditLast !== undefined) {
      event.preventDefault();
      onEditLast();
    }
  };

  const submitLabel = mode === 'edit' ? strings.save : mode === 'reply' ? strings.reply : strings.comment;
  const isEmpty = bodyOf(draft).trim() === '';
  return (
    <div className={styles.root} data-mode={mode}>
      <div className={styles.field}>
        <Field
          ref={(element) => {
            field.current = element;
            if (fieldRef !== undefined) fieldRef.current = element;
          }}
          label={mode === 'reply' ? strings.reply : mode === 'edit' ? strings.editComment : strings.newComment}
          isLabelHidden
          variant="composer"
          isMultiline
          value={draft.text}
          onChange={change}
          onSelect={(event) => {
            setCaret(event.currentTarget.selectionStart ?? 0);
          }}
          onKeyDown={keyDown}
          placeholder={mode === 'new' ? strings.placeholder : strings.replyPlaceholder}
          maxLength={COMMENT_MAX}
          showCounter
          isDisabled={isDisabled}
          // eslint-disable-next-line jsx-a11y-x/no-autofocus -- only a reply or an edit someone just opened asks for it
          autoFocus={autoFocus}
          combobox={{
            listId,
            isExpanded: isOpen,
            ...(shown.length > 0 ? { activeId: mentionOptionId(listId, activeIndex) } : {}),
          }}
        />
        {isOpen && (
          <MentionList
            anchorRef={field}
            id={listId}
            members={shown}
            activeIndex={activeIndex}
            isLoading={false}
            onPick={pick}
            onHighlight={setActive}
          />
        )}
      </div>
      {refusal !== undefined && (
        <Callout
          tone="danger"
          title={mode === 'edit' ? strings.notSaved : strings.notSent}
          {...(refusal.canRetry
            ? {
                actions: (
                  <Button
                    size="md"
                    onPress={() => {
                      void send(refusal.draft);
                    }}
                  >
                    {strings.retry}
                  </Button>
                ),
              }
            : {})}
        >
          {refusal.reason}
        </Callout>
      )}
      <div className={styles.actions}>
        {onCancel !== undefined && (
          <Button kbd="ESC" onPress={onCancel}>
            {strings.cancel}
          </Button>
        )}
        <Button
          variant="primary"
          kbd="⌘↵"
          // An edit's Save stays on with the text gone, so it can say why it won't save.
          isDisabled={isDisabled || (isEmpty && mode !== 'edit')}
          isPending={isSaving}
          onPress={() => {
            void send();
          }}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
