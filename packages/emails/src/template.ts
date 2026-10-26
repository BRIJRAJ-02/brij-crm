// What every template is: a pure function from its params (and what the
// worker knows at send time) to an `EmailDocument`. No React, no I/O.
import type { EmailDocument } from './document.ts';

/** What a template knows besides its params, filled in by whoever sends it. */
export interface TemplateContext {
  /** The workspace the email is about, by name; unset for an account email (a sign in code, a sign in alert). */
  readonly workspaceName?: string;
  /** An app path as a full link on the app's own origin. */
  readonly link: (path: string) => string;
  /**
   * The host the public pages are written with (`timefix.com`), for an address shown as text only: its link is
   * still an app path (`/<handle>`), which the app's origin sends on. Unset, the app's own host.
   */
  readonly publicHost?: string;
}

/** A template: its params and context in, the email's words out. */
export type Template<P> = (params: P, context: TemplateContext) => EmailDocument;

/** The workspace's name for a sentence, or a plain stand in when the worker couldn't read it. */
export function workspaceOf(context: TemplateContext): string {
  return context.workspaceName ?? 'your workspace';
}

/** A line cut to `max` characters at a word where it can be, for a preview line. */
export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
