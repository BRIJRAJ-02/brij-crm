// `pnpm load:run <scenario> [--users N] [--minutes M] [--seed S] [--threads T]`
// (spec 0011, AC-197 to AC-205): plays a scenario against the load stack and
// exits 0 when every judged line passes, 1 on a budget miss in a gate
// scenario, 2 when the run is invalid, and 3 when setup is refused. Every
// address comes from the `LOAD_*` variables, each defaulting to the load
// stack, and anything that isn't this machine is refused; the root `.env` is
// never read.
import { parseArgs } from 'node:util';
import { loadRefusal, runLoadCommand } from '@crm/core/load-local';
import { runLoad } from '../src/run.ts';
import { SCENARIO_NAMES, type ScenarioName } from '../src/scenarios.ts';

const isScenario = (name: string | undefined): name is ScenarioName =>
  (SCENARIO_NAMES as readonly (string | undefined)[]).includes(name);

/** A whole number option, or undefined when not given. */
function count(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw loadRefusal(`Give --${name} as a number above 0.`);
  return parsed;
}

await runLoadCommand(async () => {
  const { values, positionals } = parseArgs({
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
  // A test flag: stalls every harness thread, to show such a run is invalid (exit 2).
  const blockLoopMs = count(process.env.LOAD_TEST_BLOCK_LOOP_MS, 'LOAD_TEST_BLOCK_LOOP_MS');
  const { result } = await runLoad({
    scenario,
    users: count(values.users, 'users'),
    minutes: count(values.minutes, 'minutes'),
    seed: seed === undefined ? undefined : Math.floor(seed),
    threads: count(values.threads, 'threads'),
    env: process.env,
    log: (message) => console.log(message),
    ...(blockLoopMs === undefined ? {} : { blockLoopMs }),
  });
  process.exit(result.exitCode);
});
