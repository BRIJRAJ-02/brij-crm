// What the details step may say on its own when the server refuses a booking.

/**
 * The answer's sentence for the line above Confirm, when no refused field is
 * one the details step shows. Left out, so the step says its own "That did
 * not go through", when it is the safety net's (it names no field) or when the
 * start was refused (its sentence is written for developers, not visitors).
 * The safety net's sentences load only here, after a refusal: the booking page
 * never carries the plain words up front (`build.test.ts`).
 */
export async function refusalLine(
  message: string,
  fields: Readonly<Record<string, string>>,
): Promise<string | undefined> {
  if (fields.start !== undefined) return undefined;
  try {
    const { isPlainFallback } = await import('@crm/contracts/plain-words');
    return isPlainFallback(message) ? undefined : message;
  } catch {
    // Without the list, the step's own sentence is the safe one.
    return undefined;
  }
}
