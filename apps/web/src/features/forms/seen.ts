// Which forms have answers the reader hasn't looked at yet (forms critique c, 5 November 2026: an answer arrived with
// no sign in the app). Per viewer and per browser, as a convenience: when this person last opened a form's
// Submissions, kept in local storage, and a form whose newest answer came after that reads New. Never shared, never
// read back by anyone, and a browser that keeps nothing simply shows no New.

/** The storage key one workspace's seen moments live under. */
const keyOf = (slug: string) => `crm.forms.seen.${slug}`;

/** The moments read, by form id; empty when storage can't be read. */
function readSeen(slug: string): Readonly<Record<string, string>> {
  try {
    const raw = globalThis.localStorage.getItem(keyOf(slug));
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(
          Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      : {};
  } catch {
    return {};
  }
}

/** Notes that the reader looked at a form's Submissions now. */
export function markSeen(slug: string, formId: string, at: Date = new Date()): void {
  try {
    globalThis.localStorage.setItem(keyOf(slug), JSON.stringify({ ...readSeen(slug), [formId]: at.toISOString() }));
  } catch {
    // Storage off or full: New stays as it was, which is all it costs.
  }
}

/**
 * Whether a form has an answer the reader hasn't seen: its newest came after they last opened its Submissions. A
 * form they never opened reads New only for an answer from the last week, so a first visit isn't a wall of New.
 */
export function hasNewAnswers(
  slug: string,
  form: { readonly id: string; readonly lastSubmissionAt?: string | undefined },
  now: number = Date.now(),
): boolean {
  if (form.lastSubmissionAt === undefined) return false;
  const last = Date.parse(form.lastSubmissionAt);
  const seen = readSeen(slug)[form.id];
  if (seen === undefined) return now - last < 7 * 86_400_000;
  return last > Date.parse(seen);
}
