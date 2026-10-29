// Brief
// Purpose: what each role lets someone do (the owner, 27 October 2026: "letting someone know what access does what"),
// on the Members page and in the Invite dialog.
// Main task: pick a role and read its six areas at a glance (All, Some, None), opening one for the detail.
// Leaves out: changing what a role can do, and custom roles (spec 0037: they have no built in powers to show, so
// someone on one sees the guide open on Member); object, field and record rules.
import { EVERYONE_CAN, rolePowers, type RoleOption } from '@crm/data';
import { RolePowers, SegmentedControl } from '@crm/ui';
import { useState } from 'react';
import { strings } from './members-strings.ts';

/** Props for the role guide. */
export interface RoleGuideProps {
  /** The workspace's roles (`roles.list`), most power first; only the built in ones have powers to show. */
  readonly roles: readonly RoleOption[];
  /** The role shown first, by its id; the last (least power) when unset or unknown. */
  readonly initialRole?: string | undefined;
}

/** Whether the guide has something to show: two or more built in roles to switch between. */
export function hasGuide(roles: readonly RoleOption[]): boolean {
  return roles.filter((option) => option.builtIn !== undefined).length > 1;
}

/** A role switch over that role's powers, area by area, read from the permissions the server enforces. */
export function RoleGuide({ roles, initialRole }: RoleGuideProps) {
  const explained = roles.filter((option) => option.builtIn !== undefined);
  const [chosen, setChosen] = useState(
    explained.some((option) => option.id === initialRole) ? initialRole : explained.at(-1)?.id,
  );
  const option = explained.find((each) => each.id === chosen);
  if (option?.builtIn === undefined) return null;
  return (
    <RolePowers
      label={strings.rolePowers(option.label)}
      header={
        <SegmentedControl
          label={strings.roleGuideRoles}
          segments={explained.map((each) => ({ value: each.id, label: each.label }))}
          value={option.id}
          onChange={setChosen}
        />
      }
      summary={EVERYONE_CAN}
      areas={rolePowers(option.builtIn).map((each) => ({
        id: each.area.id,
        title: each.area.title,
        standing: each.standing,
        held: each.held,
        withheld: each.withheld,
      }))}
    />
  );
}
