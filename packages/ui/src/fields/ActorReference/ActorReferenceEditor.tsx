import type { ActorDisplay, ActorReferenceValue } from '@crm/contracts/values';
import { useState } from 'react';
import { ReferencePicker } from '../ReferencePicker.tsx';
import type { EditorProps } from '../types.ts';
import { asList, toCommittable } from '../values.ts';
import { actorDisplayOf } from './ActorReferenceDisplay.tsx';

const keyOf = (display: ActorDisplay) => `${display.type}:${display.id ?? ''}`;

/** Actor reference: a Menu of members, "Me" first, searched through `onSearch`. People can only choose members. */
export function ActorReferenceEditor({
  attribute,
  value,
  display,
  surface,
  onCommit,
  onSearch,
  me,
  error,
}: EditorProps<'actor_reference'>) {
  const displays = asList<ActorDisplay>(display);
  const [chosen, setChosen] = useState<readonly (typeof displays)[number][]>(() =>
    asList<ActorReferenceValue>(value).map((actor) => actorDisplayOf(actor, displays)),
  );
  const [message, setMessage] = useState<string | undefined>(undefined);
  const shown = message ?? error;
  return (
    <ReferencePicker<ActorDisplay>
      name={attribute.name}
      chosen={chosen}
      allowMultiple={attribute.allowMultiple}
      keyOf={keyOf}
      isCompact={surface === 'cell' || surface === 'filter'}
      {...(onSearch === undefined ? {} : { onSearch })}
      {...(me === undefined ? {} : { pinned: [me] })}
      {...(shown === undefined ? {} : { error: shown })}
      onChange={(next) => {
        const members = next
          .filter((item) => item.type === 'member')
          .map((item) => ({ type: 'member' as const, id: item.id }));
        const result = toCommittable<'actor_reference'>(
          attribute,
          attribute.allowMultiple ? members : (members[0] ?? null),
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
