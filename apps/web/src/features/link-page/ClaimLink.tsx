// Brief
// Purpose: the link page with no handle yet (spec 0058, AC-8): claim the address right here, never a trip to Profile.
// Main task: take the suggested link or type another, then Claim; the page is live at once (AC-23) and the screen
// opens on it.
// Leaves out: the bio, the picture and the rest of Settings › Profile, which a link page doesn't need to start.
import { isDataError, type DataLayer } from '@crm/data';
import { Button, EmptyState, Field, SpotIllustration } from '@crm/ui';
import { handleProblem, HANDLE_MAX } from '@crm/contracts/handles';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { addressAsTyped } from '../address/address.ts';
import { publicBookingHost } from '../booking/links.ts';
import { strings } from './strings.ts';

/** Props for ClaimLink. */
export interface ClaimLinkProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** A free handle made from their name, the field's first value. */
  readonly suggested?: string | undefined;
}

/**
 * The first empty moment of a link page with no address: its drawing, one line, and the address field with Claim
 * beside it on one line, all on the empty state's centre line. The contract's own rule checks the link before
 * anything is sent; the server has the last word (a taken link), which lands on the field. Once claimed, the
 * route reads the profile again and the screen opens on the page.
 */
export function ClaimLink({ data, slug, suggested }: ClaimLinkProps) {
  const router = useRouter();
  const [handle, setHandle] = useState(suggested ?? '');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [isClaiming, setClaiming] = useState(false);
  const claim = () => {
    if (isClaiming) return;
    const wanted = handle.trim();
    const wrong = wanted === '' ? strings.handleMissing : handleProblem(wanted);
    if (wrong !== undefined) {
      setProblem(wrong);
      return;
    }
    setClaiming(true);
    setProblem(undefined);
    data.profile.update(slug, { handle: wanted }).then(
      () => router.invalidate(),
      (error: unknown) => {
        setClaiming(false);
        setProblem(isDataError(error) ? error.message : strings.claimFailed);
      },
    );
  };
  return (
    <EmptyState
      illustration={<SpotIllustration kind="link-page" />}
      title={strings.noHandle}
      actions={
        <Field
          label={strings.handleLabel}
          isLabelHidden
          name="handle"
          autoComplete="off"
          maxLength={HANDLE_MAX}
          prefix={`${publicBookingHost()}/`}
          value={handle}
          isReadOnly={isClaiming}
          onChange={(next) => {
            setHandle(addressAsTyped(next));
            // The reason stops applying the moment the link changes.
            setProblem(undefined);
          }}
          onSubmit={claim}
          {...(problem === undefined ? {} : { error: problem })}
          after={
            <Button variant="primary" isPending={isClaiming} onPress={claim}>
              {isClaiming ? strings.claiming : strings.claim}
            </Button>
          }
        />
      }
    >
      {strings.noHandleText}
    </EmptyState>
  );
}
