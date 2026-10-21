// Where the forms screens are (spec 0023): under Captures, beside Links. Plain
// functions with no React, so the routes' loaders can use them.

/** Captures, Forms: the list, under the Captures tabs. */
export { formsHref } from '../captures/tabs.ts';

/** A form's tabs. */
export const FORM_TABS = ['form', 'settings', 'install', 'submissions'] as const;
/** One of a form's tabs. */
export type FormTab = (typeof FORM_TABS)[number];

/** One form's editor, on a tab (Form by default), optionally with one submission open. */
export const formHref = (slug: string, formId: string, tab: FormTab = 'form', submissionId?: string) =>
  `/w/${slug}/captures/forms/${formId}${tab === 'form' ? '' : `?tab=${tab}`}${
    submissionId === undefined ? '' : `${tab === 'form' ? '?' : '&'}submission=${submissionId}`
  }`;

/** A draft opened in a new tab to try, marked "Preview, not live". */
export const formPreviewHref = (slug: string, formId: string) => `/w/${slug}/captures/forms/${formId}/preview`;

/** One form's Form tab with one question open and in view: Settings' map of where answers go links each line here. */
export const questionHref = (slug: string, formId: string, questionId: string) =>
  `/w/${slug}/captures/forms/${formId}?question=${encodeURIComponent(questionId)}`;
