// Where the forms screens are (spec 0023): under Captures, beside Links. Plain
// functions with no React, so the routes' loaders can use them. The routes load
// this file up front, so a path only one screen links to lives with that screen
// (a question's, in SettingsTab.tsx).

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
