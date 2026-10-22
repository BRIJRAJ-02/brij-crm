// What `pnpm load:run` checks before it loads the harness (spec 0011, AC-203
// and AC-210): the arguments, the scenario's name, and that every `LOAD_*`
// address is this machine. It imports only the light guards, so a refusal
// costs no more than starting Node, and its tests call it in process.
import { parseArgs } from 'node:util';
import { loadRefusal, loadUrls, type LoadUrls } from '@crm/core/load-local';
import { SCENARIO_NAMES, type ScenarioName } from './scenarios.ts';

/** What a run asked for once the setup checks passed: the scenario, its options, and the load addresses. */
export interface RunRequest {
  readonly scenario: ScenarioName;
  readonly users: number | undefined;
  readonly minutes: number | undefined;
  readonly seed: number | undefined;
  readonly threads: number | undefined;
  /** `LOAD_TEST_BLOCK_LOOP_MS`, a test flag that stalls every harness thread to show such a run is invalid (exit 2). */
  readonly blockLoopMs: number | undefined;
  readonly urls: LoadUrls;
}

const isScenario = (name: string | undefined): name is ScenarioName =>
  (SCENARIO_NAMES as readonly (string | undefined)[]).includes(name);

/** A number above 0, or undefined when not given. */
function count(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw loadRefusal(`Give --${name} as a number above 0.`);
  return parsed;
}

/**
 * Checks a `load:run` command line and its environment, refusing (a
 * `loadRefusal`, exit 3) an unknown or missing scenario, a bad number, or any
 * address that isn't this machine, before the harness is even loaded.
 */
export function preflightRun(args: readonly string[], env: Readonly<Record<string, string | undefined>>): RunRequest {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      users: { type: 'string' },
      minutes: { type: 'string' },
      seed: { type: 'string' },
      threads: { type: 'string' },
    },
  });
  const [scenario] = positionals;
  if (!isScenario(scenario)) {
    throw loadRefusal(`Name a scenario: ${SCENARIO_NAMES.join(', ')} (got "${scenario ?? ''}").`);
  }
  const seed = count(values.seed, 'seed');
  return {
    scenario,
    users: count(values.users, 'users'),
    minutes: count(values.minutes, 'minutes'),
    seed: seed === undefined ? undefined : Math.floor(seed),
    threads: count(values.threads, 'threads'),
    blockLoopMs: count(env.LOAD_TEST_BLOCK_LOOP_MS, 'LOAD_TEST_BLOCK_LOOP_MS'),
    urls: loadUrls(env),
  };
}
