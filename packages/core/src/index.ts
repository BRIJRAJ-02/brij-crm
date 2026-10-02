// Domain services, shared by the api and the worker. No HTTP in here.
// One folder per feature; the access door (#9) joins as `access/`.
export { getSystemStatus, type SystemDeps } from './system/status.ts';
export * from './engine/index.ts';
