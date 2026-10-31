// `@crm/contracts/forms`: what the hosted page and the builder share, with no
// Zod and no oRPC at run time: the answer types, the answer check, the
// publish check, the dialling codes, the presets and the visitor's words. The
// public shapes come as types only, so the hosted page's bundle stays small.
export * from './answer-types.ts';
export * from './check.ts';
export * from './dial-codes.ts';
export * from './email-hint.ts';
export * from './breaks.ts';
export * from './path.ts';
export * from './presets.ts';
export * from './publish.ts';
export * from './conditions.ts';
export * from './show-when.ts';
export * from './strings.ts';
export * from './uploads.ts';
export type {
  FillTicket,
  FormLanguage,
  PublicForm,
  PublicQuestion,
  PublicStep,
  SubmitBody,
  SubmitErrors,
  SubmitHidden,
  SubmitNext,
  SubmitResult,
} from './public.ts';
export type { SubmissionContext, SubmitContext } from './context.ts';
export type { FiledOn, FormAfter, FormDocument, FormLook, FormQuestion, FormStep } from './document.ts';
