// Installs the plain words (`plain-words.ts`) as Zod's message map, for
// every schema that sets no message of its own.
//
// `@crm/contracts/plain-errors`: it imports only Zod's tiny core config, so the
// browser's first load can install it without loading the schema library.
import { config } from 'zod/v4/core';
import { plainIssueMessage } from './plain-words.ts';

export { isPlainFallback, PLAIN_ERRORS, plainIssueMessage } from './plain-words.ts';

/**
 * Makes `plainIssueMessage` Zod's message for every schema that sets none, in
 * this process or page. Each entry calls it once before it validates
 * anything: the API's `createApp`, the worker and the web app's `main.tsx`.
 * Calling it again changes nothing.
 */
export function installPlainErrors(): void {
  config({ customError: plainIssueMessage });
}
