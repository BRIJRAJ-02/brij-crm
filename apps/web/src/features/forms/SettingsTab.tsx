// Brief
// Purpose: a form's Settings tab (spec 0023), for someone setting up a form in under a minute: what people see after
// sending, where the answers go in the CRM, the form's words, its name and address, and its spam protection.
// Main task: read each group's one line summary, change only what needs changing (the defaults already work), and
// save the name, address and owner from the SaveBar; the words and what follows a send go live on Publish.
// Leaves out: email notifications (no backend yet), filing on a Company or Deal (one object per form today), each
// question's filing (set on the question, linked from here), and the look (beside the preview).
import type { BookingPageView, FormDocument, FormTargetChoices, FormView, MemberSummary } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import {
  Callout,
  Card,
  DescriptionList,
  Field,
  Link,
  Radio,
  RadioGroup,
  SaveBar,
  Select,
  type SaveBarStatus,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { linksHref } from '../booking/links.ts';
import { pageHeading } from '../navigation/focus.ts';
import { sameDocument } from './draft.ts';
import { formHref } from './paths.ts';
import { firstRefusal } from './refusals.ts';
import { strings } from './strings.ts';

const NOBODY = 'nobody';

/** The delays a meeting step may wait before it moves on, in seconds (0 is at once). */
const DELAYS = [0, 3, 5, 10, 15, 30] as const;

/** A web address without its scheme, for a summary ("acme.com/thanks"). */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

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
  const [values, setValues] = useState<Applied>(saved);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [failure, setFailure] = useState<{ readonly message: string; readonly field?: string } | undefined>(undefined);
  const isDirty = values.name !== saved.name || values.address !== saved.address || values.owner !== saved.owner;

  const set = (patch: Partial<Applied>) => {
    setValues((before) => ({ ...before, ...patch }));
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
          setValues({ name: view.name, address: view.publicKey, owner: view.ownerMemberId ?? NOBODY });
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
        setValues(saved);
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
  readonly members: readonly MemberSummary[];
  readonly isReadOnly: boolean;
  readonly settings: FormSettings;
  readonly onDraftChange: (next: FormDocument | ((before: FormDocument) => FormDocument)) => void;
}

/** Which of the three follow ups a draft holds: a meeting is the message's offer of a booking page. */
type AfterChoice = 'message' | 'redirect' | 'meeting';

/** The groups, as Cards with a one line summary each, set two abreast where there is room. */
export function SettingsTab({
  slug,
  form,
  draft,
  target,
  members,
  isReadOnly,
  settings,
  onDraftChange,
}: SettingsTabProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const pages = useCaptureList(data.bookingPages.view(slug));
  const bookingPages: readonly BookingPageView[] = pages.status === 'ready' ? pages.items : [];
  // What each follow up last held, so switching back and forth keeps what was typed.
  const [kept, setKept] = useState({
    message: draft.after.kind === 'message' ? draft.after.message : '',
    url: draft.after.kind === 'redirect' ? draft.after.url : 'https://',
  });
  // Not in the form's document yet (wip/formdesign's contract): how long the meeting step waits.
  const [delay, setDelay] = useState<number>(5);

  const after = draft.after;
  const choice: AfterChoice =
    after.kind === 'redirect' ? 'redirect' : after.offerMeeting === undefined ? 'message' : 'meeting';
  const live = form.live;
  const seenChanged =
    live !== undefined &&
    (draft.headline !== live.headline ||
      (draft.subheading ?? '') !== (live.subheading ?? '') ||
      draft.buttonText !== live.buttonText);
  const afterChanged = live !== undefined && !sameDocument({ ...draft, after }, { ...draft, after: live.after });
  const meetingPage =
    after.kind === 'message' ? bookingPages.find((page) => page.id === after.offerMeeting?.bookingPageId) : undefined;

  const choose = (next: AfterChoice) => {
    if (next === choice) return;
    setKept((before) =>
      after.kind === 'message' ? { ...before, message: after.message } : { ...before, url: after.url },
    );
    onDraftChange((before) => ({
      ...before,
      after:
        next === 'redirect'
          ? { kind: 'redirect', url: kept.url }
          : next === 'meeting'
            ? {
                kind: 'message',
                message: kept.message,
                ...(bookingPages[0] === undefined ? {} : { offerMeeting: { bookingPageId: bookingPages[0].id } }),
              }
            : { kind: 'message', message: kept.message },
    }));
  };

  const afterSummary =
    choice === 'redirect'
      ? after.kind === 'redirect' && shortUrl(after.url) !== ''
        ? strings.sendsTo(shortUrl(after.url))
        : strings.noAddressYet
      : choice === 'meeting'
        ? meetingPage === undefined
          ? strings.meetingNoPage
          : strings.meetingSummary(meetingPage.title)
        : strings.showsMessage;

  // What a visitor sees once they send, drawn small beside the choice.
  const afterPreview: ReactNode =
    choice === 'redirect'
      ? strings.previewRedirect(after.kind === 'redirect' ? shortUrl(after.url) : '')
      : choice === 'meeting'
        ? delay === 0
          ? strings.previewMeetingNow
          : strings.previewMeeting(delay)
        : after.kind === 'message' && after.message.trim() !== ''
          ? after.message
          : strings.thankYouDefault;

  // Where each question's answer goes: the target's attribute, or kept with the submission only.
  const attributeTitle = (attributeId: string | undefined) =>
    target.items.find((item) => item.attributeId === attributeId)?.title;
  const matchTitle = attributeTitle(draft.targets.main.matchAttributeId);
  const filing = draft.questions.map((question) => {
    const title = attributeTitle(question.filedOn?.attributeId);
    return {
      term: question.label.trim() === '' ? strings.untitledQuestion : question.label,
      description: (
        <Link href={formHref(slug, form.id)}>
          {title === undefined ? strings.keptOnly : strings.filedOn(target.objectName, title)}
        </Link>
      ),
    };
  });
  const filedCount = draft.questions.filter(
    (question) => attributeTitle(question.filedOn?.attributeId) !== undefined,
  ).length;

  return (
    <>
      <Card
        title={strings.afterTitle}
        description={[afterSummary, afterChanged ? strings.waitsForPublish : '']
          .filter((part) => part !== '')
          .join(' · ')}
      >
        <RadioGroup
          label={strings.afterChoice}
          isLabelHidden
          orientation="horizontal"
          value={choice}
          isReadOnly={isReadOnly}
          onChange={(value) => {
            if (value === 'message' || value === 'redirect' || value === 'meeting') choose(value);
          }}
        >
          <Radio value="message">{strings.showMessage}</Radio>
          <Radio value="redirect">{strings.sendToAddress}</Radio>
          <Radio value="meeting">{strings.bookMeeting}</Radio>
        </RadioGroup>
        {choice === 'redirect' && after.kind === 'redirect' && (
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
        )}
        {choice === 'message' && after.kind === 'message' && (
          <Field
            label={strings.thankYou}
            placeholder={strings.thankYouDefault}
            isMultiline
            showCounter
            value={after.message}
            maxLength={2_000}
            isReadOnly={isReadOnly}
            onChange={(message) => {
              onDraftChange((before) => ({ ...before, after: { kind: 'message', message } }));
            }}
          />
        )}
        {choice === 'meeting' &&
          after.kind === 'message' &&
          (pages.status === 'ready' && bookingPages.length === 0 ? (
            <Callout tone="info" actions={<Link href={linksHref(slug)}>{strings.createBookingPage}</Link>}>
              {strings.noBookingPagesYet}
            </Callout>
          ) : (
            <>
              <Select
                label={strings.whichBookingPage}
                items={bookingPages.map((page) => ({
                  id: page.id,
                  label: strings.bookingPageItem(page.title, page.durations[0] ?? 30),
                }))}
                value={after.offerMeeting?.bookingPageId ?? null}
                isReadOnly={isReadOnly}
                onChange={(bookingPageId) => {
                  if (bookingPageId === null) return;
                  onDraftChange((before) => ({
                    ...before,
                    after: {
                      kind: 'message',
                      message: before.after.kind === 'message' ? before.after.message : '',
                      offerMeeting: { bookingPageId },
                    },
                  }));
                }}
              />
              <Select
                label={strings.meetingDelay}
                items={DELAYS.map((seconds) => ({ id: String(seconds), label: strings.delayLabel(seconds) }))}
                value={String(delay)}
                isReadOnly={isReadOnly}
                onChange={(id) => {
                  setDelay(Number(id ?? 5));
                }}
              />
            </>
          ))}
        <Card tone="sunken" title={strings.whatTheySee}>
          {afterPreview}
        </Card>
      </Card>
      <Card title={strings.answersTitle} description={strings.answersSummary(target.objectName, filedCount)}>
        <DescriptionList
          items={[
            { term: strings.eachSend, description: strings.createsOrUpdates(target.objectName, matchTitle) },
            ...filing,
          ]}
        />
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
      </Card>
      <Card title={strings.wordsTitle} description={seenChanged ? strings.waitsForPublish : strings.liveNow}>
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
      <Card title={strings.nameAndAddress} description={data.forms.hostedUrl(settings.values.address)}>
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
          prefix="/f/"
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
      </Card>
      <Card title={strings.spamTitle} description={strings.spamSummary}>
        <Link href={`${formHref(slug, form.id, 'submissions')}&state=needs_review`}>{strings.spamReview}</Link>
      </Card>
    </>
  );
}
