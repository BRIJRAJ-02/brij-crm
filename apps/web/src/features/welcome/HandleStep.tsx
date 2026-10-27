// Brief
// Purpose: first run's Your link (27 October 2026): the address the person's link page and every booking page
// of theirs starts with, claimed here rather than left for Settings.
// Main task: take the suggested link or type another, then Claim your link; the server has the last word on a
// taken one, which lands on the field.
// Also, optional: a link or two to put on the page, since a page with one booking page on it is a thin page.
// Leaves out: the bio, the picture, the look, sections and ordering (the link page editor), and a skip: Timefix
// is a link.
import { Field, Form } from '@crm/ui';
import { LinksFields, type LinkDraft } from './LinksFields.tsx';
import { handleProblem, HANDLE_MAX } from '@crm/contracts/handles';
import { useState } from 'react';
import { addressAsTyped } from '../address/address.ts';
import { publicBookingHost } from '../booking/links.ts';
import type { WelcomeRefusal } from './refusals.ts';
import { strings } from './strings.ts';

const HANDLE = 'handle';

/** Props for Your link. */
export interface HandleStepProps {
  /** The link as typed; the suggested one to start with. */
  readonly handle: string;
  readonly onHandle: (handle: string) => void;
  /** The link is being claimed. */
  readonly isClaiming: boolean;
  /** The server's last refusals (a taken link lands on the field). */
  readonly refusals: readonly WelcomeRefusal[];
  /** Claims it: called once the link passes the rule here. */
  readonly onClaim: () => void;
  /** The optional links to put on the page, as typed. */
  readonly links: readonly LinkDraft[];
  readonly onLinks: (links: readonly LinkDraft[]) => void;
}

/**
 * Your link: one field after a quiet "timefix.com/", its rule under it, and
 * Claim your link (Enter). The page beside the step shows the address as it
 * is typed, so the thing being named is on screen while it is named.
 */
export function HandleStep({ handle, onHandle, isClaiming, refusals, onClaim, links, onLinks }: HandleStepProps) {
  const [problems, setProblems] = useState<readonly WelcomeRefusal[]>([]);
  const claim = () => {
    const wanted = handle.trim();
    // The rule is the contract's own, so the field says what the server would have.
    const problem = wanted === '' ? strings.handleMissing : handleProblem(wanted);
    const found = problem === undefined ? [] : [{ code: 'INVALID', message: problem, field: HANDLE }];
    setProblems(found);
    if (found.length > 0) return;
    onClaim();
  };
  return (
    <Form<WelcomeRefusal>
      submitLabel={strings.claim}
      busyLabel={strings.claiming}
      isBusy={isClaiming}
      refusals={problems.length > 0 ? problems : refusals}
      fieldFor={(refusal) => refusal.field}
      onSubmit={claim}
    >
      <Field
        label={strings.handleLabel}
        name={HANDLE}
        autoComplete="off"
        isRequired
        maxLength={HANDLE_MAX}
        prefix={`${publicBookingHost()}/`}
        hint={strings.handleHint}
        value={handle}
        onChange={(next) => {
          onHandle(addressAsTyped(next));
        }}
      />
      <LinksFields rows={links} onRows={onLinks} isBusy={isClaiming} />
    </Form>
  );
}
