import type { AttributeDefinition, MemberSummary, ObjectSummary, RecordView } from '@crm/data';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { DuplicateBanner } from './DuplicateBanner.tsx';
import { DUPLICATE_CHECK_DELAY_MS, matchedValues } from './matched.ts';

/** Props for a record page's duplicate banner. */
export interface RecordDuplicateBannerProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly record: RecordView;
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
}

/**
 * The record page's banner (AC-4906), asked again 300 ms after the last change to the values a rule reads (its name,
 * email, domain, a person's Company), so an edit on the page that makes it look like another record says so there
 * (AC-4904's check on the record page).
 */
export function RecordDuplicateBanner({ slug, object, record, attributes, members }: RecordDuplicateBannerProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const now = JSON.stringify(matchedValues(attributes, record.values, object.standardKey));
  const [asked, setAsked] = useState(now);
  useEffect(() => {
    if (now === asked) return undefined;
    const timer = setTimeout(() => {
      setAsked(now);
    }, DUPLICATE_CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [now, asked]);
  // A new read each time the values a rule reads settle: `asked` is part of what is held, so it keys the read.
  const held = useMemo(
    () => ({ asked, pairs: data.records.duplicates.pairs(slug, object.id, record.id) }),
    [data, slug, object.id, record.id, asked],
  );
  const { pairs } = held;
  return (
    <DuplicateBanner
      slug={slug}
      object={object}
      recordId={record.id}
      pairs={pairs}
      attributes={attributes}
      members={members}
    />
  );
}
