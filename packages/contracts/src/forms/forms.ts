// Forms for members (spec 0023, 0023-experience.md): the forms list as cards,
// the editor's draft, publish and settings, and reading and acting on
// submissions. Every change needs `forms.manage`; every procedure takes
// `WorkspaceScoped` input and is served behind the member door.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ANSWER_TYPES, FORM_SLUG } from './answer-types.ts';
import { AttributeType, Timestamp } from '../values/attribute-values.ts';
import { RecordRefDisplay } from '../values/options.ts';
import { WorkspaceScoped } from '../workspaces.ts';
import { FormDocument } from './document.ts';
import { PublicForm } from './public.ts';
import { Uuid, uuidV7 } from '../values/ids.ts';

/** Where a form is (spec 0023, state transitions): `live` is accepting enquiries, `paused` not. */
export const FormStatus = z.enum(['draft', 'live', 'paused', 'archived']);
/** Where a form is. */
export type FormStatus = z.infer<typeof FormStatus>;

/** A form's name, as members see it. */
export const FormName = z
  .string()
  .trim()
  .min(1, { error: 'Give the form a name.' })
  .max(80, { error: 'Keep the name to 80 characters.' });

/** A form's public address, the part after `/f/`. */
export const FormSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(FORM_SLUG, { error: 'The address needs 2 to 40 lowercase letters, numbers or hyphens.' });

/** A site that may post to the form ("Your own form"): an origin, `https://acme.com`. */
export const FormOrigin = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .transform((value, context) => {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//.test(value) ? value : `https://${value}`;
    try {
      const url = new URL(candidate);
      if (!url.hostname.includes('.') && url.hostname !== 'localhost') throw new Error('no host');
      return `${url.protocol}//${url.host}`;
    } catch {
      context.addIssue({ code: 'custom', message: `“${value}” isn’t a web address, such as acme.com.` });
      return z.NEVER;
    }
  });

/** A form card in the list (spec 0023, The forms list). */
export const FormSummary = z.object({
  id: Uuid,
  name: z.string(),
  status: FormStatus,
  /** The object each submission adds or updates (the draft's). Absent: the form keeps its submissions only. */
  mainObjectId: Uuid.optional(),
  /** The public address, after `/f/`. */
  publicKey: z.string(),
  liveVersionNumber: z.number().int().min(1).optional(),
  /** Stored submissions this calendar month (UTC), spam left out. */
  submissionsThisMonth: z.number().int().min(0),
  /** Spam waiting in the form, shown only when there is some. */
  spamCount: z.number().int().min(0),
  lastSubmissionAt: Timestamp.optional(),
  /** Every stored submission, counted up to `FORM_COUNT_CAP`. */
  submissionCount: z.number().int().min(0),
  updatedAt: Timestamp,
});
/** A form card in the list. */
export type FormSummary = z.infer<typeof FormSummary>;

/** The most submissions a count reads before it stops. */
export const FORM_COUNT_CAP = 10_000;

/** How many of a form's first questions (the email aside) a submission's list row carries answers for. */
export const SUBMISSION_SUMMARY_QUESTIONS = 3;

/**
 * One form with its draft and live documents, its settings that apply at
 * once (owner, address, the sites that may post), and whether the reader
 * holds `forms.manage`.
 */
export const FormView = FormSummary.extend({
  draftNumber: z.number().int().min(1),
  /** Moves on every change: a save names the one it started from (409 `FORM_CHANGED` otherwise). */
  revision: z.number().int().min(1),
  draft: FormDocument,
  live: FormDocument.optional(),
  /** Whether the draft differs from what is live (a publish would change something). */
  hasUnpublished: z.boolean(),
  ownerMemberId: Uuid.optional(),
  /** Who saved the draft last, when someone else may have (the "Bea changed this form" notice). */
  draftSavedByMemberId: Uuid.optional(),
  allowedOrigins: z.array(z.string()),
  requireSignature: z.boolean(),
  /** The secret a site signs its posts with: only for `forms.manage`. */
  signingSecret: z.string().optional(),
  canManage: z.boolean(),
  createdAt: Timestamp,
});
/** One form. */
export type FormView = z.infer<typeof FormView>;

/**
 * A new form (AC-649): "Untitled form" with Name, Email and Phone on People,
 * unless named. `mainObjectId` picks another object, and `null` keeps its
 * submissions only, adding nothing to the CRM.
 */
export const CreateFormInput = WorkspaceScoped.extend({
  id: uuidV7('The form id must be a UUID v7.'),
  name: FormName.optional(),
  mainObjectId: Uuid.nullable().optional(),
  mutationId: Uuid,
});
/** A new form. */
export type CreateFormInput = z.infer<typeof CreateFormInput>;

/** Saves the draft, quietly (a second after the last change). A stale `expectedRevision` is 409 `FORM_CHANGED`. */
export const SaveFormDraftInput = WorkspaceScoped.extend({
  formId: Uuid,
  document: FormDocument,
  expectedRevision: z.number().int().min(1),
  mutationId: Uuid,
});
/** Saves the draft. */
export type SaveFormDraftInput = z.infer<typeof SaveFormDraftInput>;

/** Publishes the draft as the next live version (AC-548); the first publish names the form and its address. */
export const PublishFormInput = WorkspaceScoped.extend({
  formId: Uuid,
  expectedRevision: z.number().int().min(1),
  name: FormName.optional(),
  slug: FormSlug.optional(),
  mutationId: Uuid,
});
/** Publishes the draft. */
export type PublishFormInput = z.infer<typeof PublishFormInput>;

/** The settings that apply at once: the name, the address, the owner, and the sites that may post. */
export const UpdateFormSettingsInput = WorkspaceScoped.extend({
  formId: Uuid,
  name: FormName.optional(),
  slug: FormSlug.optional(),
  /** `null` is nobody. */
  ownerMemberId: Uuid.nullable().optional(),
  allowedOrigins: z.array(FormOrigin).max(20, { error: 'List at most 20 sites.' }).optional(),
  requireSignature: z.boolean().optional(),
  mutationId: Uuid,
});
/** The settings that apply at once. */
export type UpdateFormSettingsInput = z.infer<typeof UpdateFormSettingsInput>;

/** Moves a form between live and paused (Accepting), archived, and back (AC-549). */
export const SetFormStatusInput = WorkspaceScoped.extend({
  formId: Uuid,
  status: FormStatus,
  mutationId: Uuid,
});
/** Moves a form between statuses. */
export type SetFormStatusInput = z.infer<typeof SetFormStatusInput>;

/**
 * Points a form's draft at another object, its questions' filing cleared
 * where it no longer fits, or at none (`null`: keep submissions only, every
 * filing cleared). On a published form it goes live with the next publish.
 */
export const SetFormTargetInput = WorkspaceScoped.extend({
  formId: Uuid,
  mainObjectId: Uuid.nullable(),
  expectedRevision: z.number().int().min(1),
  mutationId: Uuid,
});
/** Points a form's draft at another object, or at none. */
export type SetFormTargetInput = z.infer<typeof SetFormTargetInput>;

/** One form by id. */
export const FormIdInput = WorkspaceScoped.extend({ formId: Uuid });
/** One form by id. */
export type FormIdInput = z.infer<typeof FormIdInput>;

/** A change that names one form and nothing else (delete). */
export const FormWriteInput = FormIdInput.extend({ mutationId: Uuid });
/** A change that names one form. */
export type FormWriteInput = z.infer<typeof FormWriteInput>;

/** A copy of a form's draft, as a new never published form with its own address. */
export const DuplicateFormInput = FormIdInput.extend({
  id: uuidV7('The form id must be a UUID v7.'),
  mutationId: Uuid,
});
/** A copy of a form's draft. */
export type DuplicateFormInput = z.infer<typeof DuplicateFormInput>;

/** Whether an address is free (the first publish checks as typed). */
export const SlugInput = WorkspaceScoped.extend({ formId: Uuid, slug: z.string().max(60) });
/** Whether an address is free. */
export type SlugInput = z.infer<typeof SlugInput>;

/** The forms list: the active ones, or the archived ones. */
export const ListFormsInput = WorkspaceScoped.extend({
  archived: z.boolean().default(false),
});
/** The forms list. */
export type ListFormsInput = z.input<typeof ListFormsInput>;

/** The most forms one list answers. */
export const FORMS_LIST_MAX = 200;

/**
 * An attribute a question may be filed on (Where it goes, AC-658): the
 * target object's live, non system attributes, with whether the reader may
 * write each. The builder offers those whose type fits the answer type.
 */
export const FormAttributeChoice = z.object({
  attributeId: Uuid,
  title: z.string(),
  type: AttributeType,
  isRequired: z.boolean(),
  isUnique: z.boolean(),
  canWrite: z.boolean(),
});
/** An attribute a question may be filed on. */
export type FormAttributeChoice = z.infer<typeof FormAttributeChoice>;

/** The target object and the attributes a question may be filed on; no object and no items while the draft keeps submissions only. */
export const FormTargetChoices = z.object({
  objectId: Uuid.optional(),
  objectName: z.string().optional(),
  items: z.array(FormAttributeChoice),
});
/** The target object and its attributes. */
export type FormTargetChoices = z.infer<typeof FormTargetChoices>;

/** Where a submission is (spec 0023, state transitions). */
export const SubmissionState = z.enum([
  'received',
  'processing',
  'processed',
  'spam',
  'held',
  'needs_review',
  'failed',
]);
/** Where a submission is. */
export type SubmissionState = z.infer<typeof SubmissionState>;

/** What a submission did to a record, and the record's role in it (AC-561). */
export const SubmissionRecord = z.object({
  role: z.enum(['main', 'person', 'company', 'deal', 'entry']),
  action: z.enum(['created', 'updated', 'matched', 'linked']),
  record: RecordRefDisplay,
});
/** What a submission did to a record. */
export type SubmissionRecord = z.infer<typeof SubmissionRecord>;

/** One answer as members read it: its question's label and type, the value, and whether it was filed. */
export const SubmissionAnswer = z.object({
  questionId: z.string(),
  key: z.string(),
  label: z.string(),
  answerType: z.enum(ANSWER_TYPES),
  /** The attribute it was filed on, when it was. */
  attributeId: Uuid.optional(),
  /** Text, `true` or `false`, or a phone's `{ number, country }`. */
  value: z.unknown(),
});
/** One answer as members read it. */
export type SubmissionAnswer = z.infer<typeof SubmissionAnswer>;

/**
 * A submission's link to the CRM: `linked` to a record the reader can see;
 * `filing` while a job is turning it into records (received, processing);
 * `not_in_crm` otherwise (failed, never filed, spam, review, held, or its
 * record is in the trash). `canAddToCrm` says whether Add to CRM takes it.
 */
export const SubmissionCrm = z.discriminatedUnion('state', [
  z.object({ state: z.literal('linked'), record: RecordRefDisplay }),
  z.object({ state: z.literal('filing') }),
  z.object({ state: z.literal('not_in_crm'), canAddToCrm: z.boolean() }),
]);
/** A submission's link to the CRM. */
export type SubmissionCrm = z.infer<typeof SubmissionCrm>;

/** A submission in its form's list: when, where it is, the person, the email, and its first two answers. */
export const SubmissionSummary = z.object({
  id: Uuid,
  formId: Uuid,
  state: SubmissionState,
  receivedAt: Timestamp,
  processedAt: Timestamp.optional(),
  /**
   * The bot checks' verdict: `unchecked` when reCAPTCHA is on and couldn't be
   * asked; `review` when the content looked doubtful, so it waits in Needs
   * review for a member to say spam or not (`submissions.resolve`).
   */
  verdict: z.enum(['passed', 'spam', 'unchecked', 'review']),
  mainRecord: RecordRefDisplay.optional(),
  /** The email answer, shown until the person exists. */
  email: z.string().optional(),
  /**
   * The answers to the form's first three questions other than the email (those the reader may see and the
   * visitor answered), so a list's columns line up: the name, then two more.
   */
  firstAnswers: z.array(SubmissionAnswer).max(SUBMISSION_SUMMARY_QUESTIONS),
  /** Its link to the CRM: "Not in CRM", filing, or the record it filed into. */
  crm: SubmissionCrm,
});
/** A submission in its form's list. */
export type SubmissionSummary = z.infer<typeof SubmissionSummary>;

/**
 * One submission in full: its answers in the form's question order (those
 * filed on attributes the reader can't see absent, AC-573), where it came
 * from, the bot signals, the records it touched, and why it failed or what
 * was refused.
 */
export const SubmissionView = SubmissionSummary.extend({
  versionNumber: z.number().int().min(1),
  answers: z.array(SubmissionAnswer),
  hidden: z.record(z.string(), z.string()),
  signals: z.array(z.string()),
  records: z.array(SubmissionRecord),
  failure: z.string().optional(),
  refused: z.array(z.object({ questionId: z.string(), message: z.string() })),
  assignment: z.object({ memberId: Uuid.optional(), reason: z.string() }).optional(),
});
/** One submission in full. */
export type SubmissionView = z.infer<typeof SubmissionView>;

/** The most submissions one page holds. */
export const SUBMISSIONS_PAGE = 50;

/** A page of a form's submissions, newest first, optionally one state (AC-572). */
export const ListSubmissionsInput = WorkspaceScoped.extend({
  formId: Uuid,
  state: SubmissionState.optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(SUBMISSIONS_PAGE).optional(),
});
/** A page of a form's submissions. */
export type ListSubmissionsInput = z.infer<typeof ListSubmissionsInput>;

/** A page of submissions and the cursor for the next. */
export const SubmissionPage = z.object({
  items: z.array(SubmissionSummary),
  nextCursor: z.string().optional(),
});
/** A page of submissions. */
export type SubmissionPage = z.infer<typeof SubmissionPage>;

/** One submission by id. */
export const SubmissionIdInput = WorkspaceScoped.extend({ submissionId: Uuid });
/** One submission by id. */
export type SubmissionIdInput = z.infer<typeof SubmissionIdInput>;

/** A change to one submission (release, mark as spam, retry, delete). */
export const SubmissionWriteInput = SubmissionIdInput.extend({ mutationId: Uuid });
/** A change to one submission. */
export type SubmissionWriteInput = z.infer<typeof SubmissionWriteInput>;

/**
 * How a member settles a submission the content checks held for review:
 * not spam (it is processed as any other) or spam. A record pick for an
 * ambiguous match (AC-563) joins this union as its own kind.
 */
export const SubmissionResolution = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_spam') }),
  z.object({ kind: z.literal('spam') }),
]);
/** How a member settles a submission held for review. */
export type SubmissionResolution = z.infer<typeof SubmissionResolution>;

/** Settling one submission held for review. */
export const ResolveSubmissionInput = SubmissionWriteInput.extend({ resolution: SubmissionResolution });
/** Settling one submission held for review. */
export type ResolveSubmissionInput = z.infer<typeof ResolveSubmissionInput>;

/** The most submissions one Add to CRM call names. */
export const ADD_TO_CRM_MAX = 500;

/**
 * Add to CRM: files submissions that aren't in the CRM (failed, or whose
 * record went to the trash) with the form's current published mapping, one
 * or many, in one `forms.file` job. Ones that don't qualify (spam, review,
 * held, filing, already linked) are left out and counted in `skipped`.
 */
export const AddToCrmInput = WorkspaceScoped.extend({
  formId: Uuid,
  submissionIds: z.array(Uuid).min(1).max(ADD_TO_CRM_MAX),
  mutationId: Uuid,
});
/** Add to CRM. */
export type AddToCrmInput = z.infer<typeof AddToCrmInput>;

/** What Add to CRM started: its job (absent when nothing qualified), how many it files and how many it left out. */
export const AddToCrmResult = z.object({
  jobId: Uuid.optional(),
  queued: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
/** What Add to CRM started. */
export type AddToCrmResult = z.infer<typeof AddToCrmResult>;

/**
 * Which earlier submissions Sync old records applies the current mapping to:
 * `all` filed or failed ones, or `unfiled` only (failed, or whose record is
 * in the trash). Spam, review, held and filing ones are never touched.
 */
export const SyncScope = z.enum(['all', 'unfiled']);
/** Which earlier submissions a sync touches. */
export type SyncScope = z.infer<typeof SyncScope>;

/** A sync's preview, or its scope. */
export const SyncInput = WorkspaceScoped.extend({ formId: Uuid, scope: SyncScope });
/** A sync's preview. */
export type SyncInput = z.infer<typeof SyncInput>;

/** The most submissions a preview reads; past it the counts are of the newest this many (`capped`). */
export const SYNC_PREVIEW_MAX = 2_000;

/**
 * What a sync would do, submission by submission: create a record, update
 * one, leave one as it is (`unchanged`: nothing new to write), or fail (a
 * refusal no answer explains, such as a required field the form doesn't ask).
 */
export const SyncCounts = z.object({
  creates: z.number().int().min(0),
  updates: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  failures: z.number().int().min(0),
});
/** What a sync would do, or did. */
export type SyncCounts = z.infer<typeof SyncCounts>;

/** A sync's preview: the counts, how many submissions are in scope, and whether the counts cover only the newest. */
export const SyncPreview = SyncCounts.extend({
  total: z.number().int().min(0),
  checked: z.number().int().min(0),
  capped: z.boolean(),
  /** The live version the sync would apply. */
  versionNumber: z.number().int().min(1),
});
/** A sync's preview. */
export type SyncPreview = z.infer<typeof SyncPreview>;

/** Starting a sync: its scope, and the job's id (client minted, so a retry starts one job). */
export const SyncStartInput = SyncInput.extend({ jobId: Uuid, mutationId: Uuid });
/** Starting a sync. */
export type SyncStartInput = z.infer<typeof SyncStartInput>;

/** A started sync: its `forms.sync` job (whose `result` ends as `SyncCounts` plus `skipped`) and how many it will go through. */
export const SyncStarted = z.object({ jobId: Uuid, total: z.number().int().min(0) });
/** A started sync. */
export type SyncStarted = z.infer<typeof SyncStarted>;

/** The most rows one submissions export holds. */
export const EXPORT_ROWS_MAX = 100_000;

/** The most submissions an export by id names. */
export const EXPORT_IDS_MAX = 1_000;

/** Which submissions an export holds: those a filter matches (a state, a received range), or the ones named. */
export const SubmissionSelection = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('filter'),
    state: SubmissionState.optional(),
    from: Timestamp.optional(),
    to: Timestamp.optional(),
  }),
  z.object({ kind: z.literal('ids'), submissionIds: z.array(Uuid).min(1).max(EXPORT_IDS_MAX) }),
]);
/** Which submissions an export holds. */
export type SubmissionSelection = z.infer<typeof SubmissionSelection>;

/** Exporting a form's submissions as CSV: the export's id (client minted, so a retry makes one), the form, the selection. */
export const ExportSubmissionsInput = WorkspaceScoped.extend({
  id: Uuid,
  formId: Uuid,
  select: SubmissionSelection,
  mutationId: Uuid,
});
/** Exporting a form's submissions. */
export type ExportSubmissionsInput = z.infer<typeof ExportSubmissionsInput>;

/** One export by id (only its starter sees it). */
export const ExportIdInput = WorkspaceScoped.extend({ exportId: Uuid });
/** One export by id. */
export type ExportIdInput = z.infer<typeof ExportIdInput>;

/**
 * An export: its file's name, its job (follow it through `jobs`), its rows
 * once written, when the file goes, and where to download it once the job
 * succeeded (`GET`, the session's cookie; 404 for anyone but its starter).
 */
export const ExportView = z.object({
  id: Uuid,
  formId: Uuid,
  fileName: z.string(),
  jobId: Uuid,
  rowCount: z.number().int().min(0).optional(),
  expiresAt: Timestamp,
  downloadPath: z.string(),
});
/** An export. */
export type ExportView = z.infer<typeof ExportView>;

/** Where an export downloads from: `/api/exports/<id>/download?workspace=<slug>`. */
export function exportDownloadPath(workspace: string, exportId: string): string {
  return `/api/exports/${encodeURIComponent(exportId)}/download?workspace=${encodeURIComponent(workspace)}`;
}

/** The forms procedures (spec 0023). */
export const formsContract = {
  list: oc.input(ListFormsInput).output(z.object({ items: z.array(FormSummary) })),
  get: oc.input(FormIdInput).output(FormView),
  attributes: oc.input(FormIdInput).output(FormTargetChoices),
  /** The draft as visitors would see it (AC-657): the hosted page's shape, sending nothing. */
  preview: oc.input(FormIdInput).output(PublicForm),
  slugAvailable: oc.input(SlugInput).output(z.object({ available: z.boolean() })),
  create: oc.input(CreateFormInput).output(FormView),
  saveDraft: oc.input(SaveFormDraftInput).output(FormView),
  publish: oc.input(PublishFormInput).output(FormView),
  updateSettings: oc.input(UpdateFormSettingsInput).output(FormView),
  setStatus: oc.input(SetFormStatusInput).output(FormView),
  setTarget: oc.input(SetFormTargetInput).output(FormView),
  duplicate: oc.input(DuplicateFormInput).output(FormView),
  delete: oc.input(FormWriteInput).output(z.object({ deleted: z.literal(true) })),
  /** Sync old records: what applying the current mapping to earlier submissions would do (read only). */
  syncPreview: oc.input(SyncInput).output(SyncPreview),
  /** Sync old records: starts the `forms.sync` job. */
  syncStart: oc.input(SyncStartInput).output(SyncStarted),
};

/** The submissions procedures (spec 0023). */
export const submissionsContract = {
  list: oc.input(ListSubmissionsInput).output(SubmissionPage),
  get: oc.input(SubmissionIdInput).output(SubmissionView),
  release: oc.input(SubmissionWriteInput).output(SubmissionView),
  markSpam: oc.input(SubmissionWriteInput).output(SubmissionView),
  resolve: oc.input(ResolveSubmissionInput).output(SubmissionView),
  /** Add to CRM, one or many: starts a `forms.file` job. */
  addToCrm: oc.input(AddToCrmInput).output(AddToCrmResult),
  /** Export as CSV: starts a `forms.export` job; download from `downloadPath` once it succeeded. */
  export: oc.input(ExportSubmissionsInput).output(ExportView),
  /** One export the caller started. */
  getExport: oc.input(ExportIdInput).output(ExportView),
  retry: oc.input(SubmissionWriteInput).output(SubmissionView),
  delete: oc.input(SubmissionWriteInput).output(z.object({ deleted: z.literal(true) })),
};
