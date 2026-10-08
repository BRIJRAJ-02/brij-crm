// `@crm/core/system`: system power (spec 0009, AC-138, AC-147). The system
// actor and its scope, the door that enters a member again for work they
// started, and the audiences the relay publishes to. Lint allows this import
// only in the worker entry, `apps/api/src/jobs/**`, `apps/api/src/realtime/**`
// and `packages/core/scripts/**`.
export { audiences } from './access/audiences.ts';
export { enterAsActor, systemScope, type ActorDoorDeps } from './access/door.ts';
export { SYSTEM_ACTOR } from './engine/scope.ts';
