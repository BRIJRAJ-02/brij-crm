// Brief
// Purpose: the Roster's team filter (spec 0037, AC-1289): narrow the Team week to one team's people, within whom the
// reader may see.
// Main task: pick a team, or Everyone again.
// Leaves out: several teams at once, and teams of nobody the reader sees (they show no rows, which says so).
import type { DataLayer, TeamView } from '@crm/data';
import { Icon, Select } from '@crm/ui';
import { useEffect, useState } from 'react';
import { teamWeekStrings as words } from './team-week-strings.ts';

/** The filter's value for no team: everyone the reader may see. */
const EVERYONE = '@everyone';

/** The workspace's teams, from the data layer's one cached list (live: a team change reads it again). */
export function useWorkspaceTeams(data: DataLayer, slug: string): readonly TeamView[] {
  const [teams, setTeams] = useState<readonly TeamView[]>([]);
  useEffect(() => {
    let isCurrent = true;
    data.teams.list(slug).then(
      (list) => {
        if (isCurrent) setTeams(list);
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug]);
  return teams;
}

/**
 * The team Select in the Roster's toolbar: Everyone, then each team by name with its head count. Absent while the
 * workspace has no teams, so nothing asks about something that isn't there.
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
        { id: EVERYONE, label: words.everyone, leading: <Icon name="users-round" tone="muted" /> },
        ...teams.map((team) => ({
          id: team.id,
          label: team.name,
          short: team.name,
          description: words.teamSize(team.memberIds.length),
          leading: <Icon name="users" tone="muted" />,
        })),
      ]}
      value={chosen}
      isSearchable={teams.length > 8}
      onChange={(id) => onChange(id === null || id === EVERYONE ? '' : id)}
    />
  );
}
