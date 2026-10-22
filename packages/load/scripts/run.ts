// `pnpm load:run <scenario> [--users N] [--minutes M] [--seed S] [--threads T]`
// (spec 0011, AC-197 to AC-205): plays a scenario against the load stack and
// exits 0 when every judged line passes, 1 on a budget miss in a gate
// scenario, 2 when the run is invalid, and 3 when setup is refused. Every
// address comes from the `LOAD_*` variables, each defaulting to the load
// stack, and anything that isn't this machine is refused; the root `.env` is
// never read. The setup checks run before the harness (the database driver,
// the engine, the API client) is imported, so a refusal is quick.
import { runLoadCommand } from '@crm/core/load-local';
import { preflightRun } from '../src/preflight.ts';

await runLoadCommand(async () => {
  const request = preflightRun(process.argv.slice(2), process.env);
  const { runLoad } = await import('../src/run.ts');
  const { result } = await runLoad({
    scenario: request.scenario,
    users: request.users,
    minutes: request.minutes,
    seed: request.seed,
    threads: request.threads,
    env: process.env,
    log: (message) => console.log(message),
    ...(request.blockLoopMs === undefined ? {} : { blockLoopMs: request.blockLoopMs }),
  });
  process.exit(result.exitCode);
});
