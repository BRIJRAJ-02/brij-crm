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
  // A member's email first, then their exact name; a name two members share is refused.
  fromText: (text, context) => {
    const one = (written: string): ActorReferenceValue | ReturnType<typeof refuse> => {
      const wanted = written.trim().toLocaleLowerCase();
      const members = context.members?.filter((candidate) => candidate.type === 'member') ?? [];
      const byEmail = members.find((candidate) => candidate.email === wanted);
      if (byEmail !== undefined) return { type: 'member', id: byEmail.id };
      const byName = members.filter((candidate) => candidate.name.toLocaleLowerCase() === wanted);
      const [only] = byName;
      if (byName.length > 1)
        return refuse(`${String(byName.length)} members are called “${written.trim()}”. Paste their email instead.`);
      return only === undefined ? refuse(`No member called “${written.trim()}”.`) : { type: 'member', id: only.id };
    };
    return context.attribute.allowMultiple ? listFromText(text, one) : one(text);
  },
  align: 'start',
  editIn: 'popover',
  closesOnCommit: true,
  width: 'default',
};
