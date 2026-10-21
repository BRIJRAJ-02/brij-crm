// Brief
// Purpose: a form's Settings tab (spec 0023), for someone setting up a form in under a minute: what people see after
// sending, whether and where submissions go in the CRM, the form's words, its name and address, and spam protection.
// Main task: read each group's one line summary, change only what needs changing (the defaults already work), and
// save the name, address and owner from the SaveBar; the words, what follows a send and where submissions go go live
// on Publish.
// Leaves out: email notifications (no backend yet), each question's filing (set on the question, linked from here),
// and the look (beside the preview).
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
  Card,
  DescriptionList,
  Field,
  InfoTip,
  Link,
  Radio,
  RadioGroup,
  SaveBar,
  Select,
  Switch,
  type SaveBarStatus,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { linksHref } from '../booking/links.ts';
import { pageHeading } from '../navigation/focus.ts';
import { sameDocument } from './draft.ts';
import { formHref } from './paths.ts';
import { firstRefusal } from './refusals.ts';
import { strings } from './strings.ts';
import { questionFacts } from '../routing/facts.ts';
import { RulesCard } from '../routing/RulesCard.tsx';
import { strings as routingStrings } from '../routing/strings.ts';

const NOBODY = 'nobody';

/** The countdowns a form offers before it sends its visitor on to book (AC-1056): 0 is at once. */
const COUNTDOWNS = [0, 3, 5, 10, 15, 30] as const;

/** What sending a form leads to: a thank you, another web page, or on to book (AC-1055). */
type AfterKind = FormDocument['after']['kind'];

/**
 * One form's Form tab with one question open and in view: the map of where answers go links each line here.
 * Kept beside its one link rather than in paths.ts, which the routes load up front.
 */
const questionHref = (slug: string, formId: string, questionId: string) =>
  `/w/${slug}/forms/${formId}?question=${encodeURIComponent(questionId)}`;

/** The settings that apply when saved: the name, the address and the owner. */
interface Applied {
  readonly name: string;
  readonly address: string;
  readonly owner: string;
}

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
  const saved: Applied = { name: form.name, address: form.publicKey, owner: form.ownerMemberId ?? NOBODY };
  // Only the edits are held, so a change made elsewhere (the first publish, a rename) shows here at once.
  const [edits, setEdits] = useState<Partial<Applied>>({});
  const values: Applied = { ...saved, ...edits };
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [failure, setFailure] = useState<{ readonly message: string; readonly field?: string } | undefined>(undefined);
  const isDirty = values.name !== saved.name || values.address !== saved.address || values.owner !== saved.owner;

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
        ...(values.owner === saved.owner ? {} : { ownerMemberId: values.owner === NOBODY ? null : values.owner }),
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

  const fieldError = (field: 'name' | 'slug') => (failure?.field === field ? failure.message : undefined);
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
}

/** The groups, as Cards with a one line summary each, set two abreast where there is room. */
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
  const pageList: readonly BookingPageView[] = pages.status === 'ready' ? pages.items : [];
  const usable = pageList.filter((page) => page.canChange && page.status === 'live');

  const after = draft.after;
  const live = form.live;
  const seenChanged =
    live !== undefined &&
    (draft.headline !== live.headline ||
      (draft.subheading ?? '') !== (live.subheading ?? '') ||
      draft.buttonText !== live.buttonText);
  const afterChanged = live !== undefined && !sameDocument({ ...draft, after }, { ...draft, after: live.after });
  const targetChanged = live !== undefined && live.targets.main?.objectId !== draft.targets.main?.objectId;

  const choose = (next: AfterKind) => {
    if (next === after.kind) return;
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
    if (next === 'booking' && pageId === undefined) return;
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
  const poolOf = (pageId: string) => {
    const page = pageList.find((each) => each.id === pageId);
    if (page?.kind !== 'round_robin') return [];
    const ids = new Set(page.hosts?.rotations ?? []);
    const pool = rotationList
      .filter((rotation) => ids.has(rotation.id))
      .flatMap((rotation) => rotation.members.map((member) => ({ id: member.memberId, name: member.name })));
    return pool.filter((member, at) => pool.findIndex((each) => each.id === member.id) === at);
  };
  const routingChanged =
    live !== undefined && JSON.stringify(live.routing.rules) !== JSON.stringify(draft.routing.rules);

  const bookingPage = after.kind === 'booking' ? pageList.find((page) => page.id === after.bookingPageId) : undefined;
  // Where each question's answer goes: the target's attribute, or kept with the submission only.
  const isFiling = draft.targets.main !== undefined && target.objectName !== undefined;
  const objectName = target.objectName ?? '';
  const attributeTitle = (attributeId: string | undefined) =>
    target.items.find((item) => item.attributeId === attributeId)?.title;
  // The match, said by the question that carries it ("Work email"), or the attribute when no question does.
  const matchId = draft.targets.main?.matchAttributeId;
  const matchQuestion = draft.questions.find((question) => question.filedOn?.attributeId === matchId);
  const matchTitle = matchQuestion?.label ?? attributeTitle(matchId);
  // Each line links to its question on the Form tab, where its filing is set.
  const filing = draft.questions.map((question) => {
    const title = attributeTitle(question.filedOn?.attributeId);
    return {
      term: question.label.trim() === '' ? strings.untitledQuestion : question.label,
      description: (
        <Link href={questionHref(slug, form.id, question.id)}>
          {title === undefined ? strings.keptOnly : strings.filedOn(objectName, title)}
        </Link>
      ),
    };
  });
  // The object a submission goes to when the switch is turned on: People, else the first live object.
  const liveObjects = objects.filter((object) => !object.isArchived && object.access === 'write');
  const firstObject = liveObjects.find((object) => object.standardKey === 'people') ?? liveObjects[0];

  return (
    <>
      <Card
        title={strings.afterTitle}
        {...(afterChanged ? { description: strings.waitsForPublish } : {})}
        actions={
          <InfoTip label={strings.afterTitle} example={strings.afterTipExample}>
            {strings.afterTip}
          </InfoTip>
        }
      >
        <RadioGroup
          label={strings.afterChoice}
          isLabelHidden
          orientation="horizontal"
          value={after.kind}
          isReadOnly={isReadOnly}
          onChange={(value) => {
            if (value === 'message' || value === 'redirect' || value === 'booking') choose(value);
          }}
        >
          <Radio value="message">{strings.showMessage}</Radio>
          <Radio value="redirect">{strings.sendToAddress}</Radio>
          <Radio
            value="booking"
            // Without a live page of their own to send visitors to, the choice says why it can't be picked.
            isDisabled={after.kind !== 'booking' && usable.length === 0}
            {...(after.kind !== 'booking' && usable.length === 0
              ? { description: pages.status === 'error' ? strings.bookingPagesFailed : strings.noBookingPages }
              : {})}
          >
            {strings.bookMeeting}
          </Radio>
        </RadioGroup>
        {after.kind !== 'booking' && usable.length === 0 && pages.status === 'ready' && !isReadOnly && (
          <Link href={linksHref(slug)}>{strings.createBookingPage}</Link>
        )}
        {after.kind === 'booking' && (
          <>
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
              hint={strings.bookingPreview(after.countdownSeconds)}
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
        {after.kind === 'redirect' ? (
          <Field
            label={strings.redirectUrl}
            hint={strings.redirectHint}
            type="url"
            value={after.url}
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
            {...(after.kind === 'booking' ? { hint: strings.bookingThankYouHint } : {})}
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
        title={strings.answersTitle}
        {...(targetChanged ? { description: strings.waitsForPublish } : {})}
        isBusy={isRetargeting}
      >
        <Switch
          label={strings.addToCrmSwitch}
          description={isFiling ? strings.addToCrmOn(objectName, matchTitle) : strings.addToCrmOff}
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
            <DescriptionList items={filing} />
          </>
        )}
      </Card>
      <Card title={strings.wordsTitle} {...(seenChanged ? { description: strings.waitsForPublish } : {})}>
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
          placeholder={strings.buttonDefault}
          value={draft.buttonText}
          maxLength={40}
          isReadOnly={isReadOnly}
          onChange={(buttonText) => {
            onDraftChange((before) => ({ ...before, buttonText }));
          }}
        />
      </Card>
      <Card title={isFiling ? strings.nameAndAddress : strings.nameAndLink} description={strings.savedWithSave}>
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
        {/* Only a form that adds submissions to the CRM makes records for someone to own. */}
        {isFiling && (
          <Select
            label={strings.owner}
            hint={strings.ownerHint}
            items={[
              { id: NOBODY, label: strings.nobody },
              ...members.map((member) => ({ id: member.id, label: member.name })),
            ]}
            value={settings.values.owner}
            isReadOnly={isReadOnly}
            onChange={(id) => {
              settings.set({ owner: id ?? NOBODY });
            }}
          />
        )}
      </Card>
      <Card title={strings.spamTitle} description={strings.spamSummary}>
        <Link href={`${formHref(slug, form.id, 'submissions')}&state=needs_review`}>{strings.spamReview}</Link>
      </Card>
    </>
  );
}
