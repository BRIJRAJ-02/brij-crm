// Brief
// Purpose: say, under the record's name, that a record like this one already exists (spec 0049, AC-4904).
// Main task: see who it is and open them in a new tab, without losing what is typed; saving is never blocked.
// Leaves out: Merge (a record not made yet has nothing to merge), and any match the reader can't see.
import type { DuplicateCheckState } from '@crm/data';
import { Callout, Link } from '@crm/ui';
import { Fragment } from 'react';
import { recordHref } from '../records/details.ts';
import { strings } from './strings.ts';

/** Props for the hint under the name. */
export interface DuplicateHintProps {
  readonly slug: string;
  /** The object's API name, for the matches' addresses (they are always of the same object). */
  readonly objectSlug: string;
  readonly state: DuplicateCheckState;
}

/**
 * Up to 3 likely matches, each a link that opens its record in a new tab (the draft stays) and its reason. Nothing
 * while nothing matches or a check is out, so the form never shows an older field's matches.
 */
export function DuplicateHint({ slug, objectSlug, state }: DuplicateHintProps) {
  if (state.status !== 'ready') return null;
  const { matches } = state;
  const [first] = matches;
  if (first === undefined) return null;
  const nameOf = (name: string) => (name === '' ? strings.unnamed : name);
  return (
    <Callout
      tone="warning"
      isAnnounced
      title={matches.length === 1 ? strings.exists(nameOf(first.record.name)) : strings.existMany(matches.length)}
    >
      {matches.length === 1 ? (
        <>
          {`${strings.reason[first.reason]} · `}
          <Link href={recordHref(slug, objectSlug, first.record.recordId)} opensInNewTab>
            {strings.open}
          </Link>
        </>
      ) : (
        matches.map((match, index) => (
          <Fragment key={match.record.recordId}>
            {index > 0 && ' · '}
            <Link href={recordHref(slug, objectSlug, match.record.recordId)} opensInNewTab>
              {nameOf(match.record.name)}
            </Link>
            {` ${strings.reason[match.reason]}`}
          </Fragment>
        ))
      )}
    </Callout>
  );
}
