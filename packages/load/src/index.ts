// The load harness (spec 0011): `pnpm load:run` plays a scenario through the
// real API and prints how reads, writes and the server did against
// `SCALE_BUDGET`. Its command is `scripts/run.ts`; this is what other tools
// (and its tests) reach.
export { runLoad, type RunOptions } from './run.ts';
export { LoadResult, type ReportLine } from './result.ts';
export { SCENARIOS, SCENARIO_NAMES, type ScenarioName } from './scenarios.ts';
