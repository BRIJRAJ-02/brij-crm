import type { RecordReferenceValue, RecordRefDisplay } from '@crm/contracts/values';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { ChipRow, EmptyValue } from '../parts.tsx';
import { strings } from '../strings.ts';
import type { DisplayProps } from '../types.ts';
import { asList } from '../values.ts';

/** A linked record's chip, or a skeleton in its place while its name is on its way (an empty name). */
function chipFor(display: RecordRefDisplay, isFlat: boolean) {
  if (display.name !== '') return <RecordChip display={display} isFlat={isFlat} />;
  return (
    <>
      <Skeleton width="short" />
      <VisuallyHidden>{strings.loadingName}</VisuallyHidden>
    </>
  );
}

/** The display shape for a linked record: the data layer's, or a stand in when none came. */
export function recordDisplayOf(value: RecordReferenceValue, displays: readonly RecordRefDisplay[]): RecordRefDisplay {
  return (
    displays.find((display) => display.objectId === value.objectId && display.recordId === value.recordId) ?? {
      objectId: value.objectId,
      recordId: value.recordId,
      name: strings.unknown,
      kind: 'other',
    }
  );
}

/**
 * Record reference: a RecordChip, or a row of them with "+N" when the relation
 * holds many. A display with no name yet (the data layer is reading it) draws
 * a skeleton chip, read as "Loading", never "Unknown".
 */
export function RecordReferenceDisplay({
  attribute,
  value,
  display,
  surface,
  maxVisible,
}: DisplayProps<'record_reference'>) {
  const records = asList<RecordReferenceValue>(value);
  if (records.length === 0) return <EmptyValue surface={surface} />;
  const displays = asList<RecordRefDisplay>(display);
  return (
    <ChipRow
      label={attribute.name}
      {...(maxVisible === undefined ? {} : { maxVisible })}
      chips={records.map((record) => ({
        key: `${record.objectId}:${record.recordId}`,
        node: chipFor(recordDisplayOf(record, displays), surface === 'card'),
      }))}
    />
  );
}
