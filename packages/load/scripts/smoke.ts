// The weekly smoke's last step (spec 0011, AC-211, `.github/workflows/load-smoke.yml`):
// `node packages/load/scripts/smoke.ts <load:run exit code>` reads the newest
// result in `.load/results/`, prints a warning for each budget miss and an
// error for an invalid run, adds the table to the workflow's summary, and
// exits 0 unless the run was invalid or crashed.
import { appendFile, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { LOAD_DIR } from '@crm/core/load-local';
import { LoadResult } from '../src/result.ts';
import { smokeSummary, smokeVerdict } from '../src/smoke.ts';

/** The newest result file's contents, or undefined when the run wrote none. */
async function newestResult(): Promise<LoadResult | undefined> {
  const dir = join(LOAD_DIR, 'results');
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith('.json'));
  const written = await Promise.all(
    names.map(async (name) => ({ path: join(dir, name), at: (await stat(join(dir, name))).mtimeMs })),
  );
  const newest = written.sort((left, right) => right.at - left.at)[0];
  if (newest === undefined) return undefined;
  return LoadResult.parse(JSON.parse(await readFile(newest.path, 'utf8')));
}

const runExit = Number(process.argv[2]);
const result = await newestResult();
const verdict = smokeVerdict(Number.isInteger(runExit) ? runExit : 1, result);
for (const annotation of verdict.annotations) console.log(annotation);
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (result !== undefined && summaryFile !== undefined && summaryFile !== '') {
  await appendFile(summaryFile, smokeSummary(result));
}
process.exit(verdict.exitCode);
