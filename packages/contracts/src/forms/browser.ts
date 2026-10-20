// `@crm/contracts/forms`: what the hosted page and the builder share, with no
// Zod and no oRPC at run time: the answer types, the answer check, the
// publish check, the dialling codes, the presets and the visitor's words. The
// public shapes come as types only, so the hosted page's bundle stays small.
export * from './answer-types.ts';
export * from './check.ts';
export * from './dial-codes.ts';
export * from './email-hint.ts';
export * from './presets.ts';
export * from './publish.ts';
export * from './strings.ts';
export type {
  FillTicket,
  FormLanguage,
  PublicForm,
  PublicQuestion,
  SubmitBody,
  SubmitErrors,
  SubmitHidden,
  SubmitNext,
  SubmitResult,
} from './public.ts';
export type { FiledOn, FormAfter, FormDocument, FormLook, FormQuestion } from './document.ts';
