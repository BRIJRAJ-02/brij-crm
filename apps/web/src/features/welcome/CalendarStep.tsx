// Brief
// Purpose: first run's Connect your calendar (spec 0036): meetings onto the people and companies a new member meets.
// Main task: Connect Google Calendar (to Google and back here), or Skip for now; then the last step. Skip is the
// step's clear secondary action, in the same words as Invite your team's (spec 0058, AC-25).
// Leaves out: choosing calendars and sharing (Settings › Calendars).
import type { CalendarProvider, CalendarView } from '@crm/data';
import { useCalendar } from '@crm/data/react';
import { Button, Callout } from '@crm/ui';
import { useEffect, useRef } from 'react';
import type { ConnectResult } from './steps.ts';
import { strings } from './strings.ts';

/** Props for Connect your calendar. */
export interface CalendarStepProps {
  /** What the last connect came back with, if it did. */
  readonly result: ConnectResult | undefined;
  /** The member's calendar connections here: which providers this deployment offers (Outlook only where it is on). */
  readonly view: CalendarView;
  /** Leaves for the provider's consent, which comes back to this step. */
  readonly onConnect: (provider: CalendarProvider) => void;
  /** The provider the browser is on its way to, if any. */
  readonly connecting: CalendarProvider | undefined;
  /** Goes on to the last step: Continue once connected, or without a calendar. */
  readonly onFinish: () => void;
}

/**
 * Connect your calendar: what the last connect came back with, then Connect
 * Google Calendar (Google Calendar's mark, the one primary), Connect Outlook
 * (only where this deployment offers Outlook; elsewhere not shown) and Skip
 * for now; once connected, Continue. Focus starts on the first button that works, so Enter
 * does the step.
 */
export function CalendarStep({ result, view, onConnect, connecting, onFinish }: CalendarStepProps) {
  const state = useCalendar(view);
  // Outlook works only where the deployment turned it on (CALENDAR_OUTLOOK); while the list loads it isn't shown.
  const isOutlookOn = state.status === 'ready' && state.enabled && state.providers.includes('microsoft');
  const isConnecting = connecting !== undefined;
  const first = useRef<HTMLButtonElement>(null);
  const isConnected = result === 'connected';
  // The step has no field: its first working button takes focus, so Enter connects (or continues once connected).
  useEffect(() => {
    first.current?.focus();
  }, [isConnected]);
  const outcome = result === undefined ? undefined : strings.results[result];
  return (
    <>
      {outcome !== undefined && (
        <Callout tone={outcome.tone} title={outcome.title} isAnnounced>
          {outcome.text}
        </Callout>
      )}
      {isConnected ? (
        <Button ref={first} variant="primary" size="lg" isFullWidth="center" onPress={onFinish}>
          {strings.continue}
        </Button>
      ) : (
        <>
          <Button
            ref={first}
            variant="primary"
            size="lg"
            isFullWidth="center"
            provider="google-calendar"
            isPending={connecting === 'google'}
            isDisabled={isConnecting}
            onPress={() => onConnect('google')}
          >
            {connecting === 'google' ? strings.connectingGoogle : strings.connectGoogle}
          </Button>
          {/* Outlook only where this deployment turned it on: never a dead button (foolproof audit, 5 November 2026). */}
          {isOutlookOn && (
            <Button
              size="lg"
              isFullWidth="center"
              provider="outlook"
              isPending={connecting === 'microsoft'}
              isDisabled={isConnecting}
              onPress={() => onConnect('microsoft')}
            >
              {connecting === 'microsoft' ? strings.connectingOutlook : strings.connectOutlook}
            </Button>
          )}
          <Button variant="ghost" size="lg" isFullWidth="center" onPress={onFinish}>
            {strings.skipForNow}
          </Button>
        </>
      )}
    </>
  );
}
