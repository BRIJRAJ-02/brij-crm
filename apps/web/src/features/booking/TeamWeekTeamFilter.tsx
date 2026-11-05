// Brief
// Purpose: the Roster's Filter (spec 0037, AC-1289): narrow the Team week to one team's people, within whom the
// reader may see; the Calendar's Filter button and menu, always shown (the bookings critique, A13).
// Main task: pick a team, or Everyone again.
// Leaves out: several teams at once, and teams of nobody the reader sees (they show no rows, which says so).
import type { TeamView } from '@crm/data';
import { Button, Menu, MenuItem, MenuSection, MenuTrigger } from '@crm/ui';
import { teamWeekStrings as words } from './team-week-strings.ts';

/** The filter's value for no team: everyone the reader may see. */
const EVERYONE = '@everyone';

/**
 * Filter in the Roster's toolbar, as the Calendar's: a menu of Everyone, then each team by name (no head count: the
 * rows show whom the reader may see of it). With no teams it holds Everyone alone, so the bar keeps one shape.
 * Filtered, it reads "Filter · 1", with a quiet clear beside it.
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
  // A team deleted while chosen reads as Everyone, and its rows come back.
  const chosen = teams.some((team) => team.id === value) ? value : EVERYONE;
  const isFiltered = chosen !== EVERYONE;
  return (
    <>
      <MenuTrigger>
        <Button icon="list-filter">{isFiltered ? words.filterOn : words.filter}</Button>
        <Menu label={words.teamFilter}>
          <MenuSection
            label={words.filterTeam}
            selectionMode="single"
            selectedKeys={[chosen]}
            onSelectionChange={(keys) => {
              const [id] = [...keys].map(String);
              if (id !== undefined) onChange(id === EVERYONE ? '' : id);
            }}
          >
            <MenuItem id={EVERYONE}>{words.everyone}</MenuItem>
            {teams.map((team) => (
              <MenuItem key={team.id} id={team.id}>
                {team.name}
              </MenuItem>
            ))}
          </MenuSection>
        </Menu>
      </MenuTrigger>
      {isFiltered && (
        <Button
          variant="ghost"
          icon="x"
          label={words.clearFilter}
          onPress={() => {
            onChange('');
          }}
        />
      )}
    </>
  );
}
