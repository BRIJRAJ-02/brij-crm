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
  Select,
  Skeleton,
  type IconName,
  type SelectItem,
} from '@crm/ui';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { linksHref } from '../booking/links.ts';
import { contactHref, contactWords, pageFacts, type BlockEditorProps } from './registry.tsx';
import { ICON_WORDS, strings } from './strings.ts';

/** The Modal every block editor sits in: its title, Cancel and the submit, and "How it looks" under the fields. */
function EditorModal({
  title,
  formId,
  submitLabel,
  onClose,
  preview,
  canSubmit = true,
  children,
}: {
  readonly title: string;
  readonly formId: string;
  readonly submitLabel: string;
  readonly onClose: () => void;
  readonly preview?: ReactNode;
  /** False while there is nothing to submit (the choices loading, failed or empty): only Cancel shows. */
  readonly canSubmit?: boolean;
  readonly children: ReactNode;
}) {
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
          <Button slot="close" kbd="ESC">
            {strings.cancel}
          </Button>
          {canSubmit && (
            <Button variant="primary" type="submit" form={formId} kbd="⌘↵">
              {submitLabel}
            </Button>
          )}
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

/** Add or edit a link: its title, address, note and icon, with the block drawn as typed under them. */
export function LinkEditor({ item, items, newHue, linkPage, socialNetworks, onSubmit, onClose }: BlockEditorProps) {
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
export function HeadingEditor({ item, items, linkPage, onSubmit, onClose }: BlockEditorProps) {
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

/** The contact card's fields as typed. */
interface ContactTyped {
  readonly fullName: string;
  readonly jobTitle: string;
  readonly company: string;
  readonly email: string;
  readonly phone: string;
  readonly website: string;
  readonly note: string;
}

/**
 * Add or edit the contact card (AC-5113): a full name and, only when given, a job title, a company, one email, one
 * phone, one website and a note, typed here and never read from a CRM record. Under them, the card as a visitor sees
 * it. A new card starts from the person's name; nothing else is filled in for them, so nothing is published unasked.
 */
export function ContactEditor({ item, items, handle, linkPage, ownerName, onSubmit, onClose }: BlockEditorProps) {
  const formId = useId();
  const editing = item?.kind === 'contact' ? item : undefined;
  const [typed, setTyped] = useState<ContactTyped>({
    fullName: editing?.fullName ?? ownerName,
    jobTitle: editing?.jobTitle ?? '',
    company: editing?.company ?? '',
    email: editing?.email ?? '',
    phone: editing?.phone ?? '',
    website: editing?.website ?? '',
    note: editing?.note ?? '',
  });
  const [problems, setProblems] = useState<BlockProblems>({});
  const draft: BlockDraft = { kind: 'contact', ...typed };
  const submit = () => {
    const checked = linkPage.check(draft, items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      return;
    }
    onSubmit(draft);
  };
  /** One field, wired to its value and its problem, which clears as it is typed in. */
  const field = (name: keyof ContactTyped) => ({
    name,
    autoComplete: 'off',
    value: typed[name],
    onChange: (next: string) => {
      setTyped((was) => ({ ...was, [name]: next }));
      if (problems[name] !== undefined) setProblems((was) => ({ ...was, [name]: undefined }));
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
        <Field
          {...field('fullName')}
          label={strings.contactName}
          hint={strings.contactHint}
          isRequired
          maxLength={80}
        />
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
        <Field
          {...field('phone')}
          label={strings.contactPhone}
          type="tel"
          inputMode="tel"
          isVerbatim
          placeholder={strings.contactPhonePlaceholder}
          maxLength={32}
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
export function PageChooser({ slug, items, linkPage, onSubmit, onClose }: BlockEditorProps) {
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
      canSubmit={choices.status === 'ready' && choices.choices.length > 0}
    >
      {body}
    </EditorModal>
  );
}
