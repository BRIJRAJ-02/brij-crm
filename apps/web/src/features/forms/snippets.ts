// The code a site pastes (spec 0023, Install tab): the embed, and a plain
// HTML form of its own. Every word from the form is escaped, so a label can
// never become markup on the site.
import type { FormView } from '@crm/data';
import { strings } from './strings.ts';

/** Text made safe for HTML text and attribute values. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The two line embed: our script and the holder, titled with the form's headline. */
export function embedSnippet(script: string, publicKey: string, title: string): string {
  return `<script src="${escapeHtml(script)}" async></script>\n<div data-crm-form="${escapeHtml(publicKey)}" data-crm-title="${escapeHtml(title)}"></div>`;
}

/** A plain HTML form for the site's own design: one field per question, named by `data-crm-field`. */
export function ownFormHtml(form: Pick<FormView, 'publicKey' | 'draft'>, script: string): string {
  const inputType = (type: string) =>
    type === 'email' ? 'email' : type === 'phone' ? 'tel' : type === 'website' ? 'url' : 'text';
  const fields = form.draft.questions.map((question) => {
    const required = question.required ? ' required' : '';
    const label = escapeHtml(question.label);
    const key = escapeHtml(question.key);
    if (question.answerType === 'long_text') {
      return `  <label>${label}\n    <textarea data-crm-field="${key}"${required}></textarea>\n  </label>`;
    }
    if (question.answerType === 'checkbox' || question.answerType === 'yes_no') {
      return `  <label><input type="checkbox" data-crm-field="${key}"${required}> ${label}</label>`;
    }
    if (question.answerType === 'dropdown' || question.answerType === 'choice') {
      const options = (question.choices ?? [])
        .map((choice) => `      <option>${escapeHtml(choice)}</option>`)
        .join('\n');
      return `  <label>${label}\n    <select data-crm-field="${key}"${required}>\n${options}\n    </select>\n  </label>`;
    }
    return `  <label>${label}\n    <input type="${inputType(question.answerType)}" data-crm-field="${key}"${required}>\n  </label>`;
  });
  return [
    `<form data-crm-form-post="${escapeHtml(form.publicKey)}">`,
    ...fields,
    `  <button type="submit">${escapeHtml(form.draft.buttonText)}</button>`,
    `  <p data-crm-thanks hidden>${escapeHtml(strings.ownFormThanks)}</p>`,
    '</form>',
    `<script src="${escapeHtml(script)}" async></script>`,
  ].join('\n');
}
