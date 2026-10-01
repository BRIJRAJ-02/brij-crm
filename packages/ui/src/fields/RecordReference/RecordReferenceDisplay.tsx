import type { RecordReferenceValue, RecordRefDisplay } from '@crm/contracts/values';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { ChipRow, EmptyValue } from '../parts.tsx';
import { strings } from '../strings.ts';
import type { DisplayProps } from '../types.ts';
import { asList } from '../values.ts';

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

/** Record reference: a RecordChip, or a row of them with "+N" when the relation holds many. */
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
        node: <RecordChip display={recordDisplayOf(record, displays)} isFlat={surface === 'card'} />,
      }))}
    />
  );
}
