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
  mainObjectId: Uuid,
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

/** A new form (AC-649): "Untitled form" with Name, Email and Phone on People, unless named. */
export const CreateFormInput = WorkspaceScoped.extend({
  id: uuidV7('The form id must be a UUID v7.'),
  name: FormName.optional(),
  mainObjectId: Uuid.optional(),
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

/** Points a never published form at another object, its questions' filing cleared where it no longer fits. */
export const SetFormTargetInput = WorkspaceScoped.extend({
  formId: Uuid,
  mainObjectId: Uuid,
  expectedRevision: z.number().int().min(1),
  mutationId: Uuid,
});
/** Points a never published form at another object. */
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

/** The target object and the attributes a question may be filed on. */
export const FormTargetChoices = z.object({
  objectId: Uuid,
  objectName: z.string(),
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
  /** The first two answers the reader may see, other than the email. */
  firstAnswers: z.array(SubmissionAnswer).max(2),
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
};

/** The submissions procedures (spec 0023). */
export const submissionsContract = {
  list: oc.input(ListSubmissionsInput).output(SubmissionPage),
  get: oc.input(SubmissionIdInput).output(SubmissionView),
  release: oc.input(SubmissionWriteInput).output(SubmissionView),
  markSpam: oc.input(SubmissionWriteInput).output(SubmissionView),
  resolve: oc.input(ResolveSubmissionInput).output(SubmissionView),
  retry: oc.input(SubmissionWriteInput).output(SubmissionView),
  delete: oc.input(SubmissionWriteInput).output(z.object({ deleted: z.literal(true) })),
};
