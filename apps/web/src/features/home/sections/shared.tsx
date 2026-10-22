// What Home's sections share: the browser's language for times, and a card's
// failed first read with Try again (the rest of Home untouched).
import { EmptyState } from '@crm/ui';
import { strings } from '../strings.ts';

/** The browser's language, the one Bookings formats times in. */
export const locale = () => navigator.languages[0] ?? 'en-GB';

/** A section's first read failed: its words and Try again. */
export function Failed({
  title,
  message,
  onRetry,
}: {
  readonly title: string;
  readonly message?: string;
  readonly onRetry: () => void;
}) {
  return (
    <EmptyState tone="error" title={title} onRetry={onRetry} layout="row">
      {message ?? strings.failedText}
    </EmptyState>
  );
}
