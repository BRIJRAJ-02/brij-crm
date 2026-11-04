// Brief
// Purpose: Captures › Forms: the workspace's forms as cards, the same cards as Links, each with one meta line (its
// questions, when it was edited, its submissions; Klaviyo's list) and its state as a badge (spec 0023; lane 3c).
// Main task: open a form, make a new one at once, copy its link, or open its submissions; sort by Updated or Name.
// Leaves out: anything inside one form (its builder), archived forms (a later pass), and a one-click off switch:
// pausing ends something, so it sits in ⋯ and asks first.
import { isDataError, type FormSummary } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  focusLater,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  formatRelative,
  Popover,
  SortChip,
  SpotIllustration,
  Tooltip,
  useFormatSettings,
  useNow,
  type LinkGridCard,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { CapturesList } from '../captures/CapturesList.tsx';
import { useCapturesCreate } from '../captures/create.tsx';
import { pageHeading } from '../navigation/focus.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { strings as capturesStrings } from '../captures/strings.ts';
import { DeleteFormDialog, PauseFormDialog } from './FormConfirms.tsx';
import { formHref } from './paths.ts';
import { hasNewAnswers } from './seen.ts';
import { strings } from './strings.ts';

/** With no forms: a still drawing of a form, one line and New form (spec 0058, AC-8). */
const EMPTY = {
  title: strings.noForms,
  text: strings.noFormsText,
  icon: 'clipboard-list',
  illustration: <SpotIllustration kind="form" />,
} as const;

/** Props for Captures › Forms: the workspace, whose held list of forms the route loaded. */
export interface FormsScreenProps {
  readonly slug: string;
}

/**
 * A form's meta line (lane 3c, Klaviyo's list): its questions, when it was edited, and its submissions ("5 questions
 * · edited 2h ago · 4 submissions"); a draft says no submissions, since it has taken none. Spam is left out, as
 * Submissions' All leaves it out (forms fix a8): the card and the list it opens agree.
 */
function factsOf(form: FormSummary, edited: string): readonly string[] {
  const real = Math.max(form.submissionCount - form.spamCount, 0);
  return [
    ...(form.questionCount === undefined ? [] : [strings.questionCount(form.questionCount)]),
    strings.editedAgo(edited),
    ...(form.liveVersionNumber === undefined
      ? []
      : [real === 0 ? strings.noSubmissionsYet : strings.submissionCount(real)]),
  ];
}

/**
 * Its badge: Draft until its first publish (a neutral badge, never a greyed title; lane 3c); Paused once paused;
 * New submissions when one came since the reader last opened its Submissions.
 */
function badgeOf(form: FormSummary, isNew: boolean): { readonly badge?: string } {
  if (form.liveVersionNumber === undefined) return { badge: strings.draftBadge };
  if (form.status === 'paused') return { badge: strings.notAccepting };
  return isNew ? { badge: strings.newAnswers } : {};
}

/** How the list is sorted: by when each form changed, newest first, or by name, A to Z. */
type FormSort = 'updated' | 'name';

/** The forms in the order picked; the server's order (newest first) breaks a tie. */
function sortForms(forms: readonly FormSummary[], sort: FormSort, locale: string): readonly FormSummary[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return [...forms].sort((a, b) =>
    sort === 'name' ? collator.compare(a.name, b.name) : b.updatedAt.localeCompare(a.updatedAt),
  );
}

/**
 * The list's sort, as the record lists say theirs (SortChip, spec 0020): "Updated · descending", pressing it opens
 * the two choices.
 */
function FormsSort({ value, onChange }: { readonly value: FormSort; readonly onChange: (sort: FormSort) => void }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <SortChip
        ref={anchor}
        attribute={value === 'name' ? strings.sortName : strings.sortUpdated}
        direction={value === 'name' ? 'ascending' : 'descending'}
        onPress={() => {
          setOpen(true);
        }}
      />
      <Popover triggerRef={anchor} isOpen={isOpen} onOpenChange={setOpen} placement="bottom end" width="menu">
        <Menu
          label={strings.sortLabel}
          isInline
          // A menu in a popover of its own, which no MenuTrigger focuses: the picked sort's row takes focus as it opens.
          // eslint-disable-next-line jsx-a11y-x/no-autofocus
          autoFocus="first"
          selectionMode="single"
          selectedKeys={new Set([value])}
          onAction={(key) => {
            if (key === 'updated' || key === 'name') onChange(key);
            setOpen(false);
          }}
        >
          <MenuItem id="updated" icon="arrow-down-wide-narrow">
            {strings.sortUpdated}
          </MenuItem>
          <MenuItem id="name" icon="arrow-up-narrow-wide">
            {strings.sortName}
          </MenuItem>
        </Menu>
      </Popover>
    </>
  );
}

/** Captures › Forms: New form, then one card per form, newest change first, read from the data layer's held list. */
export function FormsScreen({ slug }: FormsScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const canManage = useCan('forms.manage');
  const list = useCaptureList(data.forms.view(slug));
  const { locale, timeZone, dateFormat } = useFormatSettings();
  const now = useNow();
  const create = useCapturesCreate();
  const [deleting, setDeleting] = useState<FormSummary | undefined>(undefined);
  const [pausing, setPausing] = useState<FormSummary | undefined>(undefined);
  const [sort, setSort] = useState<FormSort>('updated');

  // A refusal says what was put back, then why.
  const failed = (what: string) => (error: unknown) => {
    toasts.toast({ tone: 'danger', message: `${what} ${isDataError(error) ? error.message : strings.failedText}` });
  };

  // Pause and Resume show in the list at once, as the editor's menu does, with Undo in their toast; a refusal puts
  // it back there, and the toast says why (the owner, 22 Oct 2026: pausing is reversible, so it doesn't ask first).
  const setLive = (form: FormSummary, status: 'live' | 'paused') => {
    data.forms.setStatus(slug, form.id, status).then(
      () => {
        toasts.toast({
          tone: 'success',
          message: status === 'live' ? capturesStrings.resumedToast(form.name) : capturesStrings.pausedToast(form.name),
          action: { label: capturesStrings.undo, onAction: () => setLive(form, status === 'live' ? 'paused' : 'live') },
        });
      },
      failed(status === 'live' ? strings.turnOnFailed(form.name) : strings.turnOffFailed(form.name)),
    );
  };

  const duplicate = (form: FormSummary) => {
    data.forms.duplicate(slug, form.id).then(
      (copy) => {
        toasts.toast({ tone: 'success', message: strings.duplicated(copy.name) });
      },
      failed(strings.duplicateFailed(form.name)),
    );
  };

  const items = list.status === 'ready' ? list.items : undefined;
  // Sorted when the list, the pick or the language changes, not on every tick of the clock the cards read.
  const forms = useMemo(() => (items === undefined ? [] : sortForms(items, sort, locale)), [items, sort, locale]);
  const cards: readonly LinkGridCard[] = forms.map((form) => {
    const isPending = list.status === 'ready' && list.pendingIds.has(form.id);
    const isPublished = form.liveVersionNumber !== undefined;
    const isLive = isPublished && form.status === 'live';
    return {
      id: form.id,
      title: form.name,
      href: formHref(slug, form.id),
      // No colour mark: a form has no colour of its own, and one picked from its id identified nothing (T3). No
      // address either (lane 3c): the meta line fills the card, and a slug cut to "/f/booking-i…" said nothing; Copy
      // link copies it whole.
      facts: factsOf(form, formatRelative(form.updatedAt, now, locale, timeZone, dateFormat)),
      ...(isPending ? { badge: strings.copying } : badgeOf(form, hasNewAnswers(slug, form, now))),
      // Only a paused form reads quieter: a draft says Draft in its badge and keeps its title's full weight.
      isOff: form.status === 'paused',
      isPending,
      // Not published, there is nothing to copy or open: the badge says why.
      ...(isPublished ? { copyValue: data.forms.hostedUrl(form.publicKey) } : {}),
      actions: (
        <>
          {/* A draft has no link to copy or open, so its foot said nothing to do: Edit is the next step, beside More
              (the owner, 31 October 2026: "no idea what to do"). */}
          {canManage && !isPublished && !isPending && (
            <ButtonLink size="lg" icon="pencil" label={strings.editFormOf(form.name)} href={formHref(slug, form.id)}>
              {strings.editDraft}
            </ButtonLink>
          )}
          {/* Its submissions, one press from the list (forms fix a9), named in words (lane 3c): an inbox icon alone
              read as mail. */}
          {isPublished && !isPending && (
            <ButtonLink
              size="lg"
              icon="inbox"
              label={strings.openSubmissionsOf(form.name)}
              href={formHref(slug, form.id, 'submissions')}
            >
              {strings.openSubmissions}
            </ButtonLink>
          )}
          {/* Open sits in ⋯ for those who have it, so a phone's card holds Copy link, Submissions and ⋯ on one line
              (lane 3c); a reader with no menu keeps it here. */}
          {isLive && !canManage && (
            <Tooltip content={strings.openInNewTab} isDisabled={isPending}>
              <Button
                variant="ghost"
                size="lg"
                icon="external-link"
                label={strings.openForm(form.name)}
                isDisabled={isPending}
                onPress={() => {
                  globalThis.open(data.forms.hostedUrl(form.publicKey), '_blank', 'noopener');
                }}
              />
            </Tooltip>
          )}
          {canManage && (
            <MenuTrigger>
              <Button
                variant="ghost"
                size="lg"
                icon="ellipsis"
                label={strings.moreFor(form.name)}
                isDisabled={isPending}
              />
              <Menu
                label={strings.moreFor(form.name)}
                onAction={(key) => {
                  if (key === 'duplicate') duplicate(form);
                  if (key === 'delete') setDeleting(form);
                  if (key === 'pause') setPausing(form);
                  if (key === 'resume') setLive(form, 'live');
                  if (key === 'open') globalThis.open(data.forms.hostedUrl(form.publicKey), '_blank', 'noopener');
                }}
              >
                {isLive ? (
                  <MenuItem id="open" icon="external-link">
                    {strings.openInNewTab}
                  </MenuItem>
                ) : null}
                {/* Pausing ends something, so it asks first; resuming ends nothing and goes at once (lane 3c). */}
                {isLive ? (
                  <MenuItem id="pause" icon="pause">
                    {strings.pauseForm}
                  </MenuItem>
                ) : null}
                {isPublished && form.status === 'paused' ? (
                  <MenuItem id="resume" icon="play">
                    {strings.resumeForm}
                  </MenuItem>
                ) : null}
                <MenuItem id="duplicate" icon="copy">
                  {strings.duplicate}
                </MenuItem>
                <MenuSeparator />
                <MenuItem id="delete" icon="trash" isDanger>
                  {strings.delete}
                </MenuItem>
              </Menu>
            </MenuTrigger>
          )}
        </>
      ),
    };
  });

  return (
    <CapturesList
      label={strings.forms}
      searchLabel={strings.searchForms}
      status={list.status}
      cards={cards}
      // An empty list offers New in its middle too, as a secondary: the TopBar's New stays the one primary.
      {...(create?.create === undefined
        ? {}
        : {
            newAction: (
              <Button icon="plus" onPress={create.create} isPending={create.isPending}>
                {strings.newForm}
              </Button>
            ),
          })}
      empty={EMPTY}
      errorTitle={strings.failedTitle}
      onRetry={() => {
        data.forms.view(slug).reload();
      }}
      toolbarActions={<FormsSort value={sort} onChange={setSort} />}
      dialogs={
        <>
          <PauseFormDialog
            data={data}
            slug={slug}
            form={pausing}
            onClose={() => setPausing(undefined)}
            onDone={(form) => {
              setPausing(undefined);
              toasts.toast({
                tone: 'success',
                message: capturesStrings.pausedToast(form.name),
                action: {
                  label: capturesStrings.undo,
                  onAction: () => {
                    const found = list.status === 'ready' ? list.items.find((each) => each.id === form.id) : undefined;
                    if (found !== undefined) setLive(found, 'live');
                  },
                },
              });
            }}
          />
          <DeleteFormDialog
            data={data}
            slug={slug}
            form={deleting}
            onClose={() => setDeleting(undefined)}
            onDone={(form) => {
              setDeleting(undefined);
              toasts.toast({ tone: 'success', message: strings.deleted(form.name) });
              // The card and its menu went with the form: focus goes to the page's title rather than to a card
              // that is about to leave, or to the page.
              focusLater(() => pageHeading(document));
            }}
          />
        </>
      }
    />
  );
}

/** The list while its forms load, inside the Captures layout: skeleton cards in the cards' shape. */
export function FormsPending() {
  return (
    <CapturesList
      label={strings.forms}
      searchLabel={strings.searchForms}
      status="loading"
      cards={[]}
      empty={EMPTY}
      errorTitle={strings.failedTitle}
      onRetry={() => undefined}
    />
  );
}
