// What the details step may say on its own when the server refuses a booking.
import { isPlainFallback } from '@crm/contracts/plain-words';

/**
 * The answer's sentence for the line above Confirm, when no refused field is
 * one the details step shows. Left out, so the step says its own "That did
 * not go through", when it is the safety net's (it names no field) or when the
 * start was refused (its sentence is written for developers, not visitors).
 */
export function refusalLine(message: string, fields: Readonly<Record<string, string>>): string | undefined {
  return fields.start === undefined && !isPlainFallback(message) ? message : undefined;
}
