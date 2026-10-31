// Brief
// Purpose: tell someone on a record page that it looks like another record (spec 0049, AC-4906).
// Main task: one pair: Merge or Not a duplicate in place; several: Review opens the Duplicates page for this record.
// Leaves out: pairs whose other record the reader can't see (they never arrive), and anything while it loads.
import type { DuplicatePairsList } from '@crm/data';
import { useDuplicatePairs } from '@crm/data/react';
import { Button, ButtonLink, Callout, Link } from '@crm/ui';
import { useState } from 'react';
import { recordHref } from '../records/details.ts';
import { mergeFor } from './launch.ts';
import { duplicatesHref } from './paths.ts';
import { strings } from './strings.ts';
import { useDismiss } from './useDismiss.ts';

/** Props for a record page's banner. */
export interface DuplicateBannerProps {
  readonly slug: string;
  readonly object: { readonly id: string; readonly apiSlug: string; readonly access: string };
  readonly recordId: string;
  /** The record's pairs, from `data.records.duplicates.pairs(slug, objectId, recordId)`. */
  readonly pairs: DuplicatePairsList;
}

/** The banner, or nothing when the record has no likely pair. */
export function DuplicateBanner({ slug, object, recordId, pairs }: DuplicateBannerProps) {
  const now = useDuplicatePairs(pairs);
  // While a fresh read is out (after an edit), the last answer stays, so the banner never blinks out and back.
  const [state, setShown] = useState(now);
  if (now !== state && (now.status === 'ready' || state.status !== 'ready')) setShown(now);
  const dismiss = useDismiss(pairs);
  if (state.status !== 'ready' || state.pairs.length === 0) return null;
  const [pair] = state.pairs;
  if (pair === undefined) return null;
  if (state.pairs.length > 1 || state.hasMore) {
    return (
      <Callout
        tone="warning"
        placement="banner"
        actions={
          <ButtonLink variant="secondary" href={duplicatesHref(slug, object.apiSlug, recordId)}>
            {strings.review}
          </ButtonLink>
        }
      >
        {strings.possibleMany(state.pairs.length)}
      </Callout>
    );
  }
  const other = pair.a.recordId === recordId ? pair.b : pair.a;
  const launch = mergeFor(object.access);
  return (
    <Callout
      tone="warning"
      placement="banner"
      actions={
        <>
          {launch !== undefined && (
            <Button
              variant="secondary"
              onPress={() => {
                launch({ slug, objectId: object.id, recordIds: [recordId, other.recordId], onMerged: pairs.retry });
              }}
            >
              {strings.merge}
            </Button>
          )}
          {object.access === 'write' && (
            <Button
              variant="ghost"
              onPress={() => {
                dismiss(pair);
              }}
            >
              {strings.notDuplicate}
            </Button>
          )}
        </>
      }
    >
      {strings.possibleOfLead}
      <Link href={recordHref(slug, object.apiSlug, other.recordId)}>
        {other.name === '' ? strings.unnamed : other.name}
      </Link>
      {` · ${strings.reason[pair.reason]}`}
    </Callout>
  );
}
