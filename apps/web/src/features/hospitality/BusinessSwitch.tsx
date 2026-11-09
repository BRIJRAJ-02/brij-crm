// Brief
// Purpose: the sidebar Business group's switcher (spec 0065 H7, AC-6517): which business every hospitality screen shows.
// Main task: see the business you are in, and switch to another in two presses.
// Leaves out: adding or removing a business (Settings › Business), and anything at all while there is only one.
import type { DataLayer } from '@crm/data';
import { Menu, MenuItem, MenuTrigger, NavItem, useToasts } from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useHeldBusinesses } from './held-businesses.ts';
import { switchStrings as strings } from './switch-strings.ts';

/** Props for BusinessSwitch. */
export interface BusinessSwitchProps {
  readonly data: DataLayer;
  readonly slug: string;
}

/**
 * The business in use, as the Business group's first row, opening a menu of every business with the one in use
 * checked. Drawn only from two businesses, so a workspace with one never sees the word (AC-6516). The choice stays on
 * this device (the data layer keeps it), and every hospitality screen follows it.
 */
export function BusinessSwitch({ data, slug }: BusinessSwitchProps) {
  const held = useHeldBusinesses(data, slug);
  const toasts = useToasts();
  // A new choice, from here, ⌘K or Settings › Business, reads the open page's loader again for what it shows beside
  // the business's own copy (its name, its places' hours); the screen itself has already moved (AC-6517).
  const router = useRouter();
  const chosen = held === undefined ? undefined : (held.chosen ?? '');
  const last = useRef(chosen);
  useEffect(() => {
    if (chosen === undefined) return;
    const was = last.current;
    last.current = chosen;
    if (was !== undefined && was !== chosen) void router.invalidate();
  }, [chosen, router]);
  if (held === undefined) return null;
  const { store, properties, current } = held;
  const name = properties.find((each) => each.id === current)?.name ?? strings.business;
  return (
    <MenuTrigger>
      <NavItem icon="store" onPress={() => undefined}>
        {name}
      </NavItem>
      <Menu
        label={strings.switchBusiness}
        selectionMode="single"
        selectedKeys={current === undefined ? [] : [current]}
        onAction={(key) => {
          const id = String(key);
          // An open screen with unsaved changes asks first (the store's guard). A switch says where it went, so the
          // page changing under the person is announced, with focus left on the switcher.
          void store.requestChoice(slug, id).then((went) => {
            const next = properties.find((each) => each.id === id)?.name;
            if (went && id !== current && next !== undefined) {
              toasts.toast({ tone: 'info', message: strings.showingNow(next) });
            }
          });
        }}
      >
        {properties.map((property) => (
          <MenuItem key={property.id} id={property.id}>
            {property.name ?? strings.business}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}
