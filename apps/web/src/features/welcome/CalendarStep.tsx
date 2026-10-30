// Brief
// Purpose: first run's Connect your calendar (spec 0036): meetings onto the people and companies a new member meets.
// Main task: Connect Google Calendar (to Google and back here), or Skip for now; then the last step. Skip is the
// step's clear secondary action, in the same words as Invite your team's (spec 0058, AC-25).
// Leaves out: choosing calendars and sharing (Settings › Calendars), and Outlook until spec 0024 milestone 4.
import { Button, Callout, Tooltip } from '@crm/ui';
import { useEffect, useRef } from 'react';
import type { ConnectResult } from './steps.ts';
import { strings } from './strings.ts';

/** Props for Connect your calendar. */
export interface CalendarStepProps {
  /** What the last connect came back with, if it did. */
  readonly result: ConnectResult | undefined;
  /** Leaves for Google's consent, which comes back to this step. */
  readonly onConnect: () => void;
  /** The browser is on its way to Google. */
  readonly isConnecting: boolean;
  /** Goes on to the last step: Continue once connected, or without a calendar. */
  readonly onFinish: () => void;
}

/**
 * Connect your calendar: what the last connect came back with, then Connect
 * Google Calendar (Google Calendar's mark), Connect Outlook (off: its tooltip
 * says it is coming soon) and Skip for now; once connected, Continue. Focus
 * starts on the first button that works, so Enter does the step.
 */
export function CalendarStep({ result, onConnect, isConnecting, onFinish }: CalendarStepProps) {
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
            isPending={isConnecting}
            onPress={onConnect}
          >
            {isConnecting ? strings.connectingGoogle : strings.connectGoogle}
          </Button>
          {/* Off until Outlook sync arrives (spec 0024, milestone 4); the step's description and its tooltip say so. */}
          <Tooltip content={strings.outlookSoon}>
            <Button size="lg" isFullWidth="center" provider="outlook" isDisabled>
              {strings.connectOutlook}
            </Button>
          </Tooltip>
          <Button variant="ghost" size="lg" isFullWidth="center" onPress={onFinish}>
            {strings.skipForNow}
          </Button>
        </>
      )}
    </>
  );
}
