// `@crm/contracts/forms`: what the hosted page and the builder share, with no
// Zod and no oRPC at run time: the answer types, the answer check, the
// publish check, the dialling codes, the presets and the visitor's words. The
// public shapes come as types only, so the hosted page's bundle stays small.
export * from './answer-types.ts';
export * from './answer-words.ts';
export * from './check.ts';
export * from './dial-codes.ts';
export * from './email-hint.ts';
export * from './breaks.ts';
export * from './path.ts';
export * from './recall.ts';
export * from './score.ts';
export * from './presets.ts';
export * from './publish.ts';
export * from './conditions.ts';
export * from './routing-limits.ts';
export * from './show-when.ts';
export * from './strings.ts';
export * from './uploads.ts';
export type {
  FillTicket,
  FormLanguage,
  PublicEnding,
  PublicForm,
  PublicJump,
  PublicQuestion,
  PublicStep,
  SubmitBody,
  SubmitErrors,
  SubmitHidden,
  SubmitNext,
  SubmitResult,
} from './public.ts';
export type { SubmissionContext, SubmitContext } from './context.ts';
export { CONFIRMATION_LINE_MAX, CONFIRMATION_SUBJECT_MAX } from './confirmation.ts';
// The template gallery's shapes (spec 0063, AC-6323), as types only: the tile's preview is drawn by a library
// component, and the ids and the Zod schemas stay out of the hosted page's bundle.
export type { FormTemplateId, FormTemplatePreview, FormTemplatePreviewRow, FormTemplateSummary } from './templates.ts';
export type {
  FiledOn,
  FormAfter,
  FormDocument,
  FormEnding,
  FormJump,
  FormLook,
  FormQuestion,
  FormQuestionPoints,
  FormStep,
  JumpTarget,
} from './document.ts';
export type { RouteHosts } from './routing.ts';
// The beacon's body (spec 0063, AC-6320), as a type only: the hosted page builds the object and the
// server parses it, so the schema itself stays out of the page's bundle.
export type { FormEventBody, FormEventKind } from './visits.ts';
// Save and resume (spec 0063, AC-6319), as types only: the page builds these objects and the server parses
// them, so the schemas and their messages stay out of the page's bundle.
export type { PartialBody, PartialEmailBody, PartialSaved, ResumedFill } from './partials.ts';
