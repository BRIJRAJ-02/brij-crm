import { useState } from 'react';
import { RolePowers, type Grants, type PowerArea, type RoleColumn } from './RolePowers.tsx';

const areas: ReadonlyArray<PowerArea> = [
  { id: 'records', title: 'Records', description: 'People, companies and deals', powers: [
    { id: 'records.edit', label: 'Change records' },
    { id: 'records.delete', label: 'Delete records', description: 'Deleted records stay in Trash for 30 days.' },
    { id: 'records.import', label: 'Import and export' },
  ] },
  { id: 'scheduling', title: 'Scheduling', description: 'Booking pages and meetings', powers: [
    { id: 'pages.own', label: 'Make booking pages' },
    { id: 'pages.others', label: "Change other people's booking pages" },
    { id: 'meetings.all', label: "See everyone's meetings" },
  ] },
  { id: 'team', title: 'Team and billing', powers: [
    { id: 'team.invite', label: 'Invite people' },
    { id: 'team.roles', label: 'Change roles' },
    { id: 'billing', label: 'Manage billing' },
  ] },
];

const start: Grants = {
  admin: ['records.edit', 'records.delete', 'records.import', 'pages.own', 'pages.others', 'meetings.all', 'team.invite', 'team.roles'],
  member: ['records.edit', 'pages.own'],
};

export function RolePowersDemo() {
  const [roles, setRoles] = useState<ReadonlyArray<RoleColumn>>([
    { id: 'owner', name: 'Owner', isLocked: true },
    { id: 'admin', name: 'Admin' },
    { id: 'member', name: 'Member' },
  ]);
  const [grants, setGrants] = useState<Grants>(start);
  return (
    <div className="tf-demo">
      <RolePowers areas={areas} roles={roles} grants={grants}
        onChange={(role, power, on) => setGrants((g) => ({ ...g, [role]: on ? [...(g[role] ?? []), power] : (g[role] ?? []).filter((p) => p !== power) }))}
        onAddRole={(name, from) => {
          const id = `custom-${Date.now()}`;
          setRoles((r) => [...r, { id, name, isCustom: true }]);
          setGrants((g) => ({ ...g, [id]: [...(g[from] ?? [])] }));
        }}
        onDeleteRole={(id) => setRoles((r) => r.filter((x) => x.id !== id))} />
    </div>
  );
}
