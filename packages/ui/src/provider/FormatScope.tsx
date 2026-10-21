import { useMemo, type ReactNode } from 'react';
import type { DateFormat } from '../lib/format.ts';
import type { WeekStart } from '../lib/month.ts';
import { FormatContext, useFormatSettings, type FormatSettings } from './context.ts';

/** Props for FormatScope: what to change for the screens inside it; anything absent keeps the outer value. */
export interface FormatScopeProps {
  /** An IANA zone; absent keeps the outer one (the browser's). */
  readonly timeZone?: string | undefined;
  readonly dateFormat?: DateFormat | undefined;
  readonly weekStart?: WeekStart | undefined;
  readonly children: ReactNode;
}

/**
 * Changes the time zone, date format or week start for everything inside it,
 * over UiProvider's: a workspace wraps its pages in one with the member's
 * preferences, so every date, calendar and "today" inside follows them.
 */
export function FormatScope({ timeZone, dateFormat, weekStart, children }: FormatScopeProps) {
  const outer = useFormatSettings();
  const settings = useMemo<FormatSettings>(
    () => ({
      ...outer,
      ...(timeZone === undefined ? {} : { timeZone }),
      ...(dateFormat === undefined ? {} : { dateFormat }),
      ...(weekStart === undefined ? {} : { weekStart }),
    }),
    [outer, timeZone, dateFormat, weekStart],
  );
  return <FormatContext value={settings}>{children}</FormatContext>;
}
