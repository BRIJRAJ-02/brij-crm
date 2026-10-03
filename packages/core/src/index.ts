// Domain services, shared by the api and the worker. No HTTP in here.
// One folder per feature; the access door (spec 0005, thin #9) is `access/`.
export { getSystemStatus, type SystemDeps } from './system/status.ts';
export * from './engine/index.ts';
export { enterWorkspace, type DoorDeps, type DoorInput } from './access/door.ts';
