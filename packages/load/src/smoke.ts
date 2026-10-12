// The weekly smoke's verdict (spec 0011, AC-211): shared runners don't give
// times worth judging, so the smoke fails only on an invalid run or a crash,
// and every budget miss shows as a warning on the workflow's page.

import type { LoadResult } from './result.ts';

/** What the workflow prints and how it exits. */
export interface SmokeVerdict {
  /** GitHub workflow commands (`::warning ...::`, `::error ...::`), one per line. */
  readonly annotations: readonly string[];
  readonly exitCode: number;
}

/** Escapes a workflow command's message, as GitHub's toolkit does. */
const escape = (text: string) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
/** Escapes a workflow command's property (a title), as GitHub's toolkit does. */
const escapeProperty = (text: string) => escape(text).replaceAll(':', '%3A').replaceAll(',', '%2C');

/**
 * The smoke's verdict from `pnpm load:run`'s exit code and the result it
 * wrote: 0 or 1 pass (each judged miss a warning), 2 fails as invalid, and
 * anything else (3, setup refused, or a crash) fails with that code.
 */
export function smokeVerdict(runExit: number, result: LoadResult | undefined): SmokeVerdict {
  if (runExit !== 0 && runExit !== 1 && runExit !== 2) {
    return {
      annotations: [
        `::error title=${escapeProperty('Load smoke crashed')}::${escape(`pnpm load:run exited ${String(runExit)}: setup was refused or the harness crashed. See its output above.`)}`,
      ],
      exitCode: runExit > 0 ? runExit : 1,
    };
  }
  if (result === undefined) {
    return {
      annotations: [`::error title=${escapeProperty('Load smoke wrote no result')}::${escape('No result file.')}`],
      exitCode: 1,
    };
  }
  if (!result.validity.valid) {
    return {
      annotations: [
        `::error title=${escapeProperty('Load smoke invalid')}::${escape(result.validity.reasons.join('; '))}`,
      ],
      exitCode: 2,
    };
  }
  const misses = result.lines.filter((line) => line.judged && line.verdict === 'miss');
  return {
    annotations: misses.map((line) => {
      const p95 = line.summary === undefined ? '' : ` p95 ${String(line.summary.p95)}`;
      const message = `${line.metric}:${p95} against ${line.target ?? 'its target'} (shared runner times are a direction only)`;
      return `::warning title=${escapeProperty(`Budget miss: ${line.metric}`)}::${escape(message)}`;
    }),
    exitCode: 0,
  };
}

/** The result as a short Markdown table for the workflow's summary page. */
export function smokeSummary(result: LoadResult): string {
  const rows = result.lines.map((line) => {
    const s = line.summary;
    const cell = (value: number | undefined) => (value === undefined ? '' : String(value));
    return `| ${line.metric} | ${line.target ?? ''} | ${cell(s?.p50)} | ${cell(s?.p95)} | ${cell(s?.count)} | ${line.verdict} |`;
  });
  return [
    `### Load smoke: ${result.scenario}, ${String(result.users)} users, ${String(result.minutes)} minutes`,
    '',
    result.validity.valid ? 'Valid run.' : `Invalid run: ${result.validity.reasons.join('; ')}.`,
    '',
    '| metric | target | p50 | p95 | count | verdict |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}
