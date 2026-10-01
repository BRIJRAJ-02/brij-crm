import type { ActorDisplay, ActorReferenceValue } from '@crm/contracts/values';
import { withEmpty } from '../operators.ts';
import type { AttributeTypeDef } from '../types.ts';
import { asList, listFromText, refuse } from '../values.ts';
import { ActorReferenceDisplay, actorDisplayOf } from './ActorReferenceDisplay.tsx';
import { ActorReferenceEditor } from './ActorReferenceEditor.tsx';

/** The actor reference type: a member, an API key, an automation or the system. */
export const actorReferenceType: AttributeTypeDef<'actor_reference'> = {
  type: 'actor_reference',
  icon: 'user',
  Display: ActorReferenceDisplay,
  Editor: ActorReferenceEditor,
  operators: () => withEmpty(['is', 'is_any_of', 'is_me']),
  toText: (value, context) => {
    const displays = asList<ActorDisplay>(context.display as ActorDisplay | readonly ActorDisplay[] | undefined);
    return asList<ActorReferenceValue>(value)
      .map((actor) => actorDisplayOf(actor, displays).name)
      .join(', ');
  },
  fromText: (text, context) => {
    const one = (name: string): ActorReferenceValue | ReturnType<typeof refuse> => {
      const wanted = name.trim().toLocaleLowerCase();
      const member = context.members?.find(
        (candidate) => candidate.type === 'member' && candidate.name.toLocaleLowerCase() === wanted,
      );
      return member === undefined ? refuse(`No member called “${name.trim()}”.`) : { type: 'member', id: member.id };
    };
    return context.attribute.allowMultiple ? listFromText(text, one) : one(text);
  },
  align: 'start',
  editIn: 'popover',
};
