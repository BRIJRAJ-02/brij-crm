// The editor's draft, as plain functions (booking socials, 25 Oct 2026): a person's stored links to the rows the
// editor shows, the rows back to links (each made canonical by the one `checkSocialLink` the server runs too), and
// whether a draft changed anything. Imported by the editor and by the screens that hold its draft.
import type { SocialLinkNetwork } from '@crm/contracts/social-networks';
import { checkSocialLink, socialLinkFieldValue, socialLinkProblem } from '@crm/contracts/values';

/** One stored link: its network and its canonical link. */
export interface StoredSocialLink {
  readonly network: SocialLinkNetwork;
  readonly href: string;
}

/** One row of the editor: its network (one row per network) and what the field holds, with why it is wrong. */
export interface SocialLinkDraft {
  readonly network: SocialLinkNetwork;
  /** The handle after the field's prefix, or a whole link. */
  readonly text: string;
  /** Why the text won't save, said under the field. */
  readonly error?: string;
}

/** The rows for a person's stored links, in their order: each field holds its handle. */
export function draftOf(links: readonly StoredSocialLink[]): readonly SocialLinkDraft[] {
  return links.map((link) => ({ network: link.network, text: socialLinkFieldValue(link.network, link.href) }));
}

/** One row checked as it is left: its text made the field's own (a pasted link becomes the handle), or its error. */
export function checkedRow(row: SocialLinkDraft): SocialLinkDraft {
  if (row.text.trim() === '') return { network: row.network, text: '' };
  const checked = checkSocialLink(row.network, row.text);
  if (!checked.ok) return { network: row.network, text: row.text, error: socialLinkProblem(row.network, checked) };
  return { network: row.network, text: socialLinkFieldValue(row.network, checked.value) };
}

/** What a draft saves as: its links in order (an empty row is left out), or the rows with every error said. */
export type DraftLinks =
  | { readonly ok: true; readonly links: readonly StoredSocialLink[] }
  | { readonly ok: false; readonly rows: readonly SocialLinkDraft[] };

/** The draft's links, each checked; any row that won't save makes the whole draft come back with its errors. */
export function linksOf(rows: readonly SocialLinkDraft[]): DraftLinks {
  const links: StoredSocialLink[] = [];
  const checked = rows.map((row): SocialLinkDraft => {
    if (row.text.trim() === '') return { network: row.network, text: row.text };
    const result = checkSocialLink(row.network, row.text);
    if (!result.ok) return { network: row.network, text: row.text, error: socialLinkProblem(row.network, result) };
    links.push({ network: row.network, href: result.value });
    return { network: row.network, text: row.text };
  });
  return checked.some((row) => row.error !== undefined) ? { ok: false, rows: checked } : { ok: true, links };
}

/** Whether a draft would save something other than `links`: a row added, removed, moved or changed. */
export function isDraftChanged(rows: readonly SocialLinkDraft[], links: readonly StoredSocialLink[]): boolean {
  const filled = rows.filter((row) => row.text.trim() !== '');
  if (filled.length !== links.length) return true;
  return filled.some((row, index) => {
    const link = links[index];
    if (link?.network !== row.network) return true;
    const checked = checkSocialLink(row.network, row.text);
    return !checked.ok || checked.value !== link.href;
  });
}
