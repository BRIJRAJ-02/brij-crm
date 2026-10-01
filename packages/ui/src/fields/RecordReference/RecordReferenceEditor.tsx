import type { RecordRefDisplay, RecordReferenceValue } from '@crm/contracts/values';
import { useState } from 'react';
import { ReferencePicker } from '../ReferencePicker.tsx';
import type { EditorProps } from '../types.ts';
import { asList, toCommittable } from '../values.ts';
import { recordDisplayOf } from './RecordReferenceDisplay.tsx';

const keyOf = (display: RecordRefDisplay) => `${display.objectId}:${display.recordId}`;

/** Record reference: "Choose record", a searchable, virtualised Menu over `onSearch`; many when the relation allows. */
export function RecordReferenceEditor({
  attribute,
  value,
  display,
  surface,
  onCommit,
  onSearch,
  error,
  autoOpen = false,
  startText,
}: EditorProps<'record_reference'>) {
  const displays = asList<RecordRefDisplay>(display);
  const [chosen, setChosen] = useState<readonly (typeof displays)[number][]>(() =>
    asList<RecordReferenceValue>(value).map((record) => recordDisplayOf(record, displays)),
  );
  const [message, setMessage] = useState<string | undefined>(undefined);
  const shown = message ?? error;
  return (
    <ReferencePicker<RecordRefDisplay>
      name={attribute.name}
      chosen={chosen}
      allowMultiple={attribute.allowMultiple}
      keyOf={keyOf}
      isCompact={surface === 'cell' || surface === 'filter'}
      isOpenAtStart={autoOpen}
      {...(startText === undefined ? {} : { startQuery: startText })}
      {...(onSearch === undefined ? {} : { onSearch })}
      {...(shown === undefined ? {} : { error: shown })}
      onChange={(next) => {
        const records = next.map((item) => ({ objectId: item.objectId, recordId: item.recordId }));
        const result = toCommittable<'record_reference'>(
          attribute,
          attribute.allowMultiple ? records : (records[0] ?? null),
        );
        if (!result.ok) {
          setMessage(result.message);
          return;
        }
        setMessage(undefined);
        setChosen(next);
        onCommit(result.value);
      }}
    />
  );
}
