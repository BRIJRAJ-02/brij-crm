import * as z from 'zod';

/** Parses the variables a script needs, or exits with each problem named. */
export function scriptEnv<T extends z.ZodRawShape>(shape: T): z.infer<z.ZodObject<T>> {
  const result = z.object(shape).safeParse(process.env);
  if (!result.success) {
    console.error(`Missing or invalid variables:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data;
}
