// Brief
// Purpose: the Roster's team filter (spec 0037, AC-1289): narrow the Team week to one team's people, within whom the
// reader may see.
// Main task: pick a team, or Everyone again.
// Leaves out: several teams at once, and teams of nobody the reader sees (they show no rows, which says so).
import type { TeamView } from '@crm/data';
import { Icon, Select } from '@crm/ui';
import { teamWeekStrings as words } from './team-week-strings.ts';

/** The filter's value for no team: everyone the reader may see. */
const EVERYONE = '@everyone';

/**
 * The team Select in the Roster's toolbar: Everyone, then each team by name (no head count: the rows show whom the
 * reader may see of it). Absent while the workspace has no teams, so nothing asks about something that isn't there.
 */
export function TeamWeekTeamFilter({
  teams,
  value,
  onChange,
}: {
  readonly teams: readonly TeamView[];
  /** The team shown ('' for everyone). */
  readonly value: string;
  readonly onChange: (teamId: string) => void;
}) {
  if (teams.length === 0) return null;
  // A team deleted while chosen reads as Everyone, and its rows come back.
  const chosen = teams.some((team) => team.id === value) ? value : EVERYONE;
  return (
    <Select
      label={words.teamFilter}
      isLabelHidden
      size="sm"
      items={[
        { id: EVERYONE, label: words.everyone, leading: <Icon name="users" tone="muted" /> },
        ...teams.map((team) => ({
          id: team.id,
          label: team.name,
          leading: <Icon name="users-round" tone="muted" />,
        })),
      ]}
      value={chosen}
      isSearchable={teams.length > 8}
      onChange={(id) => onChange(id === null || id === EVERYONE ? '' : id)}
    />
  );
}
