// Brief
// Purpose: a form's Settings tab (spec 0023; T21, 5 November 2026): the form's own settings as plain rows: name, link,
// where answers are saved, the owner of new records, who is emailed, whether it takes submissions, and spam.
// Main task: scan the rows and change only what needs changing (the defaults already work). Nothing here has a Save:
// each row saves itself (where answers are saved goes live with the header's one Publish).
// Leaves out: everything a visitor meets (the words, what happens after they send, the look), on the Form tab beside
// the preview; each question's filing (set on the question).
import type {
  FormDocument,
  FormQuestion,
  FormTargetChoices,
  FormView,
  LiveSettingsChange,
  MemberSummary,
  ObjectSummary,
} from '@crm/data';
import {
  CLOSE_AFTER_MAX,
  CLOSED_MESSAGE_MAX,
  CONFIRMATION_LINE_MAX,
  CONFIRMATION_SUBJECT_MAX,
  FORM_SLUG,
} from '@crm/data/forms';
import { closingKind, closingOnDay, dayIn, dayOfClosing, type ClosingKind } from './closing.ts';
import { useCaptureList } from '@crm/data/react';
import {
  Avatar,
  Button,
  ButtonLink,
  Card,
  CopyButton,
  DatePicker,
  Field,
  InfoTip,
  Modal,
  Select,
  SettingsRow,
  SettingsSection,
  SettingsStack,
  Switch,
  useFormatSettings,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { KeepSubmissionsRow } from './KeepSubmissions.tsx';
import { formHref } from './paths.ts';
import { firstRefusal } from './refusals.ts';
import { strings } from './strings.ts';

const NOBODY = 'nobody';

/** The one option standing for the listed people the reader can't list. */
const HIDDEN_NOTIFY = 'hidden-people';

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

/** The settings that apply when saved: the name, the address, the owner and who is emailed each submission. */
interface Applied {
  readonly name: string;
  readonly address: string;
  readonly owner: string;
  readonly notify: readonly string[];
}

/** Whether two lists name the same people, in any order (the picker answers its own order). */
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** The most people a form emails (the server's limit). */
const NOTIFY_MAX = 20;

/** Props for useFormSettings. */
export interface FormSettingsInput {
  readonly slug: string;
  readonly form: FormView;
  readonly onFormChange: (view: FormView) => void;
}

/** The fields useFormSettings checks and saves, as the server names a refusal's field. */
type SettingsField = 'name' | 'slug' | 'owner' | 'notifyMemberIds';

/**
 * The name, link, owner and who is emailed, as the Settings tab edits them. Each saves on its own, with no Save
 * button (the owner, 5 November 2026: one save model): the owner and the people emailed as they are picked, the name
 * and the link as their field is left. A name left empty or a link that can't be one says so then, never while it is
 * being typed, and nothing is sent. Held by the editor, so a tab change keeps what was typed.
 */
export function useFormSettings({ slug, form, onFormChange }: FormSettingsInput) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const saved: Applied = {
    name: form.name,
    address: form.publicKey,
    owner: form.ownerRotationId === undefined ? (form.ownerMemberId ?? NOBODY) : groupOption(form.ownerRotationId),
    notify: form.notifyMemberIds,
  };
  // Only the edits not yet saved are held, so a change made elsewhere (the first publish, a rename) shows at once.
  const [edits, setEdits] = useState<Partial<Applied>>({});
  const values: Applied = { ...saved, ...edits };
  const [failure, setFailure] = useState<{ readonly message: string; readonly field?: string } | undefined>(undefined);
  // What a field left in a state that can't be saved says, until it is typed into again.
  const [left, setLeft] = useState<{ readonly name?: string; readonly slug?: string }>({});
  // One save at a time, in the order they were made, so two quick picks never land out of order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const set = (patch: Partial<Applied>) => {
    setEdits((before) => ({ ...before, ...patch }));
    setFailure(undefined);
    setLeft((before) => ({
      ...(patch.name === undefined && before.name !== undefined ? { name: before.name } : {}),
      ...(patch.address === undefined && before.slug !== undefined ? { slug: before.slug } : {}),
    }));
  };

  /** Sends `patch` as it differs from what is saved; a pick that fails goes back, typed words stay with the error. */
  const send = (patch: Partial<Applied>, isPick: boolean) => {
    const change = {
      ...(patch.name === undefined || patch.name.trim() === saved.name ? {} : { name: patch.name.trim() }),
      ...(patch.address === undefined || (!isPick && patch.address === saved.address) ? {} : { slug: patch.address }),
      // A pick (and Undo) is always sent: compared with what this render saw as saved, a quick pick back to the first
      // value would be skipped while the pick before it was still on its way.
      ...(patch.owner === undefined || (!isPick && patch.owner === saved.owner) ? {} : ownerChange(patch.owner)),
      ...(patch.notify === undefined || (!isPick && sameList(patch.notify, saved.notify))
        ? {}
        : { notifyMemberIds: patch.notify }),
    };
    // What was sent leaves the edits once it is saved, unless it was changed again meanwhile.
    const settle = () => {
      setEdits((before) =>
        Object.fromEntries(Object.entries(before).filter(([key, value]) => patch[key as keyof Applied] !== value)),
      );
    };
    if (Object.keys(change).length === 0) {
      settle();
      return;
    }
    // The link it had, for the toast's Undo.
    const linkBefore = saved.address;
    queue.current = queue.current.then(() =>
      data.forms.updateSettings(slug, form.id, change).then(
        (view) => {
          onFormChange(view);
          settle();
          if ('slug' in change) {
            toasts.toast({
              tone: 'success',
              message: strings.addressChanged,
              action: {
                label: strings.undo,
                onAction: () => {
                  // Sent as a pick: this render's saved link is the one being put back.
                  send({ address: linkBefore }, true);
                },
              },
            });
          }
        },
        (error: unknown) => {
          const refusal = firstRefusal(error);
          if (isPick) settle();
          setFailure({ message: refusal.message, ...(refusal.field === undefined ? {} : { field: refusal.field }) });
        },
      ),
    );
  };

  /** The name field was left: saved, or, when empty, it says so and keeps what is saved. */
  const leaveName = () => {
    if (edits.name === undefined) return;
    if (edits.name.trim() === '') {
      setLeft((before) => ({ ...before, name: strings.nameRequired }));
      return;
    }
    send({ name: edits.name }, false);
  };

  /** The link field was left: saved when it can be a link, else it says what a link needs. */
  const leaveAddress = () => {
    if (edits.address === undefined) return;
    if (!FORM_SLUG.test(edits.address)) {
      setLeft((before) => ({ ...before, slug: strings.addressInvalid }));
      return;
    }
    send({ address: edits.address }, false);
  };

  /** An owner or the people emailed, picked: saved at once. */
  const pick = (patch: Pick<Partial<Applied>, 'owner' | 'notify'>) => {
    set(patch);
    send(patch, true);
  };

  const fieldError = (field: SettingsField): string | undefined => {
    if (field === 'name' && left.name !== undefined) return left.name;
    if (field === 'slug' && left.slug !== undefined) return left.slug;
    return failure !== undefined &&
      (failure.field === field ||
        (field === 'owner' && (failure.field === 'ownerMemberId' || failure.field === 'ownerRotationId')))
      ? failure.message
      : undefined;
  };
  return { values, set, leaveName, leaveAddress, pick, fieldError };
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
  /**
   * Points the draft at an object, or at none (keep submissions only); the editor saves first and takes the answer.
   * `withDeal` moves a Deals form to People with a deal.
   */
  readonly onRetarget: (objectId: string | null, withDeal?: boolean) => void;
  /** A change of where submissions go is on its way. */
  readonly isRetargeting: boolean;
  /** Opens or closes the form (Pause, Resume): what the header's menu does too, as a setting. */
  readonly onStatusChange: (status: 'live' | 'paused') => void;
  /**
   * A setting the form's version holds (Closes, the closed message, Email them a copy, Also create a deal), live at
   * once like every other row (forms fixes 2, one save model): `settings` is what the server sets, `change` the same
   * change on the document shown.
   */
  readonly onSettingsChange: (settings: LiveSettingsChange, change: (before: FormDocument) => FormDocument) => void;
  /** How many months the workspace keeps answers (null: kept); absent, the row isn't shown (critique b S2). */
  readonly keepMonths?: number | null;
}

/** A question as it is once no deal is made: an answer saved on the deal is kept with the submission instead. */
function offDeal(question: FormQuestion): FormQuestion {
  if (question.filedOn?.objectRole !== 'deal') return question;
  const { filedOn: _deal, ...rest } = question;
  return { ...rest, kept: true };
}

/** A typed number of answers, when it is a whole number from 1 to the limit. */
function countOf(text: string): number | undefined {
  const n = /^\d+$/.test(text.trim()) ? Number.parseInt(text.trim(), 10) : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= CLOSE_AFTER_MAX ? n : undefined;
}

/** What Closes › After a number of answers starts at. */
const DEFAULT_CLOSE_AFTER = 100;

/** A week from today, `YYYY-MM-DD`, where Closes › On a date starts. */
const nextWeek = () => {
  const at = new Date(Date.now() + 7 * 86_400_000);
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
};

/** The answers saved nowhere but the form's Submissions: Save answers to's first choice. */
const KEEP_ONLY = 'submissions-only';

/**
 * The Settings tab as plain rows (T21, 5 November 2026, "Settings doesn't feel like settings"; Linear's and Vercel's
 * settings, Tally's form settings): a label on the left, a compact control on the right, no card per section and no
 * subtitles; a word of help sits in an InfoTip beside its label, and a change is said in a toast. Only the form's own
 * settings live here: its name and link, who owns its records, who is emailed, where answers are saved, whether it
 * takes submissions, and spam. What a visitor meets (the words, what happens after they send) is on the Form tab.
 */
export function SettingsTab({
  slug,
  form,
  draft,
  target,
  objects,
  members,
  isReadOnly,
  settings,
  onRetarget,
  isRetargeting,
  onStatusChange,
  onSettingsChange,
  keepMonths,
}: SettingsTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const canChangeWorkspace = useCan('workspace.manage');
  const rotations = useCaptureList(data.rotations.view(slug));
  const rotationList = rotations.status === 'ready' ? rotations.items : [];

  // The owner of new records (AC-567): nobody, a teammate, or a round robin group (spec 0029, AC-755), the groups
  // the reader can see under their own heading. One the form names that the reader can't list stays shown, by name.
  const chosenGroupId = groupOf(settings.values.owner);
  const chosenGroup = rotationList.find((rotation) => rotation.id === chosenGroupId);
  // A teammate the form names who has left (late trap #88): shown as such, and the tip says their leads go unowned.
  const ownerLeft =
    chosenGroupId === undefined &&
    settings.values.owner !== NOBODY &&
    !members.some((member) => member.id === settings.values.owner);
  const takers = (rotation: (typeof rotationList)[number]) => rotation.members.filter((member) => member.isOn).length;
  const ownerItems = [
    { id: NOBODY, label: strings.nobody },
    ...members.map((member) => ({
      id: member.id,
      label: member.name,
      leading: <Avatar name={member.name} id={member.id} size="xs" isDecorative />,
    })),
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
  // Who is emailed each submission. Those the form lists whom the reader can't list stay chosen as one "other
  // people" option, so a save keeps them; read from what is saved, so unticking that option can be ticked again.
  const hiddenNotify = form.notifyMemberIds.filter((id) => !members.some((member) => member.id === id));
  const notifyValues = [
    ...settings.values.notify.filter((id) => !hiddenNotify.includes(id)),
    ...(hiddenNotify.some((id) => settings.values.notify.includes(id)) ? [HIDDEN_NOTIFY] : []),
  ];
  const isFull = settings.values.notify.length >= NOTIFY_MAX;
  const notifyItems = [
    ...members.map((member) => {
      const waits = isFull && !settings.values.notify.includes(member.id);
      return {
        id: member.id,
        label: member.name,
        description: waits ? strings.noticesFull : member.email,
        leading: <Avatar name={member.name} id={member.id} size="xs" isDecorative />,
        ...(waits ? { isDisabled: true } : {}),
      };
    }),
    ...(hiddenNotify.length === 0
      ? []
      : [
          {
            id: HIDDEN_NOTIFY,
            label: strings.noticesOthers(hiddenNotify.length),
            description: strings.noticesOthersHint,
          },
        ]),
  ];
  // What the owner row's tip says: who gets new records, or why nobody will. A problem is said under the control.
  const ownerProblem = ownerLeft
    ? strings.ownerLeftHint
    : rotations.status === 'error'
      ? strings.groupsFailed
      : chosenGroup !== undefined && takers(chosenGroup) === 0
        ? strings.groupNobodyOn(chosenGroup.name)
        : undefined;
  const ownerTip =
    chosenGroup !== undefined
      ? strings.groupHint(chosenGroup.name)
      : chosenGroupId !== undefined && rotations.status === 'ready'
        ? strings.groupHidden
        : strings.ownerHelpTip;
  const isPublished = form.liveVersionNumber !== undefined;
  const hasEmailQuestion = draft.questions.some((question) => question.answerType === 'email');
  const copyOn = draft.confirmation?.on === true;
  const closing = closingKind(draft.closing);
  const { timeZone } = useFormatSettings();
  const [closingError, setClosingError] = useState<string | undefined>(undefined);
  const [countText, setCountText] = useState<string | undefined>(undefined);
  // Words typed into a row that goes live, held until the field is left (as Name is), so a version isn't published
  // per keystroke.
  const [typed, setTyped] = useState<Partial<Record<'closedMessage' | 'subject' | 'line', string>>>({});
  const leaveText = (key: 'closedMessage' | 'subject' | 'line') => {
    const text = typed[key];
    setTyped(({ [key]: _left, ...rest }) => rest);
    if (text === undefined) return;
    if (key === 'closedMessage') {
      if (text.trim() === (draft.closedMessage ?? '')) return;
      onSettingsChange({ closedMessage: text.trim() === '' ? null : text }, (before) => {
        const { closedMessage: _was, ...rest } = before;
        return text.trim() === '' ? rest : { ...rest, closedMessage: text };
      });
      return;
    }
    if (text === (draft.confirmation?.[key] ?? '')) return;
    const next = { on: true, ...draft.confirmation, [key]: text };
    onSettingsChange({ confirmation: next }, (before) => ({ ...before, confirmation: next }));
  };
  const leaveCount = () => {
    if (countText === undefined) return;
    const n = countOf(countText);
    if (n === undefined) return;
    setCountText(undefined);
    if (n === draft.closing?.after) return;
    onSettingsChange({ closing: { after: n } }, (before) => ({ ...before, closing: { after: n } }));
  }; // Words still held when Settings closes (a shortcut, Back) are saved as if left, so nothing typed is lost.
  const leaveAll = useRef<() => void>(() => undefined);
  useEffect(() => {
    leaveAll.current = () => {
      leaveText('closedMessage');
      leaveText('subject');
      leaveText('line');
      leaveCount();
    };
  });
  useEffect(
    () => () => {
      leaveAll.current();
    },
    [],
  );

  const isFiling = draft.targets.main !== undefined && target.objectName !== undefined;
  const ownerIsTold =
    isFiling &&
    settings.values.owner !== NOBODY &&
    !ownerLeft &&
    !(chosenGroup !== undefined && takers(chosenGroup) === 0);
  // Save answers to: the objects a submission can add to, then Only in Submissions, apart. One control for what was a
  // switch and a picker.
  const writable = objects.filter((object) => !object.isArchived && object.access === 'write');
  const savingTo = draft.targets.main?.objectId ?? KEEP_ONLY;
  // Deals is a switch under People, not a place of its own (forms fix a3): saving to Deals made no person, so the
  // email went nowhere. A form already saving to Deals keeps it listed, so its choice still shows.
  const people = writable.find((object) => object.standardKey === 'people');
  const deals = writable.find((object) => object.standardKey === 'deals');
  const liveObjects = writable.filter((object) => people === undefined || object !== deals || object.id === savingTo);
  const offersDeal = people !== undefined && deals !== undefined && savingTo === people.id;
  const link = data.forms.hostedUrl(settings.values.address);
  const linkError = settings.fieldError('slug');
  const nameError = settings.fieldError('name');
  const ownerError = settings.fieldError('owner') ?? ownerProblem;
  const notifyError = settings.fieldError('notifyMemberIds');
  const tip = (label: string, text: string) => <InfoTip label={label}>{text}</InfoTip>;
  // Also create a deal, turned off (forms fixes 3): questions saved on the deal become Not filed, and turning it back
  // on doesn't save them there again, so no Undo could put them back. With any saved there it asks first (the house
  // rule: an ending action asks in a Modal unless Undo works); with none, it just turns off.
  const [isDealOffOpen, setDealOffOpen] = useState(false);
  const dealQuestions = draft.questions.filter((question) => question.filedOn?.objectRole === 'deal').length;
  const setDeal = (isOn: boolean) => {
    if (deals === undefined) return;
    onSettingsChange({ deal: isOn }, (before) => {
      const { deal: _deal, ...rest } = before.targets;
      if (isOn) return { ...before, targets: { ...rest, deal: { objectId: deals.id } } };
      // No deal, so nothing is saved on one: those answers stay with the submission.
      return { ...before, targets: rest, questions: before.questions.map(offDeal) };
    });
  };

  return (
    // As Settings › General: each group's rows in a Card under its heading, full width (the owner, 5 November 2026:
    // "group them properly").
    <SettingsStack>
      <SettingsSection title={strings.groupForm}>
        <Card>
          {isPublished && (
            <>
              <SettingsRow title={strings.name} control="field">
                <Field
                  label={strings.name}
                  isLabelHidden
                  value={settings.values.name}
                  maxLength={80}
                  isRequired
                  isReadOnly={isReadOnly}
                  onChange={(name) => {
                    settings.set({ name });
                  }}
                  onBlur={settings.leaveName}
                  // Enter saves it too, so a name typed and left by Esc or a shortcut isn't lost.
                  onSubmit={settings.leaveName}
                  {...(nameError === undefined ? {} : { error: nameError })}
                />
              </SettingsRow>
              <SettingsRow title={strings.address} meta={tip(strings.address, strings.linkHelp)} control="field">
                <Field
                  label={strings.address}
                  isLabelHidden
                  prefix={data.forms.hostedUrl('').replace(/^https?:\/\//, '')}
                  value={settings.values.address}
                  maxLength={40}
                  isRequired
                  isReadOnly={isReadOnly}
                  onChange={(text) => {
                    settings.set({ address: text.toLowerCase() });
                  }}
                  onBlur={settings.leaveAddress}
                  onSubmit={settings.leaveAddress}
                  {...(linkError === undefined ? {} : { error: linkError })}
                  // Beside the box on its line, at the field's own height: one control height on the row (lane 3c).
                  after={<CopyButton value={link} label={strings.copyLink} isIconOnly size="lg" />}
                />
              </SettingsRow>
            </>
          )}
          {isPublished && (
            <SettingsRow title={strings.acceptingRow} meta={tip(strings.acceptingRow, strings.acceptingHelp)}>
              <Switch
                label={strings.acceptingRow}
                isLabelHidden
                isSelected={form.status !== 'paused'}
                isReadOnly={isReadOnly}
                onChange={(isOn) => {
                  onStatusChange(isOn ? 'live' : 'paused');
                }}
              />
            </SettingsRow>
          )}
          {/* When it stops by itself (forms fix b2): never, on a day, or after a number of answers; and what it says. */}
          <SettingsRow title={strings.closesRow} meta={tip(strings.closesRow, strings.closesHelp)} control="field">
            <Select
              label={strings.closesRow}
              isLabelHidden
              savesOnPick
              items={[
                { id: 'never', label: strings.closesNever },
                { id: 'date', label: strings.closesOnDate },
                { id: 'count', label: strings.closesAfterCount },
              ]}
              value={closing}
              isReadOnly={isReadOnly}
              onChange={(id) => {
                if (id === null || id === closing) return;
                const kind = id as ClosingKind;
                const next =
                  kind === 'never'
                    ? undefined
                    : kind === 'date'
                      ? { at: closingOnDay(nextWeek(), timeZone) }
                      : { after: DEFAULT_CLOSE_AFTER };
                setCountText(undefined);
                onSettingsChange({ closing: next ?? null }, (before) => {
                  const { closing: _was, ...rest } = before;
                  return next === undefined ? rest : { ...rest, closing: next };
                });
              }}
            />
          </SettingsRow>
          {closing === 'date' && (
            <SettingsRow title={strings.closesDay} control="field">
              <DatePicker
                label={strings.closesDay}
                isLabelHidden
                value={dayOfClosing(draft.closing?.at, timeZone)}
                isReadOnly={isReadOnly}
                {...(closingError === undefined ? {} : { error: closingError })}
                onChange={(day) => {
                  if (day === null) return;
                  // A day already gone would close the form the moment it is published, without a word.
                  if (day < dayIn(Date.now(), timeZone)) {
                    setClosingError(strings.closesPast);
                    return;
                  }
                  setClosingError(undefined);
                  const at = { at: closingOnDay(day, timeZone) };
                  onSettingsChange({ closing: at }, (before) => ({ ...before, closing: at }));
                }}
              />
            </SettingsRow>
          )}
          {closing === 'count' && (
            <SettingsRow title={strings.closesCount} control="field">
              <Field
                label={strings.closesCount}
                isLabelHidden
                inputMode="numeric"
                value={countText ?? String(draft.closing?.after ?? DEFAULT_CLOSE_AFTER)}
                isReadOnly={isReadOnly}
                {...(closingError === undefined ? {} : { error: closingError })}
                // Typed freely (it can be emptied to type again), saved as it is left when a whole number from 1 to the
                // limit, as Name is: each keystroke going live would publish a version per digit.
                onChange={(text) => {
                  setCountText(text);
                  setClosingError(countOf(text) === undefined ? strings.closesCountError(CLOSE_AFTER_MAX) : undefined);
                }}
                onBlur={leaveCount}
                onSubmit={leaveCount}
              />
            </SettingsRow>
          )}
          <SettingsRow title={strings.closedMessageRow} control="field">
            <Field
              label={strings.closedMessageRow}
              isLabelHidden
              value={typed.closedMessage ?? draft.closedMessage ?? ''}
              placeholder={strings.closedMessageDefault}
              maxLength={CLOSED_MESSAGE_MAX}
              isReadOnly={isReadOnly}
              onChange={(text) => {
                setTyped((before) => ({ ...before, closedMessage: text }));
              }}
              onBlur={() => {
                leaveText('closedMessage');
              }}
              onSubmit={() => {
                leaveText('closedMessage');
              }}
            />
          </SettingsRow>
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.groupCrm}>
        <Card>
          <SettingsRow
            title={strings.saveAnswersTo}
            meta={tip(strings.saveAnswersTo, strings.savingHelpTip)}
            control="field"
          >
            <Select
              label={strings.saveAnswersTo}
              isLabelHidden
              savesOnPick
              items={[
                ...liveObjects.map((object) => ({ id: object.id, label: object.pluralName, icon: object.icon })),
                { id: KEEP_ONLY, label: strings.onlySubmissions, isApart: liveObjects.length > 0 },
              ]}
              value={savingTo}
              isReadOnly={isReadOnly}
              isDisabled={isRetargeting}
              onChange={(id) => {
                if (id === null || id === savingTo) return;
                onRetarget(id === KEEP_ONLY ? null : id);
              }}
            />
          </SettingsRow>
          {/* A form already saving to Deals saves no person: one press moves it to People, with a deal (forms fix a3). */}
          {people !== undefined && deals !== undefined && savingTo === deals.id && (
            <SettingsRow title={strings.dealsNoPerson} meta={tip(strings.dealsNoPerson, strings.dealsNoPersonTip)}>
              <Button
                isDisabled={isRetargeting || isReadOnly}
                onPress={() => {
                  onRetarget(people.id, true);
                }}
              >
                {strings.dealsMove}
              </Button>
            </SettingsRow>
          )}
          {offersDeal && (
            <SettingsRow title={strings.alsoDeal} meta={tip(strings.alsoDeal, strings.alsoDealTip)}>
              <Switch
                label={strings.alsoDeal}
                isLabelHidden
                isSelected={draft.targets.deal !== undefined}
                isReadOnly={isReadOnly}
                onChange={(isOn) => {
                  if (!isOn && dealQuestions > 0) {
                    setDealOffOpen(true);
                    return;
                  }
                  setDeal(isOn);
                }}
              />
            </SettingsRow>
          )}
          <Modal
            title={strings.dealOffTitle}
            variant="confirm"
            tone="danger"
            isOpen={isDealOffOpen}
            onOpenChange={setDealOffOpen}
            actions={
              <>
                <Button slot="close">{strings.cancel}</Button>
                <Button
                  variant="danger-solid"
                  onPress={() => {
                    setDealOffOpen(false);
                    setDeal(false);
                  }}
                >
                  {strings.dealOffAction}
                </Button>
              </>
            }
          >
            <p>{strings.dealOffText(dealQuestions)}</p>
          </Modal>
          {/* Only a form that adds submissions to the CRM makes records for someone to own. */}
          {isFiling && (
            <SettingsRow title={strings.owner} meta={tip(strings.owner, ownerTip)} control="field">
              <Select
                label={strings.owner}
                isLabelHidden
                items={ownerItems}
                value={settings.values.owner}
                isReadOnly={isReadOnly}
                {...(ownerError === undefined ? {} : { error: ownerError })}
                onChange={(id) => {
                  settings.pick({ owner: id ?? NOBODY });
                }}
              />
            </SettingsRow>
          )}
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.groupEmails}>
        <Card>
          <SettingsRow
            title={strings.emailEach}
            meta={tip(strings.emailEach, strings.noticesHint(ownerIsTold))}
            control="field"
          >
            <Select
              label={strings.emailEach}
              isLabelHidden
              selectionMode="multiple"
              placeholder={ownerIsTold ? strings.noticesNobody : strings.nobody}
              items={notifyItems}
              values={notifyValues}
              isSearchable={members.length > 8}
              searchLabel={strings.noticesSearch}
              isReadOnly={isReadOnly}
              {...(notifyError === undefined ? {} : { error: notifyError })}
              onValuesChange={(ids) => {
                settings.pick({
                  notify: [
                    ...ids.filter((id) => id !== HIDDEN_NOTIFY),
                    ...(ids.includes(HIDDEN_NOTIFY) ? hiddenNotify : []),
                  ],
                });
              }}
            />
          </SettingsRow>
          {/* The visitor's own copy (spec 0063, AC-6318; forms fix b1): built on the server, never offered here before. */}
          <SettingsRow
            title={strings.copyRow}
            meta={tip(strings.copyRow, strings.copyHelp)}
            // Its reason in view, not only on hover, when there is nowhere to send a copy.
            {...(hasEmailQuestion ? {} : { description: strings.copyNeedsEmail })}
          >
            <Switch
              label={strings.copyRow}
              isLabelHidden
              isSelected={copyOn}
              isReadOnly={isReadOnly}
              isDisabled={!hasEmailQuestion && !copyOn}
              onChange={(isOn) => {
                const next = { ...draft.confirmation, on: isOn };
                onSettingsChange({ confirmation: next }, (before) => ({ ...before, confirmation: next }));
              }}
            />
          </SettingsRow>
          {copyOn && (
            <>
              <SettingsRow title={strings.copySubject} control="field">
                <Field
                  label={strings.copySubject}
                  isLabelHidden
                  value={typed.subject ?? draft.confirmation?.subject ?? ''}
                  placeholder={strings.copySubjectDefault}
                  maxLength={CONFIRMATION_SUBJECT_MAX}
                  isReadOnly={isReadOnly}
                  onChange={(subject) => {
                    setTyped((before) => ({ ...before, subject }));
                  }}
                  onBlur={() => {
                    leaveText('subject');
                  }}
                  onSubmit={() => {
                    leaveText('subject');
                  }}
                />
              </SettingsRow>
              <SettingsRow title={strings.copyLine} control="field">
                <Field
                  label={strings.copyLine}
                  isLabelHidden
                  value={typed.line ?? draft.confirmation?.line ?? ''}
                  placeholder={strings.copyLineDefault}
                  maxLength={CONFIRMATION_LINE_MAX}
                  isWrapping
                  isReadOnly={isReadOnly}
                  onChange={(line) => {
                    setTyped((before) => ({ ...before, line }));
                  }}
                  onBlur={() => {
                    leaveText('line');
                  }}
                />
              </SettingsRow>
            </>
          )}
        </Card>
      </SettingsSection>
      <SettingsSection title={strings.groupAnswers}>
        <Card>
          {/* How long answers are kept is the workspace's (Settings › General); the form says it, and where to change it. */}
          {/* The workspace's own setting, under its own name, as a field height Select (lane 3c): it was a 26px
            button off to Settings › General among field height controls. */}
          {keepMonths !== undefined && (
            <KeepSubmissionsRow
              data={data}
              slug={slug}
              months={keepMonths}
              canChange={canChangeWorkspace && !isReadOnly}
              onSaved={(message, undo) => {
                toasts.toast({ tone: 'success', message, action: { label: strings.undo, onAction: undo } });
              }}
              onFailed={(message) => {
                toasts.toast({ tone: 'danger', message });
              }}
            />
          )}
          {isPublished && (
            // Review opens where something waits: Needs review first, else Spam; with neither, it says so instead of
            // opening an empty list (forms fixes 2).
            <SettingsRow
              title={strings.spamRow}
              meta={tip(strings.spamRow, strings.spamSummary)}
              {...(form.reviewCount === undefined && form.spamCount === 0 ? { description: strings.spamNone } : {})}
            >
              {/* Review opens where something waits; with nothing caught, View spam still opens the filter, so where
                spam goes is never a guess (lane 3c). At the field's height, as every control here. */}
              <ButtonLink
                href={`${formHref(slug, form.id, 'submissions')}&state=${form.reviewCount === undefined ? 'spam' : 'needs_review'}`}
                variant="secondary"
                size="lg"
              >
                {form.reviewCount !== undefined || form.spamCount > 0 ? strings.spamReview : strings.spamView}
              </ButtonLink>
            </SettingsRow>
          )}
        </Card>
      </SettingsSection>
    </SettingsStack>
  );
}
