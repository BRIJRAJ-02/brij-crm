// The one line an object's Access tab says about its result (spec 0032): who can see and edit the object, in plain
// words, from the same rows the grid shows. Plain TypeScript with no React, so a test can read every case.
import type { ObjectAccessLevel, RecordScope } from '@crm/data';
import { strings } from './teams-strings.ts';

/** One subject's standing, as the summary needs it. */
export interface SummaryStanding {
  readonly level: ObjectAccessLevel;
  readonly records: RecordScope;
}

/** A team with a rule, by name. */
export interface SummaryTeam extends SummaryStanding {
  readonly name: string;
}

/** What the summary reads: the object's plural name, the Member role's standing and each team's. */
export interface SummaryInput {
  /** The object's plural name, "Deals". */
  readonly object: string;
  readonly role: SummaryStanding & { readonly isDefault: boolean };
  readonly teams: readonly SummaryTeam[];
  /** The Guest role's standing (spec 0031, AC-828): said only once a rule shares the object with guests. */
  readonly guest?: SummaryStanding;
}

const LEVEL_RANK: Readonly<Record<ObjectAccessLevel, number>> = { none: 0, read: 1, write: 2 };
/** A broader scope shows more records: a team's over one's own. */
const SCOPE_RANK: Readonly<Record<RecordScope, number>> = { own: 0, team: 1, all: 2 };

/** "Sales", "Sales and Support", "Sales, Support and Ops". */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${strings.summary.and} ${names[names.length - 1] ?? ''}`;
}

/** "Deals", "their own deals", "their team’s deals". */
function recordsOf(scope: RecordScope, object: string): string {
  if (scope === 'all') return object;
  return scope === 'own' ? strings.summary.own(object) : strings.summary.team(object);
}

/** Whether a team's standing opens more than the Member role's: otherwise it grants nothing and the line leaves it out. */
function adds(team: SummaryStanding, role: SummaryStanding): boolean {
  if (team.level === 'none') return false;
  if (LEVEL_RANK[team.level] !== LEVEL_RANK[role.level]) return LEVEL_RANK[team.level] > LEVEL_RANK[role.level];
  return role.level !== 'none' && SCOPE_RANK[team.records] > SCOPE_RANK[role.records];
}

/**
 * The result in one or two short sentences. The Member role at its default says "Everyone can edit Deals." (teams
 * can't add to it); otherwise the role's sentence, and a sentence for each kind of access a team grants beyond it,
 * with a role that sees nothing read last as "Other members can’t see them." Guests a rule shares the object with
 * get one sentence at the end, "Guests can view Deals."; guests with nothing shared are left out.
 */
export function summarizeAccess({ object, role, teams, guest }: SummaryInput): string {
  // Guests see nothing by default, so they are said only when a rule shares the object with them: one sentence.
  const forGuests =
    guest === undefined || guest.level === 'none'
      ? undefined
      : `${strings.summary.guests} ${strings.summary.verbs[guest.level]} ${recordsOf(guest.records, object)}.`;
  const withGuests = (line: string): string => (forGuests === undefined ? line : `${line} ${forGuests}`);
  if (role.isDefault) {
    return forGuests === undefined
      ? strings.summary.everyone(object)
      : withGuests(`${strings.summary.members} ${strings.summary.verbs.write} ${object}.`);
  }
  const granting = teams.filter((team) => adds(team, role));
  const groups = new Map<string, { readonly standing: SummaryStanding; readonly names: string[] }>();
  for (const team of granting) {
    const key = `${team.level}/${team.records}`;
    const group = groups.get(key) ?? { standing: team, names: [] };
    group.names.push(team.name);
    groups.set(key, group);
  }
  const forTeams = [...groups.values()].map(
    ({ standing, names }) =>
      `${listOf(names)} ${strings.summary.verbs[standing.level]} ${recordsOf(standing.records, object)}`,
  );
  const hasTeams = forTeams.length > 0;
  const forRole =
    role.level === 'none'
      ? `${hasTeams ? strings.summary.otherMembers : strings.summary.members} ${strings.summary.verbs.none} ${hasTeams ? strings.summary.them : object}`
      : `${strings.summary.members} ${strings.summary.verbs[role.level]} ${recordsOf(role.records, object)}`;
  const sentences = role.level === 'none' ? [...forTeams, forRole] : [forRole, ...forTeams];
  return withGuests(`${sentences.join('. ')}.`);
}
