// Brief
// Purpose: the sidebar Business group's switcher (spec 0065 H7, AC-6517): which business every hospitality screen shows.
// Main task: see the business you are in, and switch to another in two presses.
// Leaves out: adding or removing a business (Settings › Business), and anything at all while there is only one.
import type { DataLayer, HospitalityHeld, HospitalityStore, PropertiesView } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { Menu, MenuItem, MenuTrigger, NavItem, useToasts } from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { switchStrings as strings } from './switch-strings.ts';

const LOADING = { status: 'loading' } as const;

/** Nothing held yet (the store still loading): loading, which draws no switcher. */
const NOT_HELD: HospitalityHeld<never> = {
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING,
  retain: () => () => undefined,
  retry: () => undefined,
};

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
  const [store, setStore] = useState<HospitalityStore | undefined>(undefined);
  useEffect(() => {
    let isLive = true;
    data.hospitality.load().then(
      (loaded) => {
        if (isLive) setStore(loaded);
      },
      // The store's code failed to load: no switcher, as with one business.
      () => undefined,
    );
    return () => {
      isLive = false;
    };
  }, [data]);
  const listed = useHospitality<PropertiesView>(store === undefined ? NOT_HELD : store.properties(slug));
  const toasts = useToasts();
  const choice = useHospitality<string | undefined>(store === undefined ? NOT_HELD : store.choice(slug));
  // A new choice, from here or from Settings › Business, reads the open page again, so its loader reads the business
  // now chosen: Menus, Design and the other hospitality screens follow it (AC-6517).
  const router = useRouter();
  const chosen = choice.status === 'ready' ? (choice.value ?? '') : undefined;
  const last = useRef(chosen);
  useEffect(() => {
    if (chosen === undefined) return;
    const was = last.current;
    last.current = chosen;
    if (was !== undefined && was !== chosen) void router.invalidate();
  }, [chosen, router]);
  if (store === undefined || listed.status !== 'ready' || listed.value.properties.length < 2) return null;
  const { properties } = listed.value;
  const current = (choice.status === 'ready' ? choice.value : undefined) ?? properties[0]?.id;
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
