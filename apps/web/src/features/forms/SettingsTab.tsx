// Brief
// Purpose: a form's Settings tab (spec 0023), for someone setting up a form in under a minute: what people see after
// sending, whether and where submissions go in the CRM, the form's words, its details (name, link, owner: nobody, a
// teammate, or a round robin group handing each new record to its next teammate, spec 0029) and spam.
// Main task: scan the groups, change only what needs changing (the defaults already work), and save the name,
// address and owner from the SaveBar; the rest goes live on Publish, which the header's state says once (not each card).
// Leaves out: email notifications (no backend yet), each question's filing (set on the question, linked from here),
// and the look (on the Form tab, beside the preview, the only tab that has one).
import type {
  BookingPageView,
  FormDocument,
  FormTargetChoices,
  FormView,
  MemberSummary,
  ObjectSummary,
} from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import {
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  Field,
  Link,
  SaveBar,
  SegmentedControl,
  Select,
  Switch,
  Table,
  type SaveBarStatus,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { linksHref, pageEditorHref } from '../booking/links.ts';
import { pageHeading } from '../navigation/focus.ts';
import { afterPageProblem } from './after-page.ts';
import { isRedirectAddress, sameValue } from './draft.ts';
import { formHref } from './paths.ts';
import { firstRefusal } from './refusals.ts';
import { strings } from './strings.ts';
import { questionFacts } from '../routing/facts.ts';
import { RulesCard } from '../routing/RulesCard.tsx';
import { strings as routingStrings } from '../routing/strings.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';

const NOBODY = 'nobody';

/** A round robin group's option id in the owner list, apart from a teammate's id. */
const GROUP = 'group:';
const groupOption = (rotationId: string) => `${GROUP}${rotationId}`;
/** The round robin group an owner choice names, if it names one. */
const groupOf = (choice: string) => (choice.startsWith(GROUP) ? choice.slice(GROUP.length) : undefined);

/** What an owner choice saves: nobody, a teammate, or a round robin group, never a teammate and a group at once. */
function ownerChange(choice: string): { ownerMemberId: string | null; ownerRotationId: string | null } {
  if (choice === NOBODY) return { ownerMemberId: null, ownerRotationId: null };
  const group = groupOf(choice);
  return group === undefined
    ? { ownerMemberId: choice, ownerRotationId: null }
    : { ownerMemberId: null, ownerRotationId: group };
}

/** The countdowns a form offers before it sends its visitor on to book (AC-1056): 0 is at once. */
const COUNTDOWNS = [0, 3, 5, 10, 15, 30] as const;

/** What sending a form leads to: a thank you, another web page, or on to book (AC-1055). */
type AfterKind = FormDocument['after']['kind'];

/**
 * One form's Form tab with one question open and in view: the map of where answers go links each line here.
 * Kept beside its one link rather than in paths.ts, which the routes load up front.
 */
const questionHref = (slug: string, formId: string, questionId: string) =>
  `/w/${slug}/captures/forms/${formId}?question=${encodeURIComponent(questionId)}`;

/** The settings that apply when saved: the name, the address, the owner and who is emailed each submission. */
interface Applied {
  readonly name: string;
  readonly address: string;
  readonly owner: string;
  readonly notify: readonly string[];
}

/** Whether two lists name the same people in the same order. */
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/** Props for useFormSettings. */
export interface FormSettingsInput {
  readonly slug: string;
  readonly form: FormView;
  readonly onFormChange: (view: FormView) => void;
}

/**
 * The name, address and owner as the Settings tab edits them, saved together
 * from the SaveBar (the editor's footer). Held by the editor, so a tab change
 * keeps what was typed.
 */
export function useFormSettings({ slug, form, onFormChange }: FormSettingsInput) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const saved: Applied = {
    name: form.name,
    address: form.publicKey,
    owner: form.ownerRotationId === undefined ? (form.ownerMemberId ?? NOBODY) : groupOption(form.ownerRotationId),
    notify: form.notifyMemberIds,
  };
  // Only the edits are held, so a change made elsewhere (the first publish, a rename) shows here at once.
  const [edits, setEdits] = useState<Partial<Applied>>({});
  const values: Applied = { ...saved, ...edits };
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [failure, setFailure] = useState<{ readonly message: string; readonly field?: string } | undefined>(undefined);
  const isDirty =
    values.name !== saved.name ||
    values.address !== saved.address ||
    values.owner !== saved.owner ||
    !sameList(values.notify, saved.notify);

  const set = (patch: Partial<Applied>) => {
    setEdits((before) => ({ ...before, ...patch }));
    setFailure(undefined);
    if (status === 'saved') setStatus('idle');
  };

  const save = () => {
    if (!isDirty || status === 'saving') return;
    setStatus('saving');
    const addressChanged = values.address !== saved.address;
    data.forms
      .updateSettings(slug, form.id, {
        ...(values.name === saved.name ? {} : { name: values.name.trim() }),
        ...(addressChanged ? { slug: values.address } : {}),
        ...(values.owner === saved.owner ? {} : ownerChange(values.owner)),
        ...(sameList(values.notify, saved.notify) ? {} : { notifyMemberIds: values.notify }),
      })
      .then(
        (view) => {
          onFormChange(view);
          setEdits({});
          setStatus('saved');
          if (addressChanged) toasts.toast({ tone: 'success', message: strings.addressChanged });
        },
        (error: unknown) => {
          setStatus('idle');
          const refusal = firstRefusal(error);
          setFailure({ message: refusal.message, ...(refusal.field === undefined ? {} : { field: refusal.field }) });
        },
      );
  };

  const barStatus: SaveBarStatus =
    status === 'saving'
      ? 'saving'
      : failure !== undefined && isDirty
        ? 'error'
        : isDirty
          ? 'unsaved'
          : status === 'saved'
            ? 'saved'
            : 'hidden';

  const footer = (
    <SaveBar
      status={barStatus}
      {...(failure === undefined ? {} : { error: failure.message })}
      {...(values.name.trim() === '' ? { blockedReason: strings.nameRequired } : {})}
      onSave={save}
      onDiscard={() => {
        setEdits({});
        setFailure(undefined);
        setStatus('idle');
      }}
      onFocusAway={() => pageHeading(document)?.focus()}
    />
  );

  const fieldError = (field: 'name' | 'slug' | 'owner' | 'notifyMemberIds') =>
    failure !== undefined &&
    (failure.field === field ||
      (field === 'owner' && (failure.field === 'ownerMemberId' || failure.field === 'ownerRotationId')))
      ? failure.message
      : undefined;
  return { values, set, footer, fieldError, isDirty };
}

/** What useFormSettings answers. */
export type FormSettings = ReturnType<typeof useFormSettings>;

/** Props for the Settings tab. */
export interface SettingsTabProps {
  readonly slug: string;
  readonly form: FormView;
  readonly draft: FormDocument;
  readonly target: FormTargetChoices;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
  readonly isReadOnly: boolean;
  readonly settings: FormSettings;
  readonly onDraftChange: (next: FormDocument | ((before: FormDocument) => FormDocument)) => void;
  /** Points the draft at an object, or at none (keep submissions only); the editor saves first and takes the answer. */
  readonly onRetarget: (objectId: string | null) => void;
  /** A change of where submissions go is on its way. */
  readonly isRetargeting: boolean;
  /** Publish was refused for an incomplete field: show its message whether or not it was left yet. */
  readonly showGaps: boolean;
}

/** The groups, as short Cards in one full width column, with no subtitles. */
export function SettingsTab({
  slug,
  form,
  draft,
  target,
  objects,
  members,
  isReadOnly,
  settings,
  onDraftChange,
  onRetarget,
  isRetargeting,
  showGaps,
}: SettingsTabProps) {
  const { data } = useRouteContext({ from: '__root__' });
  // What each follow up last held, so switching back and forth keeps what was typed.
  const [kept, setKept] = useState({
    message: draft.after.kind === 'redirect' ? '' : draft.after.message,
    url: draft.after.kind === 'redirect' ? draft.after.url : 'https://',
    bookingPageId: draft.after.kind === 'booking' ? draft.after.bookingPageId : undefined,
    countdownSeconds: draft.after.kind === 'booking' ? draft.after.countdownSeconds : 5,
  });
  // The booking pages a visitor can be sent on to: the reader's own, or everyone's with booking.admin, live ones.
  const pages = useCaptureList(data.bookingPages.view(slug));
  const seesAllPages = useCan('booking.admin');
  const pageList: readonly BookingPageView[] = pages.status === 'ready' ? pages.items : [];
  const usable = pageList.filter((page) => page.canChange && page.status === 'live');

  const after = draft.after;
  // An incomplete field (a partial web address, no button words) says what it needs once it is left, never mid
  // typing, or when a Publish was refused for it; until then the draft keeps the value before, and Publish waits.
  // Coming back to the tab with one still incomplete shows it at once.
  const [left, setLeft] = useState(() => ({
    address: after.kind === 'redirect' && !isRedirectAddress(after.url),
    button: draft.buttonText.trim() === '',
  }));
  const redirectError =
    !isReadOnly && after.kind === 'redirect' && (left.address || showGaps) && !isRedirectAddress(after.url)
      ? strings.redirectIncomplete
      : undefined;
  const buttonError =
    !isReadOnly && (left.button || showGaps) && draft.buttonText.trim() === '' ? strings.buttonTextMissing : undefined;

  // Booking is always a choice: with no live page to send visitors to, it shows the picker's empty state (create
  // one) and the draft keeps its follow up until a page can be picked.
  const [isBookingPending, setBookingPending] = useState(false);
  const shownKind: AfterKind = isBookingPending ? 'booking' : draft.after.kind;
  // A live page arriving while Booking waits (the list loading, a teammate turning one on) swaps the empty state
  // for the picker; picking a page completes the choice.
  const pickPending = (pageId: string) => {
    setBookingPending(false);
    onDraftChange((before) => ({
      ...before,
      after: {
        kind: 'booking',
        bookingPageId: pageId,
        countdownSeconds: kept.countdownSeconds,
        message: before.after.kind === 'redirect' ? kept.message : before.after.message,
      },
    }));
  };

  const choose = (next: AfterKind) => {
    if (next === shownKind) return;
    setBookingPending(false);
    if (next === after.kind) return;
    setLeft((before) => ({ ...before, address: false }));
    // Keep what the other choice held, then bring back what this one held.
    setKept((before) =>
      after.kind === 'redirect'
        ? { ...before, url: after.url }
        : after.kind === 'booking'
          ? {
              ...before,
              message: after.message,
              bookingPageId: after.bookingPageId,
              countdownSeconds: after.countdownSeconds,
            }
          : { ...before, message: after.message },
    );
    // On to book takes the page it last had while it can still be used, else the first that can.
    const pageId = usable.some((page) => page.id === kept.bookingPageId) ? kept.bookingPageId : usable[0]?.id;
    if (next === 'booking' && pageId === undefined) {
      setBookingPending(true);
      return;
    }
    // The thank you and on to book share their words: the ones on screen carry over.
    const message = after.kind === 'redirect' ? kept.message : after.message;
    onDraftChange((before) => ({
      ...before,
      after:
        next === 'redirect'
          ? { kind: 'redirect', url: kept.url }
          : next === 'booking' && pageId !== undefined
            ? { kind: 'booking', bookingPageId: pageId, countdownSeconds: kept.countdownSeconds, message }
            : { kind: 'message', message },
    }));
  };

  // Routing (spec 0043): a team page's people, for rules that narrow who takes the booking.
  const rotations = useCaptureList(data.rotations.view(slug));
  const rotationList = rotations.status === 'ready' ? rotations.items : [];

  // The owner of new records (AC-567): nobody, a teammate, or a round robin group (spec 0029, AC-755), the groups
  // the reader can see under their own heading. One the form names that the reader can't list stays shown, by name.
  const chosenGroupId = groupOf(settings.values.owner);
  const chosenGroup = rotationList.find((rotation) => rotation.id === chosenGroupId);
  // A teammate the form names who has left (late trap #88): shown as such, and the hint says their leads go unowned.
  const ownerLeft =
    chosenGroupId === undefined &&
    settings.values.owner !== NOBODY &&
    !members.some((member) => member.id === settings.values.owner);
  const takers = (rotation: (typeof rotationList)[number]) => rotation.members.filter((member) => member.isOn).length;
  const ownerItems = [
    { id: NOBODY, label: strings.nobody },
    ...members.map((member) => ({ id: member.id, label: member.name })),
    ...rotationList.map((rotation) => ({
      id: groupOption(rotation.id),
      label: rotation.name,
      description: strings.groupTakers(takers(rotation)),
      group: strings.ownerGroups,
    })),
    ...(chosenGroupId !== undefined && chosenGroup === undefined
      ? [{ id: groupOption(chosenGroupId), label: strings.groupUnknown, group: strings.ownerGroups }]
      : []),
    ...(ownerLeft ? [{ id: settings.values.owner, label: strings.ownerFormer }] : []),
  ];
  // Who is emailed each submission: any teammate; one listed whom the reader can't list stays shown as former.
  const notifyItems = [
    ...members.map((member) => ({ id: member.id, label: member.name })),
    ...settings.values.notify
      .filter((id) => !members.some((member) => member.id === id))
      .map((id) => ({ id, label: strings.noticesFormer })),
  ];
  // One line under it: who gets new records, or why nobody will.
  const ownerHint = ownerLeft
    ? strings.ownerLeftHint
    : rotations.status === 'error'
      ? strings.groupsFailed
      : chosenGroupId === undefined || (chosenGroup === undefined && rotations.status !== 'ready')
        ? strings.ownerHint
        : chosenGroup === undefined
          ? strings.groupHidden
          : takers(chosenGroup) === 0
            ? strings.groupNobodyOn(chosenGroup.name)
            : strings.groupHint(chosenGroup.name);
  const poolOf = (pageId: string) => {
    const page = pageList.find((each) => each.id === pageId);
    if (page?.kind !== 'round_robin') return [];
    const ids = new Set(page.hosts?.rotations ?? []);
    const pool = rotationList
      .filter((rotation) => ids.has(rotation.id))
      .flatMap((rotation) => rotation.members.map((member) => ({ id: member.memberId, name: member.name })));
    return pool.filter((member, at) => pool.findIndex((each) => each.id === member.id) === at);
  };
  const live = form.live;
  // By value, not as text: rules the editor wrote spell their keys in another order than the published ones, so
  // text said "waits for publish" for rules that were already live.
  const routingChanged = live !== undefined && !sameValue(live.routing.rules, draft.routing.rules);
  // Where answers are saved, as the live form does it: a change waits for Publish, and the card says so, naming where
  // submissions still go meanwhile (late trap #39: the card showed the new object as if it were already in use).
  const savingOf = (document: Pick<FormDocument, 'targets' | 'questions'>) => ({
    targets: document.targets,
    filed: document.questions.map((question) => [question.id, question.filedOn?.attributeId ?? null]),
  });
  const isPublished = form.liveVersionNumber !== undefined;
  const savingChanged = live !== undefined && !sameValue(savingOf(live), savingOf(draft));
  const liveMain = live?.targets.main;
  const liveObjectName =
    liveMain === undefined ? undefined : objects.find((object) => object.id === liveMain.objectId)?.pluralName;
  const savingWaits = !savingChanged
    ? undefined
    : liveMain === undefined
      ? strings.savingWaitsKeptOnly
      : strings.savingWaits(liveObjectName ?? strings.thisObject);

  const bookingPage = after.kind === 'booking' ? pageList.find((page) => page.id === after.bookingPageId) : undefined;
  const afterProblem = afterPageProblem(draft, pages.status === 'ready' ? pages.items : undefined, seesAllPages);
  // Where each question's answer goes: the target's attribute, or kept with the submission only.
  const isFiling = draft.targets.main !== undefined && target.objectName !== undefined;
  const objectName = target.objectName ?? '';
  const attributeTitle = (attributeId: string | undefined) =>
    target.items.find((item) => item.attributeId === attributeId)?.title;
  // The match, said by the question that carries it ("Work email"), or the attribute when no question does.
  const matchId = draft.targets.main?.matchAttributeId;
  const matchQuestion = draft.questions.find((question) => question.filedOn?.attributeId === matchId);
  const matchTitle = matchQuestion?.label ?? attributeTitle(matchId);
  // Each row links to its question on the Form tab, where its filing is set.
  const filing = draft.questions.map((question) => {
    const title = attributeTitle(question.filedOn?.attributeId);
    return {
      id: question.id,
      question: question.label.trim() === '' ? strings.untitledQuestion : question.label,
      savedAs: title === undefined ? strings.keptOnly : strings.filedOn(objectName, title),
    };
  });
  // The object a submission goes to when the switch is turned on: People, else the first live object.
  const liveObjects = objects.filter((object) => !object.isArchived && object.access === 'write');
  const firstObject = liveObjects.find((object) => object.standardKey === 'people') ?? liveObjects[0];

  return (
    <>
      <Card title={strings.afterTitle}>
        <SegmentedControl
          label={strings.afterChoice}
          size="compact"
          segments={[
            { value: 'message', label: strings.showMessage },
            { value: 'redirect', label: strings.sendToAddress },
            { value: 'booking', label: strings.bookMeeting },
          ]}
          value={shownKind}
          isReadOnly={isReadOnly}
          onChange={(value) => {
            if (value === 'message' || value === 'redirect' || value === 'booking') choose(value);
          }}
        />
        {isBookingPending && usable.length > 0 && (
          <Select
            label={strings.bookingPage}
            placeholder={strings.pickBookingPage}
            items={usable.map((page) => ({
              id: page.id,
              label: strings.pageItem(page.title, page.durations[0] ?? 30),
            }))}
            value={null}
            isReadOnly={isReadOnly}
            onChange={(id) => {
              if (id !== null) pickPending(id);
            }}
          />
        )}
        {isBookingPending && usable.length === 0 && (
          <EmptyState
            layout="row"
            {...(pages.status === 'error' ? { tone: 'error' as const } : { icon: 'link' as const })}
            isLoading={pages.status === 'loading'}
            title={pages.status === 'error' ? strings.bookingPagesFailed : strings.noBookingPages}
            {...(pages.status === 'ready'
              ? {
                  actions: (
                    <ButtonLink href={linksHref(slug)} variant="secondary">
                      {strings.createBookingPage}
                    </ButtonLink>
                  ),
                }
              : {})}
          >
            {/* Until a page can be picked, the form keeps doing what it did: said, so nobody leaves thinking otherwise. */}
            {after.kind === 'redirect' ? strings.keepsWebPage : strings.keepsMessage}
          </EmptyState>
        )}
        {after.kind === 'booking' && (
          <>
            {/* Late trap #53: the page paused (by hand, or its last host left) or went, and every visitor quietly got
                the message instead of a meeting. Said here, beside the choice that fixes it. */}
            {afterProblem?.kind === 'paused' && (
              <Callout
                tone="warning"
                title={strings.pagePausedTitle(afterProblem.page.title)}
                {...(afterProblem.page.canChange
                  ? {
                      actions: (
                        <ButtonLink href={pageEditorHref(slug, afterProblem.page.id)} variant="secondary">
                          {strings.openPage}
                        </ButtonLink>
                      ),
                    }
                  : {})}
              >
                {strings.pagePaused({
                  hostLeft: afterProblem.page.pausedReason === 'host_removed',
                  canResume: afterProblem.page.canChange,
                  canPick: !isReadOnly,
                })}
              </Callout>
            )}
            {afterProblem?.kind === 'gone' && (
              <Callout tone="warning" title={strings.pageGoneTitle}>
                {strings.pageGone(!isReadOnly)}
              </Callout>
            )}
            <Select
              label={strings.bookingPage}
              items={[
                ...usable.map((page) => ({
                  id: page.id,
                  label: strings.pageItem(page.title, page.durations[0] ?? 30),
                })),
                // The page chosen before, now paused or no longer the reader's, stays shown, muted, with why.
                ...(bookingPage !== undefined && !usable.includes(bookingPage)
                  ? [
                      {
                        id: bookingPage.id,
                        label: bookingPage.title,
                        description: strings.pageNotUsable,
                        isArchived: true,
                      },
                    ]
                  : []),
              ]}
              value={after.bookingPageId}
              isReadOnly={isReadOnly}
              onChange={(id) => {
                if (id === null) return;
                onDraftChange((before) =>
                  before.after.kind === 'booking'
                    ? { ...before, after: { ...before.after, bookingPageId: id } }
                    : before,
                );
              }}
            />
            <Select
              label={strings.countdown}
              items={COUNTDOWNS.map((seconds) => ({
                id: String(seconds),
                label: seconds === 0 ? strings.countdownAtOnce : strings.countdownAfter(seconds),
              }))}
              value={String(after.countdownSeconds)}
              isReadOnly={isReadOnly}
              onChange={(id) => {
                const seconds = Number(id);
                if (!Number.isInteger(seconds)) return;
                onDraftChange((before) =>
                  before.after.kind === 'booking'
                    ? { ...before, after: { ...before.after, countdownSeconds: seconds } }
                    : before,
                );
              }}
            />
          </>
        )}
        {isBookingPending ? null : after.kind === 'redirect' ? (
          <Field
            label={strings.redirectUrl}
            {...(redirectError === undefined ? {} : { error: redirectError })}
            type="url"
            value={after.url}
            hint={strings.redirectHint}
            onBlur={() => {
              setLeft((before) => ({ ...before, address: true }));
            }}
            isRequired
            isReadOnly={isReadOnly}
            onChange={(url) => {
              onDraftChange((before) => ({ ...before, after: { kind: 'redirect', url } }));
            }}
          />
        ) : (
          <Field
            label={strings.thankYou}
            placeholder={strings.thankYouDefault}
            isMultiline
            showCounter
            value={after.message}
            maxLength={2_000}
            isReadOnly={isReadOnly}
            onChange={(message) => {
              onDraftChange((before) => ({
                ...before,
                after: before.after.kind === 'booking' ? { ...before.after, message } : { kind: 'message', message },
              }));
            }}
          />
        )}
      </Card>
      <RulesCard
        data={data}
        slug={slug}
        surface={{ kind: 'form', pages: usable, poolOf }}
        report={{ kind: 'form', formId: form.id }}
        rules={draft.routing.rules}
        facts={questionFacts(draft.questions)}
        factLabel={routingStrings.question}
        emptyFacts={routingStrings.noQuestions}
        description={routingStrings.formRoutingLine(draft.routing.rules.length)}
        isReadOnly={isReadOnly}
        waitsForPublish={routingChanged}
        nameOf={(memberId) => members.find((member) => member.id === memberId)?.name ?? ''}
        onRulesChange={(rules) => {
          onDraftChange((before) => ({ ...before, routing: { rules: [...rules] } }));
          return Promise.resolve();
        }}
      />
      <Card
        title={strings.crmTitle}
        isBusy={isRetargeting}
        {...(savingWaits === undefined ? {} : { description: savingWaits })}
      >
        <Switch
          label={strings.addToCrmSwitch}
          // Whether a submission makes a record or updates one matters, so it stays in view while the form files.
          {...(isFiling && matchTitle !== undefined ? { description: strings.addToCrmOn(objectName, matchTitle) } : {})}
          isSelected={draft.targets.main !== undefined}
          isReadOnly={isReadOnly}
          isDisabled={isRetargeting || (draft.targets.main === undefined && firstObject === undefined)}
          onChange={(isOn) => {
            onRetarget(isOn ? (firstObject?.id ?? null) : null);
          }}
        />
        {isFiling && (
          <>
            <Select
              label={strings.whichObject}
              items={liveObjects.map((object) => ({ id: object.id, label: object.pluralName, icon: object.icon }))}
              value={draft.targets.main?.objectId ?? null}
              isReadOnly={isReadOnly}
              isDisabled={isRetargeting}
              onChange={(objectId) => {
                if (objectId !== null) onRetarget(objectId);
              }}
            />
            {filing.length > 0 && (
              <Table
                label={strings.mappingLabel}
                columns={[
                  { id: 'question', label: strings.mappingQuestion, isRowHeader: true },
                  { id: 'savedAs', label: strings.mappingSavedAs },
                ]}
                rows={filing}
                getRowId={(row) => row.id}
                renderCell={(row, column) =>
                  column === 'question' ? (
                    row.question
                  ) : (
                    <Link href={questionHref(slug, form.id, row.id)}>{row.savedAs}</Link>
                  )
                }
              />
            )}
          </>
        )}
      </Card>
      <Card title={strings.wordsTitle}>
        <Field
          label={strings.headline}
          placeholder={strings.headlineDefault}
          value={draft.headline}
          maxLength={120}
          isReadOnly={isReadOnly}
          onChange={(headline) => {
            onDraftChange((before) => ({ ...before, headline }));
          }}
        />
        <Field
          label={strings.subheadingOptional}
          value={draft.subheading ?? ''}
          maxLength={240}
          isReadOnly={isReadOnly}
          onChange={(subheading) => {
            onDraftChange((before) => ({ ...before, subheading }));
          }}
        />
        <Field
          label={strings.buttonText}
          value={draft.buttonText}
          {...(buttonError === undefined ? {} : { error: buttonError })}
          onBlur={() => {
            setLeft((before) => ({ ...before, button: true }));
          }}
          maxLength={40}
          isReadOnly={isReadOnly}
          onChange={(buttonText) => {
            onDraftChange((before) => ({ ...before, buttonText }));
          }}
        />
      </Card>
      {/* Before the first publish, the name and address belong to the Form tab and the publish dialog (late trap #47):
          one place each, and no talk of old links for a form that has none. */}
      {(isPublished || isFiling) && (
        <Card title={strings.detailsTitle}>
          {isPublished && (
            <>
              <Field
                label={strings.name}
                hint={strings.nameHint}
                value={settings.values.name}
                maxLength={80}
                isRequired
                isReadOnly={isReadOnly}
                onChange={(name) => {
                  settings.set({ name });
                }}
                {...(settings.values.name.trim() === ''
                  ? { error: strings.nameRequired }
                  : settings.fieldError('name') === undefined
                    ? {}
                    : { error: settings.fieldError('name') ?? '' })}
              />
              <Field
                label={strings.address}
                prefix={data.forms.hostedUrl('').replace(/^https?:\/\//, '')}
                hint={strings.addressChangeWarning}
                value={settings.values.address}
                maxLength={40}
                isRequired
                isReadOnly={isReadOnly}
                onChange={(text) => {
                  settings.set({ address: text.toLowerCase() });
                }}
                {...(settings.fieldError('slug') === undefined ? {} : { error: settings.fieldError('slug') ?? '' })}
              />
            </>
          )}
          {/* Only a form that adds submissions to the CRM makes records for someone to own. */}
          {isFiling && (
            <Select
              label={strings.owner}
              hint={ownerHint}
              items={ownerItems}
              value={settings.values.owner}
              isReadOnly={isReadOnly}
              {...(settings.fieldError('owner') === undefined ? {} : { error: settings.fieldError('owner') ?? '' })}
              onChange={(id) => {
                settings.set({ owner: id ?? NOBODY });
              }}
            />
          )}
        </Card>
      )}
      <Card title={strings.noticesTitle}>
        <Select
          label={strings.noticesLabel}
          selectionMode="multiple"
          placeholder={strings.noticesNobody}
          hint={strings.noticesHint(isFiling)}
          items={notifyItems}
          values={settings.values.notify}
          isReadOnly={isReadOnly}
          {...(settings.fieldError('notifyMemberIds') === undefined
            ? {}
            : { error: settings.fieldError('notifyMemberIds') ?? '' })}
          onValuesChange={(ids) => {
            settings.set({ notify: ids });
          }}
        />
      </Card>
      <Card
        title={strings.spamTitle}
        {...(isPublished
          ? {
              actions: (
                <ButtonLink href={`${formHref(slug, form.id, 'submissions')}&state=needs_review`} variant="secondary">
                  {strings.spamReview}
                </ButtonLink>
              ),
            }
          : {})}
      >
        {strings.spamSummary}
      </Card>
    </>
  );
}
