// Brief
// Purpose: the link page's block editors (spec 0051): one Modal per kind, for an add and an edit.
// Main task: type a block's fields and see it as a visitor will, then Add or Save; it shows on the list at once.
// Leaves out: saving itself (the screen does, through the data layer, optimistic), and any kind without an entry in
// the registry.
import type { BlockDraft, BlockProblems, ProfileFormChoice, ProfileLinkIcon, ProfilePageChoice } from '@crm/data';
import {
  Button,
  ButtonLink,
  Callout,
  ChoiceChips,
  EmptyState,
  Field,
  Form,
  Modal,
  QuestionList,
  PhoneField,
  Select,
  Skeleton,
  type IconName,
  type PhoneFieldValue,
  type SelectItem,
} from '@crm/ui';
import { countryOfE164, DIAL_CODES, toE164 } from '@crm/contracts/forms';
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formsHref } from '../captures/tabs.ts';
import { linksHref } from '../booking/links.ts';
import { DraftPage } from './draft-look.tsx';
import { contactHref, contactWords, pageFacts, type BlockEditorProps, type EditorChrome } from './registry.tsx';
import { ICON_WORDS, strings } from './strings.ts';

/**
 * The one Add modal's own places, while an editor is drawn inside it. Adding used to mount a Modal per kind, so
 * every press of the kind picker unmounted one dialog and mounted another: the whole popup flashed open again,
 * and focus left the picker (the owner, 25 October 2026). Now the dialog, its title, its picker and Cancel are
 * the frame's and stay put; only the fields under the picker change, and the editor's submit button travels to
 * the place beside Cancel that the frame keeps for it.
 */
interface EditorFrame {
  /** Beside Cancel, where this editor's submit goes. */
  readonly action: HTMLElement | null;
  /**
   * Whether the editor's form takes focus as it mounts: only for the kind the modal opened on. Once the person is in
   * the picker, an arrow that swaps the kind must leave focus on the tiles (spec 0058, AC-4 and AC-9), and the frame
   * moves focus to the fields itself when a kind is picked with Enter, Space or a click.
   */
  readonly focusesFields: boolean;
}
const EditorFrameContext = createContext<EditorFrame | undefined>(undefined);

/** Whether a block editor's form focuses its first field as it mounts: always alone, only on opening in the frame. */
export function useFocusesFirstField(): boolean {
  return useContext(EditorFrameContext)?.focusesFields ?? true;
}

/** The first field of the chosen kind: the first one in the dialog that isn't in the picker. */
function firstFieldOutside(picker: HTMLElement): HTMLElement | undefined {
  const dialog = picker.closest('[role="dialog"]');
  if (dialog === null) return undefined;
  const fields = dialog.querySelectorAll<HTMLElement>('input:not([type="hidden"]), textarea, select');
  return [...fields].find((field) => !picker.contains(field));
}

/**
 * The Add modal: the dialog itself, its title and hint, the kind picker and Cancel, all of which outlive the kind
 * being changed. The chosen kind's editor is drawn inside it and brings only its fields.
 */
export function BlockEditorFrame({
  title,
  hint,
  leading,
  onClose,
  children,
}: {
  readonly title: string;
  readonly hint?: ReactNode;
  /** The kind picker, above the fields. */
  readonly leading?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const [action, setAction] = useState<HTMLElement | null>(null);
  const [focusesFields, setFocusesFields] = useState(true);
  const frame = useMemo(() => ({ action, focusesFields }), [action, focusesFields]);
  const pickerRef = useRef<HTMLDivElement>(null);
  // Picking a kind (Enter, Space or a click) moves on to its fields, once the swapped editor has drawn them. An arrow
  // only moves along the tiles and swaps the fields under them, so a keyboard can cross the whole grid.
  const toFields = () => {
    requestAnimationFrame(() => {
      const picker = pickerRef.current;
      if (picker !== null) firstFieldOutside(picker)?.focus();
    });
  };
  return (
    <Modal
      title={title}
      {...(hint === undefined ? {} : { hint })}
      isOpen
      // Something typed is kept from a stray click outside: only Cancel or Esc throws it away.
      isDismissable={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <div ref={setAction} />
        </>
      }
    >
      {leading !== undefined && (
        // Not a control of its own: it only listens to the picker's tiles, which keep their own keys and names.
        <div
          ref={pickerRef}
          // Capture: React Aria's radio group handles the arrows and stops them from bubbling.
          onPointerDownCapture={() => setFocusesFields(false)}
          onKeyDownCapture={(event) => {
            setFocusesFields(false);
            if (event.key === 'Enter') toFields();
          }}
          onKeyUpCapture={(event) => {
            if (event.key === ' ') toFields();
          }}
          onClickCapture={(event) => {
            // A pointer's click (detail 1 or more), not the one a key makes, which onKeyUp has handled.
            if (event.detail > 0) toFields();
          }}
        >
          {leading}
        </div>
      )}
      <EditorFrameContext value={frame}>{children}</EditorFrameContext>
    </Modal>
  );
}

/** The Modal every block editor sits in: its title, Cancel and the submit, and "How it looks" under the fields. */
function EditorModal({
  title,
  formId,
  submitLabel,
  onClose,
  preview,
  canSubmit = true,
  chrome,
  children,
}: {
  readonly title: string;
  readonly formId: string;
  readonly submitLabel: string;
  readonly onClose: () => void;
  readonly preview?: ReactNode;
  /** False while there is nothing to submit (the choices loading, failed or empty): only Cancel shows. */
  readonly canSubmit?: boolean;
  readonly chrome?: EditorChrome;
  readonly children: ReactNode;
}) {
  const frame = useContext(EditorFrameContext);
  const submit = canSubmit ? (
    <Button variant="primary" type="submit" form={formId}>
      {chrome?.submitLabel ?? submitLabel}
    </Button>
  ) : undefined;
  // Inside the Add modal the dialog is the frame's, so this is the fields alone and a submit that travels.
  if (frame !== undefined) {
    return (
      <>
        {children}
        {preview}
        {submit !== undefined && frame.action !== null && createPortal(submit, frame.action)}
      </>
    );
  }
  return (
    <Modal
      title={title}
      isOpen
      // Something typed is kept from a stray click outside: only Cancel or Esc throws it away.
      isDismissable={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          {submit}
        </>
      }
    >
      {children}
      {preview}
    </Modal>
  );
}

/** The icons a link may pick, with Automatic first (the network's logo, else the letter). */
function iconItems(icons: readonly ProfileLinkIcon[]): readonly SelectItem[] {
  return [
    { id: 'auto', label: strings.iconAuto, description: strings.iconAutoText, icon: 'link' },
    ...icons.map((icon) => ({ id: icon, label: ICON_WORDS[icon] ?? icon, icon })),
  ];
}

/** The site an address names, for a link's title left empty: "example.com" from "https://www.example.com/a". */
function siteOf(url: string): string | undefined {
  const typed = url.trim();
  // An email address or a phone number names no site: those still ask for a title.
  if (typed === '' || typed.includes('@') || /^[+\d\s()-]+$/.test(typed)) return undefined;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`).hostname.replace(
      /^www\./,
      '',
    );
    return host.includes('.') ? host.slice(0, 60) : undefined;
  } catch {
    return undefined;
  }
}

/** Add or edit a link: its title, address, note and icon, with the block drawn as typed under them. */
export function LinkEditor({
  item,
  items,
  newHue,
  linkPage,
  socialNetworks,
  chrome,
  onSubmit,
  onClose,
}: BlockEditorProps) {
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'link' ? item : undefined;
  // A title that was only the address's site starts empty, so it keeps following the address when that changes.
  const [title, setTitle] = useState(
    editing === undefined || editing.title === siteOf(editing.url) ? '' : editing.title,
  );
  const [url, setUrl] = useState(editing?.url ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [icon, setIcon] = useState<string>(editing?.icon ?? 'auto');
  const [problems, setProblems] = useState<BlockProblems>({});
  const icons = useMemo(() => iconItems(linkPage.icons), [linkPage]);
  // Left empty, the title is the address's site ("example.com"), shown as the placeholder and in the preview, so
  // a link added with its address alone is never refused (flow walks, 29 October 2026: L3).
  const guessed = siteOf(url);
  const draft: BlockDraft = {
    kind: 'link',
    title: title.trim() === '' ? (guessed ?? title) : title,
    url,
    note,
    ...(icon === 'auto' ? {} : { icon }),
    ...(editing === undefined ? {} : { hue: editing.hue }),
  };
  // The block as it will show: the address as it will be stored when it can be, else as typed.
  const checked = linkPage.check(draft, items, editing?.id);
  const shownUrl = checked.ok && checked.block.kind === 'link' ? checked.block.url : url.trim();
  const mark = linkPage.markOf(shownUrl);
  // Allowed all the same: someone may want their LinkedIn as a big row too (crm-87, phase 1c review).
  const isInSocials = mark !== undefined && socialNetworks.includes(mark);
  const submit = () => {
    if (!checked.ok) {
      setProblems(checked.problems);
      return;
    }
    onSubmit(draft);
  };
  return (
    <EditorModal
      title={editing === undefined ? strings.newLink : strings.editLink}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        <DraftPage
          layout="blocks"
          caption={strings.howItLooks}
          blocks={[
            {
              kind: 'link',
              id: editing?.id ?? 'draft',
              title: title.trim() === '' ? (guessed ?? strings.linkTitlePlaceholder) : title.trim(),
              // Only a checked address: one the rule refuses draws as words, never as a link.
              href: checked.ok ? shownUrl : '',
              hue: editing?.hue ?? newHue,
              ...(note.trim() === '' ? {} : { note: note.trim() }),
              ...(mark === undefined ? {} : { mark }),
              ...(icon === 'auto' ? {} : { icon: icon as IconName }),
            },
          ]}
        />
      }
    >
      <Form
        id={formId}
        onSubmit={submit}
        label={editing === undefined ? strings.newLink : strings.editLink}
        focusesFirstField={focusFirst}
      >
        <Field
          label={strings.linkUrl}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          isRequired
          isVerbatim
          maxLength={2_000}
          placeholder={strings.linkUrlPlaceholder}
          hint={isInSocials ? strings.alreadySocial : strings.linkUrlHint}
          value={url}
          onChange={(next) => {
            setUrl(next);
            if (problems.url !== undefined) setProblems({ ...problems, url: undefined });
          }}
          {...(problems.url !== undefined
            ? { error: problems.url }
            : editing?.outsideWorkspace === true && url === editing.url
              ? // Said at once, before a save the server would refuse (spec 0056, AC-5612).
                { error: strings.notInWorkspaceFix }
              : {})}
        />
        <Field
          label={strings.linkTitle}
          name="title"
          autoComplete="off"
          isRequired={guessed === undefined}
          maxLength={60}
          placeholder={guessed ?? strings.linkTitlePlaceholder}
          value={title}
          onChange={(next) => {
            setTitle(next);
            if (problems.title !== undefined) setProblems({ ...problems, title: undefined });
          }}
          {...(problems.title === undefined ? {} : { error: problems.title })}
        />
        <Field
          label={strings.linkNote}
          name="note"
          autoComplete="off"
          maxLength={120}
          showCounter
          placeholder={strings.linkNotePlaceholder}
          value={note}
          onChange={(next) => {
            setNote(next);
            if (problems.note !== undefined) setProblems({ ...problems, note: undefined });
          }}
          {...(problems.note === undefined ? {} : { error: problems.note })}
        />
        <Select
          label={strings.linkIcon}
          items={icons}
          value={icon}
          searchLabel={strings.linkIcon}
          onChange={(next) => setIcon(next ?? 'auto')}
          {...(problems.icon === undefined ? {} : { error: problems.icon })}
        />
      </Form>
    </EditorModal>
  );
}

/** Add or rename a heading: its text, with the heading drawn as typed under it. */
export function HeadingEditor({ item, items, linkPage, chrome, onSubmit, onClose }: BlockEditorProps) {
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'heading' ? item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  // A heading written before folders has no group, which is the open heading the page already drew (AC-5415).
  const [group, setGroup] = useState<'open' | 'folder'>(editing?.group ?? 'open');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const draft = () => ({ kind: 'heading' as const, title, group });
  const submit = () => {
    const checked = linkPage.check(draft(), items, editing?.id);
    if (!checked.ok) {
      setProblem(checked.problems.title);
      return;
    }
    onSubmit(draft());
  };
  return (
    <EditorModal
      title={editing === undefined ? strings.newHeading : strings.editHeading}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        <DraftPage
          layout="blocks"
          caption={strings.howItLooks}
          blocks={[
            {
              kind: 'heading',
              id: editing?.id ?? 'draft',
              title: title.trim() === '' ? strings.headingPlaceholder : title.trim(),
              group,
            },
            // A folder with nothing under it draws as a plain heading (AC-5419), so the preview puts one block
            // there: without it, picking Folds shut would change nothing on screen.
            { kind: 'text', id: 'draft-under', body: strings.headingUnder },
          ]}
        />
      }
    >
      <Form
        id={formId}
        onSubmit={submit}
        label={editing === undefined ? strings.newHeading : strings.editHeading}
        focusesFirstField={focusFirst}
      >
        <Field
          label={strings.headingTitle}
          name="title"
          autoComplete="off"
          isRequired
          maxLength={40}
          showCounter
          placeholder={strings.headingPlaceholder}
          value={title}
          onChange={(next) => {
            setTitle(next);
            setProblem(undefined);
          }}
          {...(problem === undefined ? {} : { error: problem })}
        />
        <ChoiceChips
          isSingle
          label={strings.headingGroup}
          choices={[
            { id: 'open', label: strings.headingOpen },
            { id: 'folder', label: strings.headingFolder },
          ]}
          selected={[group]}
          onChange={(picked) => {
            if (picked[0] === 'folder' || picked[0] === 'open') setGroup(picked[0]);
          }}
        />
      </Form>
    </EditorModal>
  );
}

/**
 * Email signup (spec 0052, AC-5217). Not a kind of its own: it makes a hosted form that asks one thing, an
 * address, publishes it, and then hands back an ordinary form block pointing at it. So the addresses land in that
 * form's responses, where every other capture on Timefix already lands, and the person's existing routing,
 * notifications and export work on them unchanged. The modal says where they will go before it makes anything.
 */
export function SignupEditor({ slug, items, linkPage, chrome, onSubmit, onClose }: BlockEditorProps) {
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const [workspaces, setWorkspaces] = useState<readonly { id: string; slug: string; name: string }[]>([]);
  const [where, setWhere] = useState<string | null>(slug);
  const [words, setWords] = useState('');
  const [button, setButton] = useState('');
  const [label, setLabel] = useState('');
  const [isMaking, setMaking] = useState(false);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [problems, setProblems] = useState<BlockProblems>({});
  useEffect(() => {
    let isCurrent = true;
    linkPage.signup.workspaces().then(
      (found) => {
        if (isCurrent) setWorkspaces(found);
      },
      () => {
        // The list only names where it goes; without it the one the editor is in still works.
        if (isCurrent) setWorkspaces([]);
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [linkPage]);

  const chosen = where ?? slug;
  const rowLabel = label.trim() === '' ? strings.signupLabelPlaceholder : label.trim();
  const headline = words.trim() === '' ? strings.signupWordsPlaceholder : words.trim();
  const buttonText = button.trim() === '' ? strings.signupButtonPlaceholder : button.trim();
  const submit = () => {
    // The row's own words are checked before anything is made, so a refusal never leaves a stray form behind.
    const checked = linkPage.check({ kind: 'form', workspaceId: 'x', formId: 'x', label: rowLabel }, items);
    if (!checked.ok) {
      setProblems(checked.problems);
      return;
    }
    setFailed(undefined);
    setMaking(true);
    linkPage.signup.make(chosen, { name: rowLabel, headline, buttonText }).then(
      (made) => {
        setMaking(false);
        onSubmit(
          { kind: 'form', workspaceId: made.workspaceId, formId: made.formId, label: rowLabel },
          { form: made.facts },
        );
      },
      (error: unknown) => {
        setMaking(false);
        setFailed(error instanceof Error && error.message !== '' ? error.message : strings.signupFailed);
      },
    );
  };
  return (
    <EditorModal
      title={strings.newSignup}
      formId={formId}
      submitLabel={isMaking ? strings.signupMaking : strings.add}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        <DraftPage
          layout="blocks"
          caption={strings.howItLooks}
          blocks={[{ kind: 'form', id: 'draft', title: rowLabel, href: '/f/draft' }]}
        />
      }
    >
      <Form id={formId} onSubmit={submit} label={strings.newSignup} focusesFirstField={focusFirst}>
        {failed !== undefined && <Callout tone="danger">{failed}</Callout>}
        <Field
          label={strings.signupLabel}
          name="label"
          autoComplete="off"
          isRequired
          maxLength={60}
          placeholder={strings.signupLabelPlaceholder}
          value={label}
          onChange={(next) => {
            setLabel(next);
            setProblems((held) => ({ ...held, title: undefined }));
          }}
          {...(problems.title === undefined ? {} : { error: problems.title })}
        />
        <Field
          label={strings.signupWords}
          name="words"
          autoComplete="off"
          maxLength={120}
          placeholder={strings.signupWordsPlaceholder}
          hint={strings.signupWordsHint}
          value={words}
          onChange={setWords}
        />
        <Field
          label={strings.signupButton}
          name="button"
          autoComplete="off"
          maxLength={40}
          placeholder={strings.signupButtonPlaceholder}
          value={button}
          onChange={setButton}
        />
        {workspaces.length > 1 && (
          <Select
            label={strings.signupWorkspace}
            hint={strings.signupWorkspaceHint}
            items={workspaces.map((each): SelectItem => ({ id: each.slug, label: each.name }))}
            value={chosen}
            onChange={(next) => {
              setWhere(next ?? slug);
            }}
          />
        )}
      </Form>
    </EditorModal>
  );
}

/** Add or edit something a customer said: the words, who said them, and what they do. No photo: the page loads none. */
export function TestimonialEditor({ item, items, linkPage, chrome, onSubmit, onClose }: BlockEditorProps) {
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'testimonial' ? item : undefined;
  const [quote, setQuote] = useState(editing?.quote ?? '');
  const [author, setAuthor] = useState(editing?.author ?? '');
  const [role, setRole] = useState(editing?.role ?? '');
  const [problems, setProblems] = useState<BlockProblems>({});
  const draft = () => {
    const kept = role.trim();
    return { kind: 'testimonial' as const, quote, author, ...(kept === '' ? {} : { role: kept }) };
  };
  const submit = () => {
    const checked = linkPage.check(draft(), items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      return;
    }
    onSubmit(draft());
  };
  return (
    <EditorModal
      title={editing === undefined ? strings.newTestimonial : strings.editTestimonial}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        <DraftPage
          layout="blocks"
          caption={strings.howItLooks}
          blocks={[
            {
              kind: 'testimonial',
              id: editing?.id ?? 'draft',
              quote: quote.trim() === '' ? strings.quotePlaceholder : quote,
              author: author.trim() === '' ? strings.authorPlaceholder : author.trim(),
              ...(role.trim() === '' ? {} : { role: role.trim() }),
            },
          ]}
        />
      }
    >
      <Form
        id={formId}
        onSubmit={submit}
        label={editing === undefined ? strings.newTestimonial : strings.editTestimonial}
        focusesFirstField={focusFirst}
      >
        <Field
          label={strings.quote}
          name="quote"
          isMultiline
          isRequired
          maxLength={400}
          showCounter
          placeholder={strings.quotePlaceholder}
          hint={strings.quoteHint}
          value={quote}
          onChange={(next) => {
            setQuote(next);
            setProblems((held) => ({ ...held, quote: undefined }));
          }}
          {...(problems.quote === undefined ? {} : { error: problems.quote })}
        />
        <Field
          label={strings.author}
          name="author"
          autoComplete="off"
          isRequired
          maxLength={80}
          placeholder={strings.authorPlaceholder}
          value={author}
          onChange={(next) => {
            setAuthor(next);
            setProblems((held) => ({ ...held, author: undefined }));
          }}
          {...(problems.author === undefined ? {} : { error: problems.author })}
        />
        <Field
          label={strings.role}
          name="role"
          autoComplete="off"
          maxLength={80}
          placeholder={strings.rolePlaceholder}
          hint={strings.roleHint}
          value={role}
          onChange={(next) => {
            setRole(next);
            setProblems((held) => ({ ...held, role: undefined }));
          }}
          {...(problems.role === undefined ? {} : { error: problems.role })}
        />
      </Form>
    </EditorModal>
  );
}

/** Add or edit a piece of writing: a title nobody has to give, and the words, with the page drawn as typed. */
export function TextEditor({ item, items, linkPage, chrome, onSubmit, onClose }: BlockEditorProps) {
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'text' ? item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [problems, setProblems] = useState<BlockProblems>({});
  const draft = () => {
    const kept = title.trim();
    return { kind: 'text' as const, body, ...(kept === '' ? {} : { title: kept }) };
  };
  const submit = () => {
    const checked = linkPage.check(draft(), items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      return;
    }
    onSubmit(draft());
  };
  return (
    <EditorModal
      title={editing === undefined ? strings.newText : strings.editText}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        <DraftPage
          layout="blocks"
          caption={strings.howItLooks}
          blocks={[
            {
              kind: 'text',
              id: editing?.id ?? 'draft',
              body: body.trim() === '' ? strings.textBodyPlaceholder : body,
              ...(title.trim() === '' ? {} : { title: title.trim() }),
            },
          ]}
        />
      }
    >
      <Form
        id={formId}
        onSubmit={submit}
        label={editing === undefined ? strings.newText : strings.editText}
        focusesFirstField={focusFirst}
      >
        <Field
          label={strings.textTitle}
          name="title"
          autoComplete="off"
          maxLength={60}
          placeholder={strings.textTitlePlaceholder}
          hint={strings.textTitleHint}
          value={title}
          onChange={(next) => {
            setTitle(next);
            setProblems((held) => ({ ...held, title: undefined }));
          }}
          {...(problems.title === undefined ? {} : { error: problems.title })}
        />
        <Field
          label={strings.textBody}
          name="body"
          isMultiline
          isRequired
          maxLength={1000}
          showCounter
          placeholder={strings.textBodyPlaceholder}
          hint={strings.textBodyHint}
          value={body}
          onChange={(next) => {
            setBody(next);
            setProblems((held) => ({ ...held, body: undefined }));
          }}
          {...(problems.body === undefined ? {} : { error: problems.body })}
        />
      </Form>
    </EditorModal>
  );
}

/** A question's problem by its place in the list, as `checkBlock` words it ("question:0", "answer:0"). */
function askedProblem(problems: BlockProblems, part: 'question' | 'answer', at: number): string | undefined {
  return problems[`${part}:${String(at)}` as `question:${number}`];
}

/** One question as the FAQ editor holds it: its own id, so a row keeps its place while its words change. */
interface FaqTyped {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

/**
 * Add or edit the questions people ask (spec 0052, AC-5212): a title nobody has to give, and one to ten questions,
 * each a card that opens on its two fields. A question is added with the plus, moved by its grip or the arrows on
 * it, and removed from the card it opens. The page is drawn beside them as a visitor will read it.
 */
export function FaqEditor({ item, items, linkPage, chrome, onSubmit, onClose }: BlockEditorProps) {
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'faq' ? item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [asked, setAsked] = useState<readonly FaqTyped[]>(() =>
    (editing?.items ?? [{ question: '', answer: '' }]).map((each, at) => ({ id: `q${String(at)}`, ...each })),
  );
  // Every question a person adds opens on its fields; the ones already saved start closed, so a long list reads.
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(editing === undefined ? ['q0'] : []));
  const [problems, setProblems] = useState<BlockProblems>({});
  const minted = useRef(asked.length);

  const draft = () => {
    const kept = title.trim();
    return {
      kind: 'faq' as const,
      items: asked.map((each) => ({ question: each.question, answer: each.answer })),
      ...(kept === '' ? {} : { title: kept }),
    };
  };
  const submit = () => {
    const checked = linkPage.check(draft(), items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      // A question that was refused opens, so its reason is on screen rather than folded away.
      setOpenIds(
        new Set(
          asked
            .filter(
              (_each, at) =>
                askedProblem(checked.problems, 'question', at) ?? askedProblem(checked.problems, 'answer', at),
            )
            .map((each) => each.id),
        ),
      );
      return;
    }
    onSubmit(draft());
  };
  // The whole list's problems move with the rows, so a removed question never leaves its reason on the next one.
  const change = (next: readonly FaqTyped[]) => {
    setAsked(next);
    setProblems((held) => ({ ...held, items: undefined }));
  };
  const typed = (id: string, part: 'question' | 'answer', words: string) => {
    const at = asked.findIndex((each) => each.id === id);
    change(asked.map((each) => (each.id === id ? { ...each, [part]: words } : each)));
    setProblems((held) => ({ ...held, [`${part}:${String(at)}`]: undefined }));
  };

  return (
    <EditorModal
      title={editing === undefined ? strings.newFaq : strings.editFaq}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        <DraftPage
          layout="blocks"
          caption={strings.howItLooks}
          blocks={[
            {
              kind: 'faq',
              id: editing?.id ?? 'draft',
              items: asked.map((each) => ({
                question: each.question.trim() === '' ? strings.faqQuestionPlaceholder : each.question,
                answer: each.answer.trim() === '' ? strings.faqAnswerPlaceholder : each.answer,
              })),
              ...(title.trim() === '' ? {} : { title: title.trim() }),
            },
          ]}
        />
      }
    >
      <Form
        id={formId}
        onSubmit={submit}
        label={editing === undefined ? strings.newFaq : strings.editFaq}
        focusesFirstField={focusFirst}
      >
        <Field
          label={strings.faqTitle}
          name="title"
          autoComplete="off"
          maxLength={60}
          placeholder={strings.faqTitlePlaceholder}
          hint={strings.faqTitleHint}
          value={title}
          onChange={(next) => {
            setTitle(next);
            setProblems((held) => ({ ...held, title: undefined }));
          }}
          {...(problems.title === undefined ? {} : { error: problems.title })}
        />
        <QuestionList
          label={strings.faqQuestions}
          items={asked.map((each) => ({
            id: each.id,
            label: each.question.trim(),
            note: each.answer.trim().split('\n')[0] ?? '',
            hasProblem:
              askedProblem(problems, 'question', asked.indexOf(each)) !== undefined ||
              askedProblem(problems, 'answer', asked.indexOf(each)) !== undefined,
          }))}
          openIds={openIds}
          onOpenChange={(id, isOpen) => {
            setOpenIds((held) => {
              const next = new Set(held);
              if (isOpen) next.add(id);
              else next.delete(id);
              return next;
            });
          }}
          onMove={(id, index) => {
            const moving = asked.find((each) => each.id === id);
            if (moving === undefined) return;
            const rest = asked.filter((each) => each.id !== id);
            change([...rest.slice(0, index), moving, ...rest.slice(index)]);
            setProblems({});
          }}
          actions={
            <Button
              icon="plus"
              isDisabled={asked.length >= 10}
              onPress={() => {
                const id = `q${String(minted.current)}`;
                minted.current += 1;
                change([...asked, { id, question: '', answer: '' }]);
                setOpenIds(new Set([id]));
              }}
            >
              {strings.faqAdd}
            </Button>
          }
          renderFooter={(id) => (
            <Button
              icon="trash"
              variant="ghost-danger"
              onPress={() => {
                change(asked.filter((each) => each.id !== id));
                setProblems({});
              }}
            >
              {strings.faqRemove}
            </Button>
          )}
          renderOpen={(id) => {
            const at = asked.findIndex((each) => each.id === id);
            const one = asked[at];
            if (one === undefined) return null;
            return (
              <>
                <Field
                  label={strings.faqQuestion}
                  name={`question-${id}`}
                  autoComplete="off"
                  maxLength={120}
                  placeholder={strings.faqQuestionPlaceholder}
                  value={one.question}
                  onChange={(next) => {
                    typed(id, 'question', next);
                  }}
                  {...(askedProblem(problems, 'question', at) === undefined
                    ? {}
                    : { error: askedProblem(problems, 'question', at) })}
                />
                <Field
                  label={strings.faqAnswer}
                  name={`answer-${id}`}
                  isMultiline
                  maxLength={600}
                  showCounter
                  placeholder={strings.faqAnswerPlaceholder}
                  value={one.answer}
                  onChange={(next) => {
                    typed(id, 'answer', next);
                  }}
                  {...(askedProblem(problems, 'answer', at) === undefined
                    ? {}
                    : { error: askedProblem(problems, 'answer', at) })}
                />
              </>
            );
          }}
        />
        {problems.items !== undefined && <Callout tone="danger">{problems.items}</Callout>}
      </Form>
    </EditorModal>
  );
}

/** The contact card's fields as typed, the phone as its country and national number. */
interface ContactTyped {
  readonly fullName: string;
  readonly jobTitle: string;
  readonly company: string;
  // Three of each way to reach the person (26 October 2026). The second and third are typed into fields the
  // editor only shows once they are asked for, so a card with one of each is the form it always was.
  readonly email: string;
  readonly email2: string;
  readonly email3: string;
  readonly phone: PhoneFieldValue;
  readonly phone2: PhoneFieldValue;
  readonly phone3: PhoneFieldValue;
  readonly website: string;
  readonly website2: string;
  readonly website3: string;
  readonly note: string;
}

/** How many of a repeatable field the editor shows: the ones already filled, and at least one. */
const shownCount = (values: readonly (string | undefined)[]): number =>
  Math.max(1, ...values.map((value, at) => (value === undefined || value === '' ? 0 : at + 1)));

/** The three fields of each kind, in the order the card carries and the vCard writes them. */
const EMAIL_FIELDS = ['email', 'email2', 'email3'] as const;
const PHONE_FIELDS = ['phone', 'phone2', 'phone3'] as const;
const WEBSITE_FIELDS = ['website', 'website2', 'website3'] as const;

/**
 * One more of a kind, under the fields of that kind: a quiet button rather than three empty fields, since most
 * people have one of each and a form of nine boxes reads as work (26 October 2026). It leaves the form entirely
 * once the third is shown, so nothing promises a fourth.
 */
function AddAnother({
  word,
  isShown,
  onPress,
}: {
  readonly word: string;
  readonly isShown: boolean;
  readonly onPress: () => void;
}) {
  if (!isShown) return undefined;
  return (
    <Button variant="ghost" size="sm" icon="plus" onPress={onPress}>
      {word}
    </Button>
  );
}

/** The country a new number starts in: the browser's language's region ("en-IN" is IN), else the US. */
function guessCountry(): string {
  try {
    return new Intl.Locale(navigator.language).maximize().region ?? 'US';
  } catch {
    return 'US';
  }
}

/** A stored number (E.164, "+919999999999") as the phone field shows it: its country and the rest. */
function phoneOf(stored: string | undefined, guess: string): PhoneFieldValue {
  if (stored === undefined || stored === '') return { country: guess, national: '' };
  const digits = stored.replace(/\D/g, '');
  const country = countryOfE164(`+${digits}`);
  const code = country === undefined ? undefined : DIAL_CODES.get(country);
  if (country === undefined || code === undefined) return { country: guess, national: stored };
  return { country, national: digits.slice(code.length) };
}

/**
 * Add or edit the contact card (AC-5113): a full name and, only when given, a job title, a company, one email, one
 * phone (the same country and number field as forms and the Phone attribute, saved as E.164), one website and a
 * note, typed here and never read from a CRM record. Under them, the card as a visitor sees it. A new card starts
 * from the person's name; nothing else is filled in for them, so nothing is published unasked.
 */
export function ContactEditor({
  item,
  items,
  handle,
  linkPage,
  ownerName,
  chrome,
  onSubmit,
  onClose,
}: BlockEditorProps) {
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'contact' ? item : undefined;
  const [guess] = useState(guessCountry);
  const [typed, setTyped] = useState<ContactTyped>(() => ({
    fullName: editing?.fullName ?? ownerName,
    jobTitle: editing?.jobTitle ?? '',
    company: editing?.company ?? '',
    email: editing?.email ?? '',
    email2: editing?.email2 ?? '',
    email3: editing?.email3 ?? '',
    phone: phoneOf(editing?.phone, guess),
    phone2: phoneOf(editing?.phone2, guess),
    phone3: phoneOf(editing?.phone3, guess),
    website: editing?.website ?? '',
    website2: editing?.website2 ?? '',
    website3: editing?.website3 ?? '',
    note: editing?.note ?? '',
  }));
  // How many of each the form shows: what the card already carries, and one more each time Add another is pressed.
  const [shown, setShown] = useState(() => ({
    email: shownCount([editing?.email, editing?.email2, editing?.email3]),
    phone: shownCount([editing?.phone, editing?.phone2, editing?.phone3]),
    website: shownCount([editing?.website, editing?.website2, editing?.website3]),
  }));
  const [problems, setProblems] = useState<BlockProblems>({});
  const sent = (value: PhoneFieldValue) => (value.national.trim() === '' ? '' : toE164(value.country, value.national));
  const draft: BlockDraft = {
    kind: 'contact',
    ...typed,
    phone: sent(typed.phone),
    phone2: sent(typed.phone2),
    phone3: sent(typed.phone3),
  };
  const submit = () => {
    const checked = linkPage.check(draft, items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      return;
    }
    onSubmit(draft);
  };
  const clear = (name: keyof ContactTyped) => {
    if (problems[name] !== undefined) setProblems((was) => ({ ...was, [name]: undefined }));
  };
  /** One text field, wired to its value and its problem, which clears as it is typed in. */
  const field = (name: Exclude<keyof ContactTyped, 'phone' | 'phone2' | 'phone3'>) => ({
    name,
    autoComplete: 'off',
    value: typed[name],
    onChange: (next: string) => {
      setTyped((was) => ({ ...was, [name]: next }));
      clear(name);
    },
    ...(problems[name] === undefined ? {} : { error: problems[name] }),
  });
  const line = contactWords({ jobTitle: typed.jobTitle.trim(), company: typed.company.trim() });
  return (
    <EditorModal
      title={editing === undefined ? strings.newContact : strings.editContact}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        <DraftPage
          layout="blocks"
          caption={strings.howItLooks}
          blocks={[
            {
              kind: 'contact',
              id: editing?.id ?? 'draft',
              title: typed.fullName.trim() === '' ? strings.contactName : typed.fullName.trim(),
              href: contactHref(handle),
              ...(line === '' ? {} : { line }),
            },
          ]}
        />
      }
    >
      <Form
        id={formId}
        onSubmit={submit}
        label={editing === undefined ? strings.newContact : strings.editContact}
        focusesFirstField={focusFirst}
      >
        <p>{strings.contactHint}</p>
        <Field {...field('fullName')} label={strings.contactName} isRequired maxLength={80} />
        <Field
          {...field('jobTitle')}
          label={strings.contactJob}
          placeholder={strings.contactJobPlaceholder}
          maxLength={120}
        />
        <Field {...field('company')} label={strings.contactCompany} maxLength={120} />
        {EMAIL_FIELDS.slice(0, shown.email).map((name, at) => (
          <Field
            key={name}
            {...field(name)}
            label={at === 0 ? strings.contactEmail : strings.contactEmailMore(at + 1)}
            type="email"
            inputMode="email"
            isVerbatim
            {...(at === 0 ? { placeholder: strings.contactEmailPlaceholder } : {})}
            maxLength={120}
          />
        ))}
        <AddAnother
          word={strings.contactAddEmail}
          isShown={shown.email < EMAIL_FIELDS.length}
          onPress={() => setShown((was) => ({ ...was, email: was.email + 1 }))}
        />
        {PHONE_FIELDS.slice(0, shown.phone).map((name, at) => (
          <PhoneField
            key={name}
            label={at === 0 ? strings.contactPhone : strings.contactPhoneMore(at + 1)}
            name={name}
            guess={guess}
            {...(at === 0 ? { hint: strings.contactPhoneHint } : {})}
            value={typed[name]}
            onChange={(next) => {
              setTyped((was) => ({ ...was, [name]: next }));
              clear(name);
            }}
            {...(problems[name] === undefined ? {} : { error: problems[name] })}
          />
        ))}
        <AddAnother
          word={strings.contactAddPhone}
          isShown={shown.phone < PHONE_FIELDS.length}
          onPress={() => setShown((was) => ({ ...was, phone: was.phone + 1 }))}
        />
        {WEBSITE_FIELDS.slice(0, shown.website).map((name, at) => (
          <Field
            key={name}
            {...field(name)}
            label={at === 0 ? strings.contactWebsite : strings.contactWebsiteMore(at + 1)}
            type="url"
            inputMode="url"
            isVerbatim
            {...(at === 0 ? { placeholder: strings.contactWebsitePlaceholder } : {})}
            maxLength={2_000}
          />
        ))}
        <AddAnother
          word={strings.contactAddWebsite}
          isShown={shown.website < WEBSITE_FIELDS.length}
          onPress={() => setShown((was) => ({ ...was, website: was.website + 1 }))}
        />
        <Field
          {...field('note')}
          label={strings.contactNote}
          placeholder={strings.contactNotePlaceholder}
          hint={strings.contactNoteHint}
          maxLength={120}
          showCounter
        />
      </Form>
    </EditorModal>
  );
}

type Choices =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly choices: readonly ProfilePageChoice[] };

/**
 * Add a booking page: the person's Public pages from every workspace not on the page yet, the workspace named beside
 * each (AC-5117), read fresh each time it opens.
 */
export function PageChooser({ slug, items, linkPage, chrome, onSubmit, onClose }: BlockEditorProps) {
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const [choices, setChoices] = useState<Choices>({ status: 'loading' });
  const [picked, setPicked] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let isCurrent = true;
    linkPage.pageChoices(slug).then(
      (found) => {
        if (!isCurrent) return;
        // Not a page already on the list, one still being added included.
        const placed = new Set(items.flatMap((item) => (item.kind === 'page' ? [item.pageId] : [])));
        const open = found.filter((choice) => !placed.has(choice.pageId));
        setChoices({ status: 'ready', choices: open });
        setPicked(open[0]?.pageId ?? null);
      },
      (error: unknown) => {
        if (isCurrent)
          setChoices({ status: 'error', message: error instanceof Error ? error.message : strings.pagesFailed });
      },
    );
    return () => {
      isCurrent = false;
    };
    // The blocks as the chooser opened: a change while it is open never reads the choices again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkPage, slug, attempt]);
  const chosen = choices.status === 'ready' ? choices.choices.find((each) => each.pageId === picked) : undefined;
  const submit = () => {
    if (chosen === undefined) {
      setProblem(strings.pickPage);
      return;
    }
    onSubmit({ kind: 'page', workspaceId: chosen.workspaceId, pageId: chosen.pageId }, { page: chosen.facts });
  };
  let body: ReactNode;
  if (choices.status === 'loading') {
    body = <Skeleton shape="field" width="full" />;
  } else if (choices.status === 'error') {
    body = (
      <Callout
        tone="danger"
        actions={
          <Button
            onPress={() => {
              setChoices({ status: 'loading' });
              setAttempt((was) => was + 1);
            }}
          >
            {strings.retry}
          </Button>
        }
      >
        {strings.pagesFailed}
      </Callout>
    );
  } else if (choices.choices.length === 0) {
    body = (
      <EmptyState
        layout="row"
        icon="calendar-clock"
        title={items.some((item) => item.kind === 'page') ? strings.noPages : strings.noPagesYet}
        actions={<ButtonLink href={linksHref(slug)}>{strings.noPagesAction}</ButtonLink>}
      />
    );
  } else {
    body = (
      <Form id={formId} onSubmit={submit} label={strings.newPage} focusesFirstField={focusFirst}>
        <Select
          label={strings.page}
          searchLabel={strings.pageSearch}
          items={choices.choices.map((choice) => ({
            id: choice.pageId,
            label: choice.facts.title,
            icon: 'calendar-clock',
            description: [pageFacts(choice.facts), ...(choice.facts.status === 'paused' ? [strings.paused] : [])]
              .filter((part) => part !== '')
              .join(' · '),
          }))}
          value={picked}
          onChange={(next) => {
            setPicked(next);
            setProblem(undefined);
          }}
          {...(problem === undefined ? {} : { error: problem })}
        />
      </Form>
    );
  }
  return (
    <EditorModal
      title={strings.newPage}
      formId={formId}
      submitLabel={strings.add}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      canSubmit={choices.status === 'ready' && choices.choices.length > 0}
    >
      {body}
    </EditorModal>
  );
}

/** The forms a chooser is reading, or what went wrong. */
type FormChoices =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly choices: readonly ProfileFormChoice[] };

/**
 * Add or edit a Timefix form block (spec 0052, AC-5213): the person's own forms from every workspace not on the
 * page yet, read fresh each time it opens, and the words its row shows. The label starts as the form's own name,
 * which the owner may replace; the name itself never leaves the editor, so a visitor reads only what was typed.
 */
export function FormChooser({ slug, item, items, linkPage, chrome, onSubmit, onClose }: BlockEditorProps) {
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'form' ? item : undefined;
  const [choices, setChoices] = useState<FormChoices>(
    editing === undefined ? { status: 'loading' } : { status: 'ready', choices: [] },
  );
  const [picked, setPicked] = useState<string | null>(editing?.formId ?? null);
  const [label, setLabel] = useState(editing?.label ?? '');
  const [touched, setTouched] = useState(editing !== undefined);
  const [problems, setProblems] = useState<BlockProblems>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // Editing one: the form is already chosen, and only its label is open.
    if (editing !== undefined) return;
    let isCurrent = true;
    linkPage.formChoices(slug).then(
      (found) => {
        if (!isCurrent) return;
        const placed = new Set(items.flatMap((each) => (each.kind === 'form' ? [each.formId] : [])));
        const open = found.filter((choice) => !placed.has(choice.formId));
        setChoices({ status: 'ready', choices: open });
        const first = open[0];
        setPicked(first?.formId ?? null);
        // The form's own name is the label's starting point, until the owner types their own.
        if (first !== undefined) setLabel(first.facts.name);
      },
      () => {
        if (isCurrent) setChoices({ status: 'error' });
      },
    );
    return () => {
      isCurrent = false;
    };
    // The blocks as the chooser opened: a change while it is open never reads the choices again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkPage, slug, attempt]);

  const chosen = choices.status === 'ready' ? choices.choices.find((each) => each.formId === picked) : undefined;
  const draft = (): BlockDraft => ({
    kind: 'form',
    ...(editing === undefined
      ? { ...(chosen === undefined ? {} : { workspaceId: chosen.workspaceId, formId: chosen.formId }) }
      : { workspaceId: editing.workspaceId, formId: editing.formId }),
    label,
  });
  const submit = () => {
    const checked = linkPage.check(draft(), items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      return;
    }
    onSubmit(draft(), chosen === undefined ? undefined : { form: chosen.facts });
  };

  let body: ReactNode;
  if (choices.status === 'loading') {
    body = <Skeleton shape="field" width="full" />;
  } else if (choices.status === 'error') {
    body = (
      <Callout
        tone="danger"
        actions={
          <Button
            onPress={() => {
              setChoices({ status: 'loading' });
              setAttempt((was) => was + 1);
            }}
          >
            {strings.retry}
          </Button>
        }
      >
        {strings.formsFailed}
      </Callout>
    );
  } else if (editing === undefined && choices.choices.length === 0) {
    body = (
      <EmptyState
        layout="row"
        icon="clipboard-list"
        title={items.some((each) => each.kind === 'form') ? strings.noForms : strings.noFormsYet}
        actions={<ButtonLink href={formsHref(slug)}>{strings.noFormsAction}</ButtonLink>}
      />
    );
  } else {
    body = (
      <Form
        id={formId}
        onSubmit={submit}
        label={editing === undefined ? strings.newForm : strings.editForm}
        focusesFirstField={focusFirst}
      >
        {editing === undefined && (
          <Select
            label={strings.formPick}
            searchLabel={strings.formSearch}
            items={choices.choices.map((choice) => ({
              id: choice.formId,
              label: choice.facts.name,
              icon: 'clipboard-list',
              description: choice.facts.status === 'paused' ? strings.formPaused : '',
            }))}
            value={picked}
            onChange={(next) => {
              setPicked(next);
              setProblems((held) => ({ ...held, form: undefined }));
              // Until the owner types their own words, the label follows the form they pick.
              const found = choices.choices.find((each) => each.formId === next);
              if (!touched && found !== undefined) setLabel(found.facts.name);
            }}
            {...(problems.form === undefined ? {} : { error: problems.form })}
          />
        )}
        <Field
          label={strings.formLabel}
          name="label"
          autoComplete="off"
          isRequired
          maxLength={60}
          hint={strings.formLabelHint}
          value={label}
          onChange={(next) => {
            setLabel(next);
            setTouched(true);
            setProblems((held) => ({ ...held, title: undefined }));
          }}
          {...(problems.title === undefined ? {} : { error: problems.title })}
        />
      </Form>
    );
  }
  return (
    <EditorModal
      title={editing === undefined ? strings.newForm : strings.editForm}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      canSubmit={choices.status === 'ready' && (editing !== undefined || choices.choices.length > 0)}
      preview={
        label.trim() === '' ? undefined : (
          <DraftPage
            layout="blocks"
            caption={strings.howItLooks}
            blocks={[{ kind: 'form', id: editing?.id ?? 'draft', title: label.trim(), href: '/f/preview' }]}
          />
        )
      }
    >
      {body}
    </EditorModal>
  );
}
