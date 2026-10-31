// What the Access tab's grid shows at once for a change, before the server answers (spec 0032, AC-856), and what a
// subject's field rules say about one field. Plain TypeScript with no React, so a test can read every case.
import type {
  FieldRules,
  ObjectAccess,
  ObjectAccessLevel,
  RecordScope,
  RuleField,
  RuleSubject,
  SubjectAccess,
} from '@crm/data';

/** What a subject may do and which records, as the server stores it; `fields` left out keeps its field rules. */
export interface Rule {
  readonly level: ObjectAccessLevel;
  readonly records: RecordScope;
  readonly fields?: FieldRules;
}

/** The role a subject names, as plain text (the roles list grows: Guest), or none for a team. */
export const roleOf = (subject: RuleSubject): string | undefined =>
  subject.type === 'role' ? subject.role : undefined;

/** The key a subject is held under. */
export const keyOf = (subject: RuleSubject): string =>
  subject.type === 'role' ? `role:${subject.role}` : subject.teamId;

/**
 * What the grid shows at once for a change, before the server answers: the subject's new standing, a role at its
 * default again when its rule is cleared, a team with no access gone. A row that is there stays where it is (the
 * person's focus is on it); a team that is new goes in by name, where the server's answer will put it, with
 * `teamNames` saying what each team is called.
 */
export function expected(
  access: ObjectAccess,
  subject: RuleSubject,
  rule: Rule | null,
  teamNames: ReadonlyMap<string, string> = new Map(),
): ObjectAccess {
  const found = access.subjects.find((each) => keyOf(each.subject) === keyOf(subject));
  const people = found?.people ?? 0;
  // What the subject gets with no rule: the server says, so a role added to the roles list needs nothing here.
  const defaultLevel = found?.defaultLevel ?? (subject.type === 'role' ? 'write' : 'none');
  // Field rules: those given, else the ones it has; clearing the rule clears them too.
  const fields: FieldRules = rule === null ? {} : (rule.fields ?? found?.fields ?? {});
  const next: SubjectAccess | undefined =
    subject.type === 'role'
      ? {
          subject,
          level: rule?.level ?? defaultLevel,
          records: rule?.records ?? 'all',
          defaultLevel,
          isDefault:
            rule === null ||
            (rule.level === defaultLevel && rule.records === 'all' && Object.keys(fields).length === 0),
          fields,
          people,
        }
      : rule === null || rule.level === 'none'
        ? undefined
        : { subject, level: rule.level, records: rule.records, defaultLevel, isDefault: false, fields, people };
  if (found !== undefined) {
    return {
      ...access,
      subjects:
        next === undefined
          ? access.subjects.filter((each) => each !== found)
          : access.subjects.map((each) => (each === found ? next : each)),
    };
  }
  if (next === undefined) return access;
  // A new team goes in among the teams by name, after the roles.
  const nameOf = (each: SubjectAccess) =>
    (each.subject.type === 'team' ? (teamNames.get(each.subject.teamId) ?? '') : '').toLowerCase();
  const roles = access.subjects.filter((each) => each.subject.type === 'role');
  const teams = [...access.subjects.filter((each) => each.subject.type === 'team'), next].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b)),
  );
  return { ...access, subjects: [...roles, ...teams] };
}

/** What one field is to a subject: all it may do with the object, read only, or hidden. */
export type FieldState = 'visible' | 'read' | 'hidden';

/** A field's state for a subject at `level`: its rule, never above the object's (view makes every field read only). */
export function fieldState(level: ObjectAccessLevel, fields: FieldRules, fieldId: string): FieldState {
  if (level === 'none') return 'hidden';
  const rule = fields[fieldId];
  if (rule === 'hidden') return 'hidden';
  return rule === 'read' || level === 'read' ? 'read' : 'visible';
}

/** The field rules after one field is set to `state`: visible takes its rule away. A new object, never a change. */
export function withField(fields: FieldRules, fieldId: string, state: FieldState): FieldRules {
  const { [fieldId]: _was, ...rest } = fields;
  return state === 'visible' ? rest : { ...rest, [fieldId]: state };
}

/**
 * The states a field's picker offers: the record's name is never hidden, and a subject who may only view has every
 * field read only already, so Visible would be a lie.
 */
export function fieldChoices(level: ObjectAccessLevel, field: RuleField): readonly FieldState[] {
  const all: readonly FieldState[] = level === 'write' ? ['visible', 'read', 'hidden'] : ['read', 'hidden'];
  return field.isPrimary ? all.filter((state) => state !== 'hidden') : all;
}

/** How many fields a subject limits, among the object's live ones (a rule for a field since archived isn't counted). */
export function limitedCount(fields: FieldRules, live: readonly RuleField[]): number {
  return live.filter((field) => fields[field.id] !== undefined).length;
}
