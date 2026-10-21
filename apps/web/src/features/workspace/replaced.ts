// The replaced notice (spec 0006, AC-46): someone else's later save replaced a
// value this tab saved. main.tsx raises it, so it is in the first load with
// only its own words; the rest of the workspace's words (strings.ts, which
// spreads these) and undo.ts load with the frame. Pure, so the node tests
// cover it.
import type { ReplacedValue } from '@crm/data';
import type { ToastContent } from '@crm/ui';

/** The replaced notice's words, and who changed a value in words. */
export const replacedStrings = {
  /** Someone else's later save replaced the person's value (AC-46). */
  replaced: (who: string, attribute: string, others: number, record: string) =>
    others === 0
      ? `${who} changed ${attribute} on ${record} just after you, so your value was replaced.`
      : `${who} changed ${attribute} and ${String(others)} more on ${record} just after you, so your values were replaced.`,
  useMine: 'Use mine',
  someone: 'Someone',
  anApiKey: 'An API key',
  anAutomation: 'An automation',
  aForm: 'A form submission',
  aBookingPage: 'A booking page',
} as const;

/**
 * The "your value was replaced" toast (AC-46): who changed what on which
 * record just after the person, with Use mine. It stays until dismissed.
 */
export function replacedToast(replaced: ReplacedValue): ToastContent {
  const who =
    replaced.by.kind === 'api_key'
      ? replacedStrings.anApiKey
      : replaced.by.kind === 'automation'
        ? replacedStrings.anAutomation
        : replaced.by.kind === 'form'
          ? replacedStrings.aForm
          : replaced.by.kind === 'booking'
            ? replacedStrings.aBookingPage
            : replaced.by.name === undefined || replaced.by.name === ''
              ? replacedStrings.someone
              : replaced.by.name;
  return {
    tone: 'danger',
    message: replacedStrings.replaced(who, replaced.attributeTitle, replaced.others, replaced.recordName),
    action: { label: replacedStrings.useMine, onAction: replaced.useMine },
  };
}
