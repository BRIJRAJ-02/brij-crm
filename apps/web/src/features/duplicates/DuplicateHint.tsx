// Brief
// Purpose: say, under the field just filled, that a record like this one already exists (spec 0049, AC-4904).
// Main task: see who it is and open them in a new tab, without losing what is typed; saving is never blocked.
// Leaves out: Merge (a record not made yet has nothing to merge), and any match the reader can't see.
import type { DuplicateCheckState } from '@crm/data';
import { Callout, Link, RecordChipList } from '@crm/ui';
import { recordHref } from '../records/details.ts';
import { strings } from './strings.ts';

/** Props for the hint under a field. */
export interface DuplicateHintProps {
  readonly slug: string;
  /** The object's API name, for the matches' addresses (they are always of the same object). */
  readonly objectSlug: string;
  readonly state: DuplicateCheckState;
}

/**
 * Up to 3 likely matches under the field: one names itself with its reason and Open; several show as chips, each
 * opening its record. Nothing at all while nothing matches, so the form never shifts for an empty hint.
 */
export function DuplicateHint({ slug, objectSlug, state }: DuplicateHintProps) {
  const { matches } = state;
  const [first] = matches;
  if (first === undefined) return null;
  const href = (recordId: string) => recordHref(slug, objectSlug, recordId);
  const nameOf = (name: string) => (name === '' ? strings.unnamed : name);
  if (matches.length === 1) {
    return (
      <Callout
        tone="warning"
        isAnnounced
        title={strings.exists(nameOf(first.record.name))}
        actions={
          <Link href={href(first.record.recordId)} opensInNewTab>
            {strings.open}
          </Link>
        }
      >
        {strings.reason[first.reason]}
      </Callout>
    );
  }
  return (
    <Callout tone="warning" isAnnounced title={strings.existMany(matches.length)}>
      <RecordChipList
        label={strings.existMany(matches.length)}
        emptyTitle=""
        records={matches.map((match) => ({ display: match.record, href: href(match.record.recordId) }))}
      />
    </Callout>
  );
}
