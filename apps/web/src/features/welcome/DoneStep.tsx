// Brief
// Purpose: first run's end (27 October 2026): what the run made, so it finishes on the thing it was for rather
// than dropping the person into an empty workspace.
// Main task: copy the link page's address, or open it, then Go to Timefix.
// Leaves out: everything there is to change about the page (its editor), and a step count: there is nothing to do
// here, so it is not a step.
import { Button, ButtonLink, Field } from '@crm/ui';
import { useEffect, useRef } from 'react';
import { publicProfileUrl } from '../booking/links.ts';
import { strings } from './strings.ts';

/** Props for the end. */
export interface DoneStepProps {
  /** The handle claimed on Your link page. */
  readonly handle: string;
  /** Opens the workspace. */
  readonly onGo: () => void;
}

/**
 * The end: the link page's address in a Field to copy, Open your page in a
 * new tab, and Go to Timefix. Focus starts on Go to Timefix, so Enter
 * finishes the run.
 */
export function DoneStep({ handle, onGo }: DoneStepProps) {
  const go = useRef<HTMLButtonElement>(null);
  // Nothing here has to be filled in, so the way on takes focus and Enter ends the run.
  useEffect(() => {
    go.current?.focus();
  }, []);
  const address = publicProfileUrl(handle);
  const shown = address.replace(/^https?:\/\//, '');
  return (
    <>
      {/* The copy variant copies what it shows, so it shows the address a visitor reads, which pastes as a link. */}
      <Field variant="copy" label={strings.doneLink} value={shown} copyLabel={strings.doneCopy} />
      <Button ref={go} variant="primary" size="lg" isFullWidth="center" onPress={onGo}>
        {strings.doneGo}
      </Button>
      <ButtonLink variant="ghost" size="lg" isFullWidth="center" href={address} isExternal icon="arrow-up-right">
        {strings.doneOpen}
      </ButtonLink>
    </>
  );
}
