import { systemContract } from './system.ts';

export * from './errors.ts';
export * from './system.ts';
export * from './values/index.ts';

// The one contract the web app, the API and the worker share.
// Each feature adds its own namespace here.
export const contract = {
  system: systemContract,
};
