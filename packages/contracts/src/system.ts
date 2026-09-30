import { oc } from '@orpc/contract';
import * as z from 'zod';

export const AppEnvironment = z.enum(['local', 'preview', 'production']);
export type AppEnvironment = z.infer<typeof AppEnvironment>;

export const SystemStatus = z.object({
  environment: AppEnvironment,
  database: z.object({
    serverVersion: z.string(),
    latencyMs: z.number().int().nonnegative(),
  }),
  checkedAt: z.iso.datetime(),
});
export type SystemStatus = z.infer<typeof SystemStatus>;

export const systemContract = {
  status: oc.output(SystemStatus),
};
