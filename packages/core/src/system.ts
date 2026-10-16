// `@crm/core/system`: system power (spec 0009, AC-138, AC-147). The system
// actor and its scope, the door that enters a member again for work they
// started, the audiences the relay publishes to, and the view facts it filters
// `views` events by. Lint allows this import only in the worker entry,
// `apps/api/src/jobs/**`, `apps/api/src/realtime/**` and
// `packages/core/scripts/**`.
export { audiences } from './access/audiences.ts';
export { enterAsActor, systemScope, type ActorDoorDeps } from './access/door.ts';
export { SYSTEM_ACTOR } from './engine/scope.ts';
// The daily cleanup's fan out (spec 0008, milestone 3): lists every workspace and starts a system job in each.
export {
  DAILY_BUDGET_MS,
  maintenanceKey,
  runDailyCleanup,
  type DailyCleanupDeps,
  type DailyCleanupInput,
  type DailyCleanupReport,
  type DailySweep,
} from './jobs/daily.ts';
export { viewFacts } from './views/facts.ts';
