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
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { linksHref } from '../booking/links.ts';
import { pageFacts, type BlockEditorProps } from './registry.tsx';
import { strings } from './strings.ts';

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
  const words = (icon: string) => {
    const spaced = icon.replaceAll('-', ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  };
  return [
    { id: 'auto', label: strings.iconAuto, description: strings.iconAutoText, icon: 'sparkles' },
    ...icons.map((icon) => ({ id: icon, label: words(icon), icon: icon })),
  ];
}

/** Add or edit a link: its title, address, note and icon, with the block drawn as typed under them. */
export function LinkEditor({ item, items, onSubmit, onClose }: BlockEditorProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const formId = useId();
  const editing = item?.kind === 'link' ? item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [url, setUrl] = useState(editing?.url ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [icon, setIcon] = useState<string>(editing?.icon ?? 'auto');
  const [problems, setProblems] = useState<BlockProblems>({});
  const icons = useMemo(() => iconItems(data.linkPage.icons), [data]);
  const draft: BlockDraft = {
    kind: 'link',
    title,
    url,
    note,
    ...(icon === 'auto' ? {} : { icon }),
    ...(editing === undefined ? {} : { hue: editing.hue }),
  };
  // The block as it will show: the address as it will be stored when it can be, else as typed.
  const checked = data.linkPage.check(draft, items, editing?.id);
  const shownUrl = checked.ok && checked.block.kind === 'link' ? checked.block.url : url.trim();
  const mark = data.linkPage.markOf(shownUrl);
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
          blocks={[
            {
              kind: 'link',
              id: editing?.id ?? 'draft',
              title: title.trim() === '' ? strings.linkTitlePlaceholder : title.trim(),
              href: shownUrl,
              hue: editing?.hue ?? 'blue',
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
          hint={strings.linkUrlHint}
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
export function HeadingEditor({ item, items, onSubmit, onClose }: BlockEditorProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const formId = useId();
  const editing = item?.kind === 'heading' ? item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const submit = () => {
    const checked = data.linkPage.check({ kind: 'heading', title }, items, editing?.id);
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
      <Form id={formId} onSubmit={submit} label={strings.newHeading} focusesFirstField>
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

type Choices =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly choices: readonly ProfilePageChoice[] };

/**
 * Add a booking page: the person's Public pages from every workspace not on the page yet, the workspace named beside
 * each (AC-5117), read fresh each time it opens.
 */
export function PageChooser({ slug, onSubmit, onClose }: BlockEditorProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const formId = useId();
  const [choices, setChoices] = useState<Choices>({ status: 'loading' });
  const [picked, setPicked] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let isCurrent = true;
    data.linkPage.pageChoices(slug).then(
      (found) => {
        if (!isCurrent) return;
        setChoices({ status: 'ready', choices: found });
        setPicked(found[0]?.pageId ?? null);
      },
      (error: unknown) => {
        if (isCurrent)
          setChoices({ status: 'error', message: error instanceof Error ? error.message : strings.pagesFailed });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, attempt]);
  const chosen = choices.status === 'ready' ? choices.choices.find((each) => each.pageId === picked) : undefined;
  const submit = () => {
    if (chosen === undefined) {
      setProblem('Pick a booking page.');
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
        title={strings.noPages}
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
