// Forms for members (spec 0023, milestone 1): building, publishing and pausing
// forms (`forms.*`, `forms.manage` for every change), and reading and acting
// on their submissions (`submissions.*`). Every procedure takes
// `WorkspaceScoped` input and is served behind the member door.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from '../values/attribute-values.ts';
import { Hue } from '../values/hues.ts';
import { RecordRefDisplay } from '../values/options.ts';
import { WorkspaceScoped } from '../workspaces.ts';
import { FormDocument } from './document.ts';
import { FORM_QUESTION_TYPES, PublicForm } from './public.ts';

/** Where a form is (spec 0023, state transitions). */
export const FormStatus = z.enum(['draft', 'live', 'paused', 'archived']);
/** Where a form is. */
export type FormStatus = z.infer<typeof FormStatus>;

/** A form's name, as members see it in lists. */
export const FormName = z
  .string()
  .trim()
  .min(1, { error: 'Give the form a name.' })
  .max(200, { error: 'Keep the name to 200 characters.' });

/** A form in the list: its name, status and object, its public key and its counts. */
export const FormSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  status: FormStatus,
  mainObjectId: z.uuid(),
  publicKey: z.string(),
  liveVersionNumber: z.number().int().min(1).optional(),
  /** Submissions stored, counted up to `FORM_COUNT_CAP`. */
  submissionCount: z.number().int().min(0),
  updatedAt: Timestamp,
});
/** A form in the list. */
export type FormSummary = z.infer<typeof FormSummary>;

/** The most submissions a count reads before it says "at least". */
export const FORM_COUNT_CAP = 10_000;

/**
 * One form with its draft (the version being edited, by number) and its live
 * document. `canManage` says whether the reader holds `forms.manage`.
 */
export const FormView = FormSummary.extend({
  draftNumber: z.number().int().min(1),
  /** Moves on every save, publish, status change and key rotation: a change names the one it started from. */
  revision: z.number().int().min(1),
  draft: FormDocument,
  live: FormDocument.optional(),
  /** Whether the draft differs from what is live (a publish would change something). */
  hasUnpublished: z.boolean(),
  canManage: z.boolean(),
  createdAt: Timestamp,
});
/** One form with its draft and its live document. */
export type FormView = z.infer<typeof FormView>;

/** A new form on an object (People by default in the screen). `id` is a UUID v7 the browser mints. */
export const CreateFormInput = WorkspaceScoped.extend({
  id: z.uuid({ version: 'v7', message: 'The form id must be a UUID v7.' }),
  name: FormName,
  mainObjectId: z.uuid(),
  mutationId: z.uuid(),
});
/** A new form. */
export type CreateFormInput = z.infer<typeof CreateFormInput>;

/** Saves the draft. `expectedRevision` is the form the editor started from: anything else is 409 `FORM_CHANGED`. */
export const SaveFormDraftInput = WorkspaceScoped.extend({
  formId: z.uuid(),
  name: FormName.optional(),
  document: FormDocument,
  expectedRevision: z.number().int().min(1),
  mutationId: z.uuid(),
});
/** Saves the draft. */
export type SaveFormDraftInput = z.infer<typeof SaveFormDraftInput>;

/** Publishes the draft as the next live version (AC-548). */
export const PublishFormInput = WorkspaceScoped.extend({
  formId: z.uuid(),
  expectedRevision: z.number().int().min(1),
  mutationId: z.uuid(),
});
/** Publishes the draft. */
export type PublishFormInput = z.infer<typeof PublishFormInput>;

/** Moves a form between live, paused and archived (AC-549); restoring an archived form names `paused` (or `draft`). */
export const SetFormStatusInput = WorkspaceScoped.extend({
  formId: z.uuid(),
  status: FormStatus,
  mutationId: z.uuid(),
});
/** Moves a form between statuses. */
export type SetFormStatusInput = z.infer<typeof SetFormStatusInput>;

/** One form by id. */
export const FormIdInput = WorkspaceScoped.extend({ formId: z.uuid() });
/** One form by id. */
export type FormIdInput = z.infer<typeof FormIdInput>;

/** A change that names one form and nothing else (rotating its key). */
export const FormWriteInput = FormIdInput.extend({ mutationId: z.uuid() });
/** A change that names one form. */
export type FormWriteInput = z.infer<typeof FormWriteInput>;

/** The forms list: the active ones (draft, live, paused) or the archived ones. */
export const ListFormsInput = WorkspaceScoped.extend({
  archived: z.boolean().default(false),
});
/** The forms list. */
export type ListFormsInput = z.input<typeof ListFormsInput>;

/** The most forms one list answers (milestone 1 pages no further; plans cap live forms in milestone 2). */
export const FORMS_LIST_MAX = 200;

/** An attribute a question may map to, as the builder lists it: the main object's live, writable, public types. */
export const FormAttributeChoice = z.object({
  attributeId: z.uuid(),
  title: z.string(),
  type: z.enum(FORM_QUESTION_TYPES),
  isRequired: z.boolean(),
  isUnique: z.boolean(),
  /** Whether the reader may write it: only those can be mapped and published (AC-546). */
  canWrite: z.boolean(),
});
/** An attribute a question may map to. */
export type FormAttributeChoice = z.infer<typeof FormAttributeChoice>;

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

/** A submission in its form's list: when, where it is, and its main record when processed. */
export const SubmissionSummary = z.object({
  id: z.uuid(),
  formId: z.uuid(),
  state: SubmissionState,
  receivedAt: Timestamp,
  processedAt: Timestamp.optional(),
  /** The bot checks' verdict: `unchecked` when reCAPTCHA couldn't be asked (AC-583). */
  verdict: z.enum(['passed', 'spam', 'unchecked']),
  mainRecord: RecordRefDisplay.optional(),
  /** A short line from the answers: the first text answer the reader may see. */
  preview: z.string().optional(),
});
/** A submission in its form's list. */
export type SubmissionSummary = z.infer<typeof SubmissionSummary>;

/** One answer as members read it: its question's label and type, and the value in that type's shape. */
export const SubmissionAnswer = z.object({
  questionId: z.string(),
  label: z.string(),
  type: z.enum(FORM_QUESTION_TYPES),
  /** The mapped attribute, when the question writes one. */
  attributeId: z.uuid().optional(),
  value: z.unknown(),
  /** A select's live options, so the answer shows by its labels. */
  options: z.array(z.object({ id: z.uuid(), label: z.string(), hue: Hue.optional() })).optional(),
});
/** One answer as members read it. */
export type SubmissionAnswer = z.infer<typeof SubmissionAnswer>;

/**
 * One submission in full: its answers (those to attributes the reader can't
 * see are absent, AC-573), its hidden fields, the bot signals, the records it
 * touched, and why it failed or what was refused.
 */
export const SubmissionView = SubmissionSummary.extend({
  versionNumber: z.number().int().min(1),
  answers: z.array(SubmissionAnswer),
  hidden: z.record(z.string(), z.string()),
  signals: z.array(z.string()),
  records: z.array(SubmissionRecord),
  failure: z.string().optional(),
  /** Answers processing refused (AC-565): the question and why. */
  refused: z.array(z.object({ questionId: z.string(), message: z.string() })),
  /** Who was given ownership, and why (AC-567). */
  assignment: z.object({ memberId: z.uuid().optional(), reason: z.string() }).optional(),
});
/** One submission in full. */
export type SubmissionView = z.infer<typeof SubmissionView>;

/** The most submissions one page holds. */
export const SUBMISSIONS_PAGE = 50;

/** A page of a form's submissions, newest first, optionally only one state (AC-572). */
export const ListSubmissionsInput = WorkspaceScoped.extend({
  formId: z.uuid(),
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
export const SubmissionIdInput = WorkspaceScoped.extend({ submissionId: z.uuid() });
/** One submission by id. */
export type SubmissionIdInput = z.infer<typeof SubmissionIdInput>;

/** A change to one submission (retry, delete). */
export const SubmissionWriteInput = SubmissionIdInput.extend({ mutationId: z.uuid() });
/** A change to one submission. */
export type SubmissionWriteInput = z.infer<typeof SubmissionWriteInput>;

/** The forms procedures (spec 0023, milestone 1). */
export const formsContract = {
  list: oc.input(ListFormsInput).output(z.object({ items: z.array(FormSummary) })),
  get: oc.input(FormIdInput).output(FormView),
  attributes: oc.input(FormIdInput).output(z.object({ items: z.array(FormAttributeChoice) })),
  /** The draft as visitors would see it (AC-550): the hosted page's shape, sending nothing. */
  preview: oc.input(FormIdInput).output(PublicForm),
  create: oc.input(CreateFormInput).output(FormView),
  saveDraft: oc.input(SaveFormDraftInput).output(FormView),
  publish: oc.input(PublishFormInput).output(FormView),
  setStatus: oc.input(SetFormStatusInput).output(FormView),
  rotateKey: oc.input(FormWriteInput).output(FormView),
};

/** The submissions procedures (spec 0023, milestone 1). */
export const submissionsContract = {
  list: oc.input(ListSubmissionsInput).output(SubmissionPage),
  get: oc.input(SubmissionIdInput).output(SubmissionView),
  retry: oc.input(SubmissionWriteInput).output(SubmissionView),
  delete: oc.input(SubmissionWriteInput).output(z.object({ deleted: z.literal(true) })),
};
