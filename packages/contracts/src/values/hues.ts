import * as z from 'zod';
import { HUES } from './hue-list.ts';

/** One of the nine data hues, as a schema. The list itself is `HUES`, in `hue-list.ts`. */
export const Hue = z.enum(HUES, { error: 'Pick one of the nine hues.' });
export type Hue = z.infer<typeof Hue>;
