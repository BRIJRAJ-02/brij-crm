import { oc } from '@orpc/contract';
import * as z from 'zod';

/** Where the code runs: on a laptop, in a pull request's preview, or in production. */
export const AppEnvironment = z.enum(['local', 'preview', 'production']);
/** Where the code runs. */
export type AppEnvironment = z.infer<typeof AppEnvironment>;

/**
 * The sign in methods this deployment offers beyond the email code, so the
 * sign in screen shows only what works (Google needs both of its variables).
 */
export const SignInProviders = z.object({
  google: z.boolean(),
});
/** The sign in methods offered beyond the email code. */
export type SignInProviders = z.infer<typeof SignInProviders>;

/** The status screen's answer: where it runs, whether the database answers and how fast, and how to sign in. */
export const SystemStatus = z.object({
  environment: AppEnvironment,
  database: z.object({
    serverVersion: z.string(),
    latencyMs: z.number().int().nonnegative(),
  }),
  providers: SignInProviders,
  checkedAt: z.iso.datetime(),
});
/** The status screen's answer. */
export type SystemStatus = z.infer<typeof SystemStatus>;

/** Public procedures, open before sign in. */
export const systemContract = {
  status: oc.output(SystemStatus),
};
