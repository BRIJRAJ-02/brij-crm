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
  /** The workspace's currency (ISO 4217); absent keeps the language's region's. */
  readonly currency?: string | undefined;
  /** The workspace's country (ISO 3166 alpha 2); absent keeps the language's region. */
  readonly country?: string | undefined;
  readonly children: ReactNode;
}

/**
 * Changes the time zone, date format, week start, currency or country for everything inside it,
 * over UiProvider's: a workspace wraps its pages in one with the member's
 * preferences, so every date, calendar and "today" inside follows them.
 */
export function FormatScope({ timeZone, dateFormat, weekStart, currency, country, children }: FormatScopeProps) {
  const outer = useFormatSettings();
  const settings = useMemo<FormatSettings>(
    () => ({
      ...outer,
      ...(timeZone === undefined ? {} : { timeZone }),
      ...(dateFormat === undefined ? {} : { dateFormat }),
      ...(weekStart === undefined ? {} : { weekStart }),
      ...(currency === undefined ? {} : { currency }),
      ...(country === undefined ? {} : { country }),
    }),
    [outer, timeZone, dateFormat, weekStart, currency, country],
  );
  return <FormatContext value={settings}>{children}</FormatContext>;
}
