// Brief
// Purpose: tell someone on a record page that it looks like another record (spec 0049, AC-4906).
// Main task: one pair: Merge (the merge dialog) or Not a duplicate in place; several: Review opens the Duplicates
// page for this record.
// Leaves out: pairs whose other record the reader can't see (they never arrive), and anything while it loads.
import type { AttributeDefinition, DuplicatePairsList, MemberSummary, ObjectSummary } from '@crm/data';
import { useDuplicatePairs } from '@crm/data/react';
import { Button, ButtonLink, Callout, Link } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { recordHref } from '../records/details.ts';
import { focusTitle } from '../navigation/focus-title.ts';
import { useMergeDialog } from './merge/index.ts';
import { duplicatesHref } from './paths.ts';
import { strings } from './strings.ts';
import { useDismiss } from './useDismiss.ts';

/** Props for a record page's banner. */
export interface DuplicateBannerProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly recordId: string;
  /** The record's pairs, from `data.records.duplicates.pairs(slug, objectId, recordId)`. */
  readonly pairs: DuplicatePairsList;
  /** The object's attributes and the members, for the merge dialog's values. */
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
}

/**
 * The banner, or nothing when the record has no likely pair. Merge (for a reader who may change the object) opens
 * the merge dialog on the pair (AC-4906, AC-4910): a merge that took this record away goes on to the kept one, one
 * that kept it reads its pairs again.
 */
export function DuplicateBanner({ slug, object, recordId, pairs, attributes, members }: DuplicateBannerProps) {
  const now = useDuplicatePairs(pairs);
  // While a fresh read is out (after an edit), the last answer stays, so the banner never blinks out and back.
  const [state, setShown] = useState(now);
  if (now !== state && (now.status === 'ready' || state.status !== 'ready')) setShown(now);
  const dismiss = useDismiss(pairs);
  const navigate = useNavigate();
  const merging = useMergeDialog({
    slug,
    object,
    attributes,
    members,
    onMerged: ({ keptId, mergedId }) => {
      if (mergedId === recordId) {
        void navigate({ href: recordHref(slug, object.apiSlug, keptId), replace: true });
        return;
      }
      pairs.retry();
      focusTitle();
    },
    onCancel: focusTitle,
  });
  return (
    <>
      {bannerOf()}
      {merging.dialog}
    </>
  );

  function bannerOf() {
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
    const canWrite = object.access === 'write';
    return (
      <Callout
        tone="warning"
        placement="banner"
        {...(canWrite
          ? {
              actions: (
                <>
                  <Button
                    variant="secondary"
                    onPress={() => {
                      merging.open([recordId, other.recordId]);
                    }}
                  >
                    {strings.merge}
                  </Button>
                  <Button
                    variant="ghost"
                    onPress={() => {
                      dismiss(pair);
                    }}
                  >
                    {strings.notDuplicate}
                  </Button>
                </>
              ),
            }
          : {})}
      >
        {strings.possibleOfLead}
        <Link href={recordHref(slug, object.apiSlug, other.recordId)}>
          {other.name === '' ? strings.unnamed : other.name}
        </Link>
        {` · ${strings.reason[pair.reason]}`}
      </Callout>
    );
  }
}
