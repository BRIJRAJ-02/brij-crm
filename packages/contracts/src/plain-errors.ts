// Installs the plain words (`plain-words.ts`) as Zod's message map, for
// every schema that sets no message of its own.
//
// `@crm/contracts/plain-errors`: no Zod at run time. Zod keeps its config in
// one object on `globalThis` (`__zod_globalConfig`, which `config()` in
// zod/v4/core reads and writes, so every copy of Zod in a process shares it).
// Setting it there directly does what `z.config({ customError })` does, before
// or after Zod loads, without pulling Zod's core into the browser's first load
// (3.6 kB gzipped). `plain-errors.test.ts` checks Zod still reads it.
import type { $ZodConfig } from 'zod/v4/core';
import { plainIssueMessage } from './plain-words.ts';

export { isPlainFallback, PLAIN_ERRORS, plainIssueMessage } from './plain-words.ts';

/** Where Zod looks for its config; it creates the object itself when nothing set it first. */
type ZodGlobal = typeof globalThis & { __zod_globalConfig?: $ZodConfig };

/**
 * Makes `plainIssueMessage` Zod's message for every schema that sets none, in
 * this process or page. Each entry calls it once before it validates
 * anything: the API's `createApp`, the worker and the web app's `main.tsx`.
 * Calling it again changes nothing.
 */
export function installPlainErrors(): void {
  const scope = globalThis as ZodGlobal;
  // Once Zod loads it keeps this one object for good, so the map goes into it, never into a new one.
  const config = (scope.__zod_globalConfig ??= {});
  Object.assign(config, { customError: plainIssueMessage });
}
