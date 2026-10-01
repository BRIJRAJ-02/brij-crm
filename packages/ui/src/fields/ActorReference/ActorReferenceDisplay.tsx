import type { ActorDisplay, ActorReferenceValue } from '@crm/contracts/values';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { ChipRow, EmptyValue } from '../parts.tsx';
import { strings } from '../strings.ts';
import type { DisplayProps } from '../types.ts';
import { asList } from '../values.ts';

/** The display shape for an actor: the data layer's, or a stand in with its type when none came. */
export function actorDisplayOf(value: ActorReferenceValue, displays: readonly ActorDisplay[]): ActorDisplay {
  return (
    displays.find((display) => display.type === value.type && display.id === value.id) ?? {
      type: value.type,
      id: value.id,
      name: strings.unknown,
    }
  );
}

/** Actor reference: a RecordChip with the member's avatar, or an API key, automation or the system with their icon. */
export function ActorReferenceDisplay({
  attribute,
  value,
  display,
  surface,
  maxVisible,
}: DisplayProps<'actor_reference'>) {
  const actors = asList<ActorReferenceValue>(value);
  if (actors.length === 0) return <EmptyValue surface={surface} />;
  const displays = asList<ActorDisplay>(display);
  return (
    <ChipRow
      label={attribute.name}
      {...(maxVisible === undefined ? {} : { maxVisible })}
      chips={actors.map((actor) => ({
        key: `${actor.type}:${actor.id ?? ''}`,
        node: <RecordChip display={actorDisplayOf(actor, displays)} isFlat={surface === 'card'} />,
      }))}
    />
  );
}
