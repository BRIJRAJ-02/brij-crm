// Emails about a member's own background work: an import's result (#30), and
// any other job of theirs that failed (late trap #20). A mention has no email of its own: it goes in the
// notifications email (spec 0038), the one email a mention sends.
import type {
  EditorAddedEmail,
  ImportFinishedEmail,
  JobFailedEmail,
  SchedulingAccessGivenEmail,
  SchedulingAccessRemovedEmail,
  SchedulingChangedEmail,
  StandinCoveringEmail,
} from '@crm/contracts/emails';
import { formatMoment, plural } from '../format.ts';

/** A count as the app writes it (1,204). */
const number = (count: number): string => new Intl.NumberFormat('en-GB').format(count);
import { workspaceOf, type Template } from '../template.ts';

/** An import's ending, in a heading's words. */
const ENDINGS: Readonly<Record<ImportFinishedEmail['outcome'], string>> = {
  done: 'Import finished',
  failed: 'Import failed',
  cancelled: 'Import cancelled',
};

/** An import a member started has finished. */
export const importFinished: Template<ImportFinishedEmail> = (params, context) => {
  const file = params.fileName ?? 'your file';
  const what =
    params.outcome === 'done'
      ? `Timefix finished importing ${file} into ${params.objectName}.`
      : params.outcome === 'failed'
        ? `Timefix couldn’t finish importing ${file} into ${params.objectName}. The rows it imported before it stopped are kept. Open the import to see what’s left, and import the rest again or undo it.`
        : `The import of ${file} into ${params.objectName} was cancelled. What it did before it stopped is kept.`;
  const counts = `${plural(params.created, 'record', 'records')} created, ${number(params.updated)} updated, ${number(params.skipped)} skipped`;
  // A finished import that left rows out says so up front, so the reader knows to open it.
  const ending =
    params.outcome === 'done' && params.failed > 0
      ? `Import finished, ${plural(params.failed, 'row', 'rows')} not imported`
      : ENDINGS[params.outcome];
  return {
    subject: `${ending}: ${params.objectName}`,
    preheader: `${counts}.`,
    eyebrow: workspaceOf(context),
    heading: ending,
    blocks: [
      { type: 'paragraph', text: what },
      {
        type: 'rows',
        layout: 'compact',
        rows: [
          { label: 'Created', value: number(params.created) },
          { label: 'Updated', value: number(params.updated) },
          { label: 'Skipped', value: number(params.skipped) },
          ...(params.failed === 0 ? [] : [{ label: 'Not imported', value: number(params.failed) }]),
        ],
      },
      { type: 'button', label: 'View import', url: context.link(params.resultPath) },
    ],
    why: `You got this email because you started this import in ${workspaceOf(context)}.`,
  };
};

/** How far a failed job got, in a sentence, so the reader knows how much to check (the reason says what is kept). */
function progressText(progress: JobFailedEmail['progress']): string | undefined {
  if (progress === undefined) return undefined;
  if (progress.done === 0) return 'It stopped before it changed anything.';
  const of = progress.total === undefined ? '' : ` of ${number(progress.total)}`;
  return `It got through ${number(progress.done)}${of} before it stopped.`;
}

/** A background job a member started ended `failed`: which, when they started it, how far it got, why, and where their jobs are. */
export const jobFailed: Template<JobFailedEmail> = (params, context) => {
  const progress = progressText(params.progress);
  return {
    // "Didn't finish" reads with any job's name, a long one ("Hand on a removed member's work") included.
    subject: `Didn’t finish: ${params.jobLabel}`,
    preheader: params.reason,
    eyebrow: workspaceOf(context),
    heading: `Didn’t finish: ${params.jobLabel}`,
    blocks: [
      { type: 'paragraph', text: params.reason },
      ...(progress === undefined ? [] : [{ type: 'paragraph' as const, text: progress }]),
      ...(params.startedAt === undefined
        ? []
        : [
            {
              type: 'rows' as const,
              layout: 'compact' as const,
              rows: [{ label: 'Started', value: formatMoment(params.startedAt, params.timeZone) }],
            },
          ]),
      { type: 'button', label: 'Open Background jobs', url: context.link(params.jobsPath) },
    ],
    why: `You got this email because you started this job in ${workspaceOf(context)}.`,
  };
};

/**
 * Someone else changed the reader's scheduling (spec 0037, AC-1264): ten minutes of one person's changes, a line
 * each, and the way to their hours.
 */
export const schedulingChanged: Template<SchedulingChangedEmail> = (params, context) => {
  const subject = `${params.actorName} changed your scheduling`;
  const count = params.lines.length + params.more;
  return {
    subject,
    preheader: `${plural(count, 'change', 'changes')} to your scheduling in ${workspaceOf(context)}.`,
    eyebrow: workspaceOf(context),
    heading: subject,
    blocks: [
      {
        type: 'paragraph',
        text: `${params.actorName} changed your scheduling in ${workspaceOf(context)}. Here is what is different now.`,
      },
      ...params.lines.map((line) => ({ type: 'paragraph' as const, text: line })),
      ...(params.more === 0
        ? []
        : [{ type: 'paragraph' as const, text: `And ${plural(params.more, 'more change', 'more changes')}.` }]),
      { type: 'button', label: 'See your hours', url: context.link(params.availabilityPath) },
    ],
    why: `You got this email because ${params.actorName} can manage your scheduling in ${workspaceOf(context)}.`,
  };
};

/** Covering for someone (spec 0037, AC-1282): to a stand in, "You're covering for Sam from 3 to 7 November." */
export const standinCovering: Template<StandinCoveringEmail> = (params, context) => {
  const subject = `You’re covering for ${params.memberName} ${params.dates}`;
  return {
    subject,
    preheader: `${params.memberName} is away ${params.dates}. People who would book them may come to you.`,
    eyebrow: workspaceOf(context),
    heading: `You’re covering for ${params.memberName}`,
    blocks: [
      {
        type: 'paragraph',
        text: `You’re covering for ${params.memberName} ${params.dates}. While they’re away, people who usually meet them may be booked with you.`,
      },
      { type: 'button', label: 'See your bookings', url: context.link(params.bookingsPath) },
    ],
    why: `You got this email because ${params.memberName} named you as their stand in in ${workspaceOf(context)}.`,
  };
};

/** A level as its verb. */
const verbOf = (level: 'view' | 'manage') => (level === 'manage' ? 'manage' : 'see');

/**
 * Scheduling access given (spec 0037, AC-1257): "You can now manage Ada Lovelace’s scheduling" to the delegate, and
 * "Priya Shah can now manage your scheduling" to the member when someone else granted it.
 */
export const schedulingAccessGiven: Template<SchedulingAccessGivenEmail> = (params, context) => {
  const verb = verbOf(params.level);
  const toMember = params.to === 'member';
  const subject = toMember
    ? `${params.otherName} can now ${verb} your scheduling`
    : `You can now ${verb} ${params.everyone ? 'everyone’s' : `${params.otherName}’s`} scheduling`;
  const what =
    params.level === 'manage'
      ? toMember
        ? 'They can change your hours, time off and bookings. You’re told when they do.'
        : 'You can change their hours, time off and bookings.'
      : toMember
        ? 'They can see your hours, time off and bookings.'
        : 'You can see their hours, time off and bookings.';
  const by = !toMember && params.byName !== undefined ? ` ${params.byName} gave you this access.` : '';
  return {
    subject,
    preheader: what,
    eyebrow: workspaceOf(context),
    heading: subject,
    blocks: [
      { type: 'paragraph', text: `${what}${by}` },
      { type: 'button', label: toMember ? 'See who has access' : 'Open Availability', url: context.link(params.path) },
    ],
    why: toMember
      ? `You got this email because someone changed who can see your scheduling in ${workspaceOf(context)}.`
      : `You got this email because you were given access to scheduling in ${workspaceOf(context)}.`,
  };
};

/** Scheduling access removed (spec 0037): "You can no longer see Ada Lovelace’s scheduling", to the delegate. */
export const schedulingAccessRemoved: Template<SchedulingAccessRemovedEmail> = (params, context) => {
  const whose = params.memberName === undefined ? 'everyone’s' : `${params.memberName}’s`;
  const subject = `You can no longer ${verbOf(params.level)} ${whose} scheduling`;
  return {
    subject,
    preheader: `${params.byName} took this access back.`,
    eyebrow: workspaceOf(context),
    heading: subject,
    blocks: [{ type: 'paragraph', text: `${params.byName} took this access back in ${workspaceOf(context)}.` }],
    why: `You got this email because your access to scheduling in ${workspaceOf(context)} changed.`,
  };
};

/**
 * Editor added or removed (spec 0037, AC-1331): "You can now edit Intro call" to the member someone else made an
 * editor, and "You can no longer edit Intro call" to one they took off.
 */
export const editorAdded: Template<EditorAddedEmail> = (params, context) => {
  const isRotation = params.resourceType === 'rotation';
  const kind = isRotation ? 'round robin group' : 'booking page';
  const removed = params.removed === true;
  const subject = removed ? `You can no longer edit ${params.resourceName}` : `You can now edit ${params.resourceName}`;
  const what = removed
    ? `${params.byName} took you off the editors of the ${params.resourceName} ${kind}.`
    : `${params.byName} made you an editor of the ${params.resourceName} ${kind}.`;
  return {
    subject,
    preheader: what,
    eyebrow: workspaceOf(context),
    heading: subject,
    blocks: [
      { type: 'paragraph', text: what },
      ...(removed
        ? []
        : [
            {
              type: 'button' as const,
              label: isRotation ? 'Open Round robin' : 'Open the page',
              url: context.link(params.path),
            },
          ]),
    ],
    why: `You got this email because who edits a ${kind} changed in ${workspaceOf(context)}.`,
  };
};
