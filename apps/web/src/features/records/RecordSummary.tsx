// Brief
// Purpose: a record at a glance under its name, in the panel and on the page (owner, 31 Oct): who it is and how to reach it.
// Main task: read the key facts (job title, company, email, phone) and act at once: Email, Call, Log activity, Add task.
// Leaves out: every other attribute (Details holds them), and any fact with nothing in it.
import { toFieldAttribute, type AttributeDefinition, type NameState, type RecordRef, type RecordView } from '@crm/data';
import { AttributeDisplay, Button, ButtonLink, RecordFacts, Tooltip, type IconName, type RecordFact } from '@crm/ui';
import { isFilled, refsOf } from './details.ts';
import { displayOf } from './RecordDetails.tsx';
import { strings } from './strings.ts';

/** At most this many facts, so the line stays one glance long. */
const MAX_FACTS = 4;

/** A list value's first item only (the first email of several): a glance, not the whole list. */
const firstOf = (value: unknown): unknown => (Array.isArray(value) ? value.slice(0, 1) : value);

/** The first live attribute of a type, by position, with a value on this record. */
function firstFilled(
  attributes: readonly AttributeDefinition[],
  record: RecordView,
  match: (attribute: AttributeDefinition) => boolean,
): AttributeDefinition | undefined {
  return attributes
    .filter((attribute) => !attribute.isArchived && !attribute.isPrimary && match(attribute))
    .toSorted((a, b) => a.position - b.position)
    .find((attribute) => isFilled(record.values[attribute.id]));
}

/** Which attribute a fact takes, and its icon. */
interface FactPick {
  readonly id: string;
  readonly icon?: IconName;
  readonly match: (attribute: AttributeDefinition) => boolean;
}

/** The first email address and phone number on a record, for Email and Call. */
export function contactOf(
  attributes: readonly AttributeDefinition[],
  record: RecordView,
): { readonly email?: string; readonly phone?: string } {
  const emailAttribute = firstFilled(attributes, record, (each) => each.type === 'email');
  const phoneAttribute = firstFilled(attributes, record, (each) => each.type === 'phone');
  const email = emailAttribute === undefined ? undefined : firstOf(record.values[emailAttribute.id]);
  const phone = phoneAttribute === undefined ? undefined : firstOf(record.values[phoneAttribute.id]);
  const address = Array.isArray(email) ? (email[0] as unknown) : email;
  const number = Array.isArray(phone) ? (phone[0] as unknown) : phone;
  const phoneText =
    typeof number === 'string'
      ? number
      : typeof number === 'object' && number !== null && typeof (number as { number?: unknown }).number === 'string'
        ? (number as { number: string }).number
        : undefined;
  return {
    ...(typeof address === 'string' ? { email: address } : {}),
    ...(phoneText === undefined ? {} : { phone: phoneText }),
  };
}

/**
 * The facts a record's summary shows, in order: a job title, the record it belongs to (a person's company), an
 * email, a phone, a domain; with none of those (a deal, a custom object), its first stage or select. Each through
 * its field's one display, a list value's first item only.
 */
export function factsOf(
  attributes: readonly AttributeDefinition[],
  record: RecordView,
  referenceDisplays?: (refs: readonly RecordRef[]) => readonly NameState[],
): readonly RecordFact[] {
  const picks: readonly FactPick[] = [
    { id: 'job', icon: 'briefcase', match: (each: AttributeDefinition) => each.apiSlug === 'job_title' },
    {
      id: 'company',
      match: (each: AttributeDefinition) => each.type === 'record_reference' && !each.isMulti,
    },
    { id: 'email', match: (each: AttributeDefinition) => each.type === 'email' },
    { id: 'phone', icon: 'phone', match: (each: AttributeDefinition) => each.type === 'phone' },
    { id: 'domain', match: (each: AttributeDefinition) => each.type === 'domain' },
  ];
  const found = picks.flatMap((pick) => {
    const attribute = firstFilled(attributes, record, pick.match);
    return attribute === undefined ? [] : [{ pick, attribute }];
  });
  const chosen: readonly { readonly pick: FactPick; readonly attribute: AttributeDefinition }[] =
    found.length > 0
      ? found
      : (() => {
          const stage = firstFilled(attributes, record, (each) => each.type === 'status' || each.type === 'select');
          return stage === undefined ? [] : [{ pick: { id: 'stage', match: () => true }, attribute: stage }];
        })();
  return chosen.slice(0, MAX_FACTS).map(({ pick, attribute }) => {
    const value = firstOf(record.values[attribute.id]);
    const refs = attribute.type === 'record_reference' ? refsOf(value) : [];
    const names = refs.length === 0 ? [] : (referenceDisplays?.(refs) ?? []);
    const display = refs.length === 0 ? undefined : refs.map((ref, index) => displayOf(ref, names[index] ?? 'loading'));
    return {
      id: pick.id,
      label: attribute.title,
      ...(pick.icon === undefined ? {} : { icon: pick.icon }),
      content: (
        <AttributeDisplay
          attribute={toFieldAttribute(attribute)}
          value={value as never}
          surface="panel"
          {...(display === undefined ? {} : { display: display })}
        />
      ),
    };
  });
}

/**
 * The record's key facts on one quiet line, or undefined when it has none, so the caller passes nothing and the
 * header keeps its object's name (and the panel no empty row).
 */
export function summaryFacts(
  name: string,
  attributes: readonly AttributeDefinition[],
  record: RecordView,
  referenceDisplays?: (refs: readonly RecordRef[]) => readonly NameState[],
) {
  const facts = factsOf(attributes, record, referenceDisplays);
  return facts.length === 0 ? undefined : <RecordFacts label={strings.facts(name)} facts={facts} />;
}

/** Props for the record's quick actions. */
export interface RecordQuickActionsProps {
  readonly email?: string;
  readonly phone?: string;
  /** Opens Log activity on the record; left out where the person can't add to it. */
  readonly onLog?: () => void;
  /** Opens a new task linked to the record; left out where the person can't add to it. */
  readonly onTask?: () => void;
}

/** Whether the quick actions have anything to show. */
export const hasQuickActions = ({ email, phone, onLog, onTask }: RecordQuickActionsProps): boolean =>
  email !== undefined || phone !== undefined || onLog !== undefined || onTask !== undefined;

/**
 * The record's quick actions: Email and Call as quiet icon buttons when it has an address or a number (they open
 * the mail app and the phone, the address in their tooltip), then Log activity and Add a task, the record's two
 * things to do, when the person may add to it. The one place each lives on the panel and the page.
 */
export function RecordQuickActions(props: RecordQuickActionsProps) {
  const { email, phone, onLog, onTask } = props;
  if (!hasQuickActions(props)) return null;
  return (
    <>
      {email !== undefined && (
        <Tooltip content={strings.emailTo(email)}>
          <ButtonLink variant="ghost" icon="mail" href={`mailto:${email}`} label={strings.emailTo(email)} />
        </Tooltip>
      )}
      {phone !== undefined && (
        <Tooltip content={strings.callNumber(phone)}>
          <ButtonLink variant="ghost" icon="phone" href={`tel:${phone}`} label={strings.callNumber(phone)} />
        </Tooltip>
      )}
      {onLog !== undefined && (
        <Button variant="secondary" icon="pen" onPress={onLog}>
          {strings.logActivity}
        </Button>
      )}
      {onTask !== undefined && (
        <Button variant="secondary" icon="plus" onPress={onTask}>
          {strings.addTask}
        </Button>
      )}
    </>
  );
}
