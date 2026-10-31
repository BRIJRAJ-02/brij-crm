// A form's breaks as steps (spec 0063, AC-6303): what the server and the builder resolve a document's breaks into,
// the steps a hosted page groups by. Apart from `path.ts` on purpose: the hosted page never resolves breaks (the
// server sends them resolved), and a module the page and the builder share ships whole in the page's first load.
import type { ShowWhen } from './show-when.ts';

/** A break in the document: where it starts (a question's id, absent at the end) and what it carries. */
export interface StepBreak {
  readonly id: string;
  readonly title?: string | undefined;
  readonly startsAt?: string | undefined;
  readonly showWhen?: ShowWhen | undefined;
}

/** A break resolved to the keys of its questions, its Show when kept in the shape it came in. */
export interface ResolvedStep<When extends ShowWhen | undefined = ShowWhen | undefined> {
  id?: string | undefined;
  title?: string | undefined;
  keys: string[];
  showWhen?: When | undefined;
}

/**
 * The document's breaks as steps over its questions (AC-6303): the questions before the first break make the first
 * step, and each break starts a step at its question. Two breaks at one place, or one at the end, leave a step with
 * no questions, which the path skips and publish refuses. A break naming a question the form doesn't have is
 * dropped: its questions join the step above, as removing it would.
 */
export function stepsOfBreaks<Break extends StepBreak>(
  questions: readonly { readonly id: string; readonly key: string }[],
  breaks: readonly Break[],
): ResolvedStep<Break['showWhen']>[] {
  const ids = new Set(questions.map((question) => question.id));
  const at = (each: StepBreak) =>
    each.startsAt === undefined ? questions.length : questions.findIndex((question) => question.id === each.startsAt);
  const placed = breaks.filter((each) => each.startsAt === undefined || ids.has(each.startsAt));
  const starts = placed.map(at);
  const firstStart = starts[0] ?? questions.length;
  const lead: ResolvedStep<Break['showWhen']>[] =
    firstStart > 0 || placed.length === 0
      ? [{ keys: questions.slice(0, firstStart).map((question) => question.key) }]
      : [];
  return [
    ...lead,
    ...placed.map((each, index) => {
      const from = starts[index] ?? questions.length;
      const to = Math.max(from, starts[index + 1] ?? questions.length);
      return {
        id: each.id,
        ...(each.title === undefined || each.title.trim() === '' ? {} : { title: each.title.trim() }),
        keys: questions.slice(from, to).map((question) => question.key),
        ...(each.showWhen === undefined ? {} : { showWhen: each.showWhen }),
      };
    }),
  ];
}
