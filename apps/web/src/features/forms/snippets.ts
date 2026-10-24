// The code a site pastes (spec 0023, 0023-embeds.md; Install tab): the embed
// in its three modes, and the site's own HTML form, tagged the way HubSpot
// tags its forms. Every word from the form is escaped, so a label can never
// become markup on the site. The Install tab and the publish dialog render
// these; nothing here draws.
//
// The API (for whoever draws the Install tab):
//   embedSnippet(script, target, mode)   the tag and the holder for inline, popup or floating
//   ownFormHtml(form, script)            the full tagged form, with its script tag
//   EMBED_MODES                          the three modes, in the order the tab offers them
import { choiceKeysOf, HONEYPOT_IGNORE_ATTRIBUTES, HONEYPOT_INPUT_NAME } from '@crm/data/forms';
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

/** How a site shows the form: in the page, in a dialog from its own button, or from a corner button. */
export const EMBED_MODES = ['inline', 'popup', 'floating'] as const;
/** One way to embed. */
export type EmbedMode = (typeof EMBED_MODES)[number];

/** What an embed points at: a form or a booking page, with the words and theme its snippet carries. */
export interface EmbedTarget {
  readonly kind: 'form' | 'booking';
  readonly publicKey: string;
  /** The frame's title for screen readers: the form's headline, the page's title. */
  readonly title: string;
  readonly theme: 'light' | 'dark';
  /** The popup and corner button's words: the form's button text. */
  readonly buttonText: string;
}

/** The corner button's colour: the library's accent, the blue the form's own button uses. */
export const EMBED_ACCENT = '#1f5fd6';

/** The script tag: one per site, however many embeds it holds. */
const scriptTag = (script: string) => `<script src="${escapeHtml(script)}" async></script>`;

/**
 * The embed for one mode: the script tag, then the holder it fills. Inline
 * takes its container's width and its content's height; popup opens from the
 * site's own button; floating draws a corner button in the form's words.
 */
export function embedSnippet(script: string, target: EmbedTarget, mode: EmbedMode): string {
  const kind = `data-timefix-${target.kind}="${escapeHtml(target.publicKey)}"`;
  const look = `data-timefix-title="${escapeHtml(target.title)}"${target.theme === 'dark' ? ' data-timefix-theme="dark"' : ''}`;
  const holder =
    mode === 'popup'
      ? `<button type="button" ${kind} data-timefix-mode="popup" ${look}>${escapeHtml(target.buttonText)}</button>`
      : mode === 'floating'
        ? `<div ${kind} data-timefix-mode="floating" data-timefix-text="${escapeHtml(target.buttonText)}" data-timefix-color="${EMBED_ACCENT}" ${look}></div>`
        : `<div ${kind} ${look}></div>`;
  return `${scriptTag(script)}\n${holder}`;
}

/** The browser's autofill hint for a question, by its type and its key. */
function autoCompleteOf(type: string, key: string): string | undefined {
  if (type === 'email') return 'email';
  if (type === 'phone') return 'tel';
  if (type === 'website') return 'url';
  if (type === 'country') return 'country-name';
  if (key === 'name' || key === 'full_name' || key === 'your_name') return 'name';
  if (key === 'first_name') return 'given-name';
  if (key === 'last_name') return 'family-name';
  if (key === 'company' || key === 'company_name' || key === 'organisation' || key === 'organization')
    return 'organization';
  if (key === 'job_title' || key === 'title' || key === 'role') return 'organization-title';
  return undefined;
}

/** The input type for a question answered by typing. */
const inputTypeOf = (type: string) =>
  type === 'email'
    ? 'email'
    : type === 'phone'
      ? 'tel'
      : type === 'website'
        ? 'url'
        : type === 'number'
          ? 'number'
          : 'text';

/** The form a site's own HTML posts, at its live version (the draft until the first publish). */
export type OwnForm = Pick<FormView, 'publicKey' | 'draft' | 'live' | 'liveVersionNumber' | 'workspaceKey'>;

/**
 * The site's own HTML form, tagged (spec 0023, tagging): the form names its
 * workspace's public key, its own address and its version; every input's
 * `name` is the question's key (never its label, so a rename never breaks a
 * site), with a matching `id` and a `for` on its label, an autofill hint and
 * `required` where it is. A choice posts its stable key. The honeypot, a
 * polite status line for the thank you and an alert line for a refusal come
 * with it, then the script that posts it with where it came from.
 */
export function ownFormHtml(form: OwnForm, script: string): string {
  const document = form.live ?? form.draft;
  const key = escapeHtml(form.publicKey);
  const idOf = (question: string) => `tfx-${key}-${escapeHtml(question)}`;
  const fields = document.questions.flatMap((question) => {
    const id = idOf(question.key);
    const name = escapeHtml(question.key);
    const label = escapeHtml(question.label);
    const required = question.required ? ' required' : '';
    const hint = autoCompleteOf(question.answerType, question.key);
    const autocomplete = hint === undefined ? '' : ` autocomplete="${hint}"`;
    const placeholder =
      question.placeholder === undefined || question.placeholder === ''
        ? ''
        : ` placeholder="${escapeHtml(question.placeholder)}"`;
    if (question.answerType === 'file') return [`  <!-- ${escapeHtml(strings.ownFormNoFiles(question.label))} -->`];
    if (question.answerType === 'checkbox' || question.answerType === 'yes_no') {
      return [
        '  <div>',
        `    <input type="checkbox" id="${id}" name="${name}" value="yes"${required}>`,
        `    <label for="${id}">${label}</label>`,
        '  </div>',
      ];
    }
    if (question.answerType === 'dropdown' || question.answerType === 'choice') {
      const keys = choiceKeysOf(question);
      const options = (question.choices ?? []).map(
        (choice, at) => `      <option value="${escapeHtml(keys[at] ?? '')}">${escapeHtml(choice)}</option>`,
      );
      return [
        '  <div>',
        `    <label for="${id}">${label}</label>`,
        `    <select id="${id}" name="${name}"${required}>`,
        `      <option value="">${escapeHtml(strings.ownFormChooseOne)}</option>`,
        ...options,
        '    </select>',
        '  </div>',
      ];
    }
    if (question.answerType === 'long_text') {
      return [
        '  <div>',
        `    <label for="${id}">${label}</label>`,
        `    <textarea id="${id}" name="${name}"${placeholder}${required}></textarea>`,
        '  </div>',
      ];
    }
    return [
      '  <div>',
      `    <label for="${id}">${label}</label>`,
      `    <input type="${inputTypeOf(question.answerType)}" id="${id}" name="${name}"${autocomplete}${placeholder}${required}>`,
      '  </div>',
    ];
  });
  const version = form.liveVersionNumber ?? 1;
  const trapSkipMarks = Object.entries(HONEYPOT_IGNORE_ATTRIBUTES)
    .map(([attribute, value]) => ` ${attribute}="${value}"`)
    .join('');
  return [
    `<form id="timefix-${key}" data-timefix-form="${key}" data-timefix-workspace="${escapeHtml(form.workspaceKey)}" data-timefix-version="${String(version)}">`,
    ...fields,
    `  <!-- ${escapeHtml(strings.ownFormTrapNote)} -->`,
    `  <div hidden aria-hidden="true">`,
    `    <label for="${idOf(HONEYPOT_INPUT_NAME)}">${escapeHtml(strings.ownFormTrapLabel)}</label>`,
    `    <input type="text" id="${idOf(HONEYPOT_INPUT_NAME)}" name="${HONEYPOT_INPUT_NAME}" tabindex="-1" autocomplete="off"${trapSkipMarks}>`,
    '  </div>',
    `  <button type="submit">${escapeHtml(document.buttonText)}</button>`,
    `  <p role="status" data-timefix-success="${escapeHtml(document.after.kind === 'message' && document.after.message !== '' ? document.after.message : strings.ownFormThanks)}"></p>`,
    '  <p role="alert" data-timefix-error></p>',
    '</form>',
    scriptTag(script),
  ].join('\n');
}
