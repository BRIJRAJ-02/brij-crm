// Brief
// Purpose: the link page's block editors (spec 0051): one Modal per kind, for an add and an edit.
// Main task: type a block's fields and see it as a visitor will, then Add or Save; it shows on the list at once.
// Leaves out: saving itself (the screen does, through the data layer, optimistic), and any kind without an entry in
// the registry.
import type { BlockDraft, BlockProblems, ProfileLinkIcon, ProfilePageChoice } from '@crm/data';
import {
  Button,
  ButtonLink,
  Callout,
  EmptyState,
  Field,
  Form,
  LinkPage,
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
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { linksHref } from '../booking/links.ts';
import { contactHref, contactWords, pageFacts, type BlockEditorProps, type EditorChrome } from './registry.tsx';
import { ICON_WORDS, strings } from './strings.ts';

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
  return (
    <Modal
      title={chrome?.title ?? title}
      {...(chrome?.hint === undefined ? {} : { hint: chrome.hint })}
      isOpen
      // Something typed is kept from a stray click outside: only Cancel or Esc throws it away.
      isDismissable={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC">
            {strings.cancel}
          </Button>
          {canSubmit && (
            <Button variant="primary" type="submit" form={formId} kbd="⌘↵">
              {chrome?.submitLabel ?? submitLabel}
            </Button>
          )}
        </>
      }
    >
      {chrome?.leading}
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
  const formId = useId();
  const editing = item?.kind === 'link' ? item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [url, setUrl] = useState(editing?.url ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [icon, setIcon] = useState<string>(editing?.icon ?? 'auto');
  const [problems, setProblems] = useState<BlockProblems>({});
  const icons = useMemo(() => iconItems(linkPage.icons), [linkPage]);
  const draft: BlockDraft = {
    kind: 'link',
    title,
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
        <LinkPage
          layout="blocks"
          caption={strings.howItLooks}
          blocks={[
            {
              kind: 'link',
              id: editing?.id ?? 'draft',
              title: title.trim() === '' ? strings.linkTitlePlaceholder : title.trim(),
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
        focusesFirstField
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
          {...(problems.url === undefined ? {} : { error: problems.url })}
        />
        <Field
          label={strings.linkTitle}
          name="title"
          autoComplete="off"
          isRequired
          maxLength={60}
          placeholder={strings.linkTitlePlaceholder}
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
  const formId = useId();
  const editing = item?.kind === 'heading' ? item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const submit = () => {
    const checked = linkPage.check({ kind: 'heading', title }, items, editing?.id);
    if (!checked.ok) {
      setProblem(checked.problems.title);
      return;
    }
    onSubmit({ kind: 'heading', title });
  };
  return (
    <EditorModal
      title={editing === undefined ? strings.newHeading : strings.editHeading}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        <LinkPage
          layout="blocks"
          caption={strings.howItLooks}
          blocks={[
            {
              kind: 'heading',
              id: editing?.id ?? 'draft',
              title: title.trim() === '' ? strings.headingPlaceholder : title.trim(),
            },
          ]}
        />
      }
    >
      <Form
        id={formId}
        onSubmit={submit}
        label={editing === undefined ? strings.newHeading : strings.editHeading}
        focusesFirstField
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
      </Form>
    </EditorModal>
  );
}

/** Add or edit a piece of writing: a title nobody has to give, and the words, with the page drawn as typed. */
export function TextEditor({ item, items, linkPage, chrome, onSubmit, onClose }: BlockEditorProps) {
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
        <LinkPage
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
        focusesFirstField
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
        <LinkPage
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
        focusesFirstField
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
  readonly email: string;
  readonly phone: PhoneFieldValue;
  readonly website: string;
  readonly note: string;
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
  const formId = useId();
  const editing = item?.kind === 'contact' ? item : undefined;
  const [guess] = useState(guessCountry);
  const [typed, setTyped] = useState<ContactTyped>(() => ({
    fullName: editing?.fullName ?? ownerName,
    jobTitle: editing?.jobTitle ?? '',
    company: editing?.company ?? '',
    email: editing?.email ?? '',
    phone: phoneOf(editing?.phone, guess),
    website: editing?.website ?? '',
    note: editing?.note ?? '',
  }));
  const [problems, setProblems] = useState<BlockProblems>({});
  const draft: BlockDraft = {
    kind: 'contact',
    ...typed,
    phone: typed.phone.national.trim() === '' ? '' : toE164(typed.phone.country, typed.phone.national),
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
  const field = (name: Exclude<keyof ContactTyped, 'phone'>) => ({
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
        <LinkPage
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
        focusesFirstField
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
        <Field
          {...field('email')}
          label={strings.contactEmail}
          type="email"
          inputMode="email"
          isVerbatim
          placeholder={strings.contactEmailPlaceholder}
          maxLength={120}
        />
        <PhoneField
          label={strings.contactPhone}
          name="phone"
          guess={guess}
          hint={strings.contactPhoneHint}
          value={typed.phone}
          onChange={(next) => {
            setTyped((was) => ({ ...was, phone: next }));
            clear('phone');
          }}
          {...(problems.phone === undefined ? {} : { error: problems.phone })}
        />
        <Field
          {...field('website')}
          label={strings.contactWebsite}
          type="url"
          inputMode="url"
          isVerbatim
          placeholder={strings.contactWebsitePlaceholder}
          maxLength={2_000}
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
    onSubmit({ kind: 'page', workspaceId: chosen.workspaceId, pageId: chosen.pageId }, chosen.facts);
  };
  const isMany = choices.status === 'ready' && new Set(choices.choices.map((each) => each.workspaceId)).size > 1;
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
      <Form id={formId} onSubmit={submit} label={strings.newPage} focusesFirstField>
        <Select
          label={strings.page}
          searchLabel={strings.pageSearch}
          items={choices.choices.map((choice) => ({
            id: choice.pageId,
            label: choice.facts.title,
            icon: 'calendar-clock',
            description: [
              ...(isMany ? [choice.facts.workspaceName] : []),
              pageFacts(choice.facts),
              ...(choice.facts.status === 'paused' ? [strings.paused] : []),
            ]
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
