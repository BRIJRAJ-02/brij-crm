// Brief
// Purpose: Captures › Forms: the workspace's forms as cards, the same cards as Links, each a picture of its own form
// over its name, its state as a dot and a word, when it was edited, and its submissions (spec 0023; 5 November 2026).
// Main task: open a form, make a new one at once, copy its link, or open its submissions; newest change first.
// Leaves out: anything inside one form (its builder), archived forms (a later pass), and a one-click off switch:
// pausing ends something, so it sits in ⋯ and asks first.
import { isDataError, type FormSummary } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import type { PublicForm } from '@crm/contracts/forms';
import {
  Badge,
  Button,
  ButtonLink,
  focusLater,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  formatRelative,
  HostedFormPreview,
  SpotIllustration,
  Tooltip,
  useFormatSettings,
  useNow,
  type LinkGridCard,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
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
 * The card's picture (5 November 2026, the owner: "make these cards look much prettier"; Flodesk's and Fillout's form
 * grids): the draft's headline and first questions, drawn by the hosted page's own component at a thumbnail's size,
 * in the form's own Light or Dark, so each card shows its own form. A row from an older answer, with no picture,
 * draws its name alone on an empty form.
 */
function pictureOf(form: FormSummary): PublicForm {
  const picture = form.picture;
  return {
    key: `card-${form.id}`,
    status: 'live',
    versionNumber: 1,
    headline: picture?.headline ?? form.name,
    ...(picture?.subheading === undefined ? {} : { subheading: picture.subheading }),
    buttonText: picture?.buttonText ?? strings.sendButton,
    language: 'en',
    look: { colour: picture?.colour ?? 'light', corners: picture?.corners ?? 'rounded' },
    ...(picture?.layout === undefined ? {} : { layout: picture.layout }),
    questions: [...(picture?.questions ?? [])],
    offersMeeting: false,
  };
}

/** Its state as a dot and a word: Draft until its first publish, Paused once paused, otherwise Live. */
function statusOf(form: FormSummary): { readonly label: string; readonly hue: 'gray' | 'orange' | 'green' } {
  if (form.liveVersionNumber === undefined) return { label: strings.draftBadge, hue: 'gray' };
  if (form.status === 'paused') return { label: strings.notAccepting, hue: 'orange' };
  return { label: strings.liveStatus, hue: 'green' };
}

/** Its submissions, spam left out as Submissions' All leaves it out (forms fix a8): the card and the list agree. */
function realSubmissions(form: FormSummary): number {
  return Math.max(form.submissionCount - form.spamCount, 0);
}

/**
 * The forms, the one changed last first; the server's order (newest made first) breaks a tie. No sort control (the
 * owner, 5 November 2026: "Remove sorting from forms listing"): Search finds one by name.
 */
function newestFirst(forms: readonly FormSummary[]): readonly FormSummary[] {
  return [...forms].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  // Ordered when the list changes, not on every tick of the clock the cards read.
  const forms = useMemo(() => (items === undefined ? [] : newestFirst(items)), [items]);
  const cards: readonly LinkGridCard[] = forms.map((form) => {
    const isPending = list.status === 'ready' && list.pendingIds.has(form.id);
    const isPublished = form.liveVersionNumber !== undefined;
    const isLive = isPublished && form.status === 'live';
    const real = realSubmissions(form);
    const countText = real === 0 ? strings.noSubmissionsYet : strings.submissionCount(real);
    return {
      id: form.id,
      title: form.name,
      href: formHref(slug, form.id),
      // The form itself, small, across the card's top: what it asks says more than "4 questions" did.
      picture: <HostedFormPreview form={pictureOf(form)} size="thumbnail" />,
      // Its state as a dot and a word, then one fact: when it changed. Its submissions are the foot's own link.
      ...(isPending ? { badge: strings.copying } : { status: statusOf(form) }),
      facts: [strings.editedAgo(formatRelative(form.updatedAt, now, locale, timeZone, dateFormat))],
      // Only a paused form reads quieter.
      isOff: form.status === 'paused',
      isPending,
      // Not published, there is nothing to copy or open: its Draft says why. Copy link is a quiet icon.
      ...(isPublished ? { copyValue: data.forms.hostedUrl(form.publicKey), isCopyQuiet: true } : {}),
      lead: isPending ? undefined : isPublished ? (
        // Its submissions, one press from the list (forms fix a9), as their count: "12 submissions", with New when
        // one came since the reader last looked.
        <>
          <ButtonLink
            variant="ghost"
            size="lg"
            icon="inbox"
            label={strings.submissionsOf(countText, form.name)}
            href={formHref(slug, form.id, 'submissions')}
          >
            {countText}
          </ButtonLink>
          {hasNewAnswers(slug, form, now) && <Badge text={strings.newBadge} tone="accent" isWhole />}
        </>
      ) : canManage ? (
        // A draft has no link to copy or open: Edit is the next step (the owner, 31 October 2026: "no idea what to do").
        <ButtonLink
          variant="ghost"
          size="lg"
          icon="pencil"
          label={strings.editFormOf(form.name)}
          href={formHref(slug, form.id)}
        >
          {strings.editDraft}
        </ButtonLink>
      ) : undefined,
      actions: (
        <>
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
      hasPictures
      errorTitle={strings.failedTitle}
      onRetry={() => {
        data.forms.view(slug).reload();
      }}
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
      hasPictures
      errorTitle={strings.failedTitle}
      onRetry={() => undefined}
    />
  );
}
