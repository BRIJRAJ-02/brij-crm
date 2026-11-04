// Brief
// Purpose: a form's Settings tab (spec 0023; T21, 5 November 2026): the form's own settings as plain rows: name, link,
// where answers are saved, the owner of new records, who is emailed, whether it takes submissions, and spam.
// Main task: scan the rows and change only what needs changing (the defaults already work). Nothing here has a Save:
// each row saves itself (where answers are saved goes live with the header's one Publish).
// Leaves out: everything a visitor meets (the words, what happens after they send, the look), on the Form tab beside
// the preview; each question's filing (set on the question).
import type { FormDocument, FormTargetChoices, FormView, MemberSummary, ObjectSummary } from '@crm/data';
import { FORM_SLUG } from '@crm/data/forms';
import { useCaptureList } from '@crm/data/react';
import { Avatar, ButtonLink, CopyButton, Field, InfoTip, Select, SettingsRow, SettingsStack, Switch } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useRef, useState } from 'react';
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
  /** Points the draft at an object, or at none (keep submissions only); the editor saves first and takes the answer. */
  readonly onRetarget: (objectId: string | null) => void;
  /** A change of where submissions go is on its way. */
  readonly isRetargeting: boolean;
  /** Opens or closes the form (Pause, Resume): what the header's menu does too, as a setting. */
  readonly onStatusChange: (status: 'live' | 'paused') => void;
}

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
}: SettingsTabProps) {
  const { data } = useRouteContext({ from: '__root__' });
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
  const isFiling = draft.targets.main !== undefined && target.objectName !== undefined;
  const ownerIsTold =
    isFiling &&
    settings.values.owner !== NOBODY &&
    !ownerLeft &&
    !(chosenGroup !== undefined && takers(chosenGroup) === 0);
  // Save answers to: the objects a submission can add to, then Only in Submissions, apart. One control for what was a
  // switch and a picker.
  const liveObjects = objects.filter((object) => !object.isArchived && object.access === 'write');
  const savingTo = draft.targets.main?.objectId ?? KEEP_ONLY;
  const link = data.forms.hostedUrl(settings.values.address);
  const linkError = settings.fieldError('slug');
  const nameError = settings.fieldError('name');
  const ownerError = settings.fieldError('owner') ?? ownerProblem;
  const notifyError = settings.fieldError('notifyMemberIds');
  const tip = (label: string, text: string) => <InfoTip label={label}>{text}</InfoTip>;

  return (
    <SettingsStack>
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
            />
            <CopyButton value={link} label={strings.copyLink} isIconOnly />
          </SettingsRow>
        </>
      )}
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
      {isPublished && (
        <SettingsRow title={strings.spamRow} meta={tip(strings.spamRow, strings.spamSummary)}>
          <ButtonLink href={`${formHref(slug, form.id, 'submissions')}&state=needs_review`} variant="secondary">
            {strings.spamReview}
          </ButtonLink>
        </SettingsRow>
      )}
    </SettingsStack>
  );
}
