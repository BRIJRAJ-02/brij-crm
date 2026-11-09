// The business page's one call to action (spec 0066, AC-6642). Open, it is Reserve a table, a link to the place's
// reservation page. At a business's own address with two or more places taking reservations, Reserve asks for the
// place first (spec 0065 H7, AC-6593): a menu of the places, each going to its own reservation page. Until reservations
// open it is never a dead end: Call to book when the place has a phone, else Directions, so a guest always has one
// real next step.
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { strings } from './strings.ts';

/** One place Reserve can go to, by name. */
export interface BusinessReservePlace {
  readonly name: string;
  readonly href: string;
}

/**
 * Reserve a table's state: `open` with the place's reservation page, `choose` with two or more places to pick from
 * first, or `soon` until reservations open.
 */
export type BusinessReserveState =
  | { readonly kind: 'open'; readonly href: string }
  | { readonly kind: 'choose'; readonly places: readonly BusinessReservePlace[] }
  | { readonly kind: 'soon' };

/** The one action the page offers: what it says, where it goes, and whether it leaves the page. */
export interface BusinessAction {
  readonly kind: 'reserve' | 'call' | 'directions';
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
  /** Opens in a new tab (Directions, in the visitor's map app). */
  readonly isExternal: boolean;
  /** The fuller name an outward action is heard by ("Directions in Apple Maps (opens in a new tab)"). */
  readonly fullName?: string;
  /** Reserve's places to pick from first (two or more); `href` is then the first's. */
  readonly places?: readonly BusinessReservePlace[];
}

/** A phone number as a `tel:` address: its digits and a leading plus only. */
import { telOf } from '../../lib/tel.ts';

export { telOf };

/**
 * The page's one action (AC-6642): Reserve a table once the flow is open; until then Call to book with a phone, else
 * Directions; nothing at all without Table seating, or with neither a phone nor an address to go to.
 */
export function businessAction(
  reserve: BusinessReserveState | undefined,
  phone: string | undefined,
  directions: string | undefined,
  /** The map app `directions` opens, by name; Google Maps when absent. */
  mapsName: string = strings.googleMaps,
): BusinessAction | undefined {
  if (reserve === undefined) return undefined;
  if (reserve.kind === 'open') {
    return { kind: 'reserve', label: strings.reserve, href: reserve.href, icon: 'calendar-clock', isExternal: false };
  }
  const [first] = reserve.kind === 'choose' ? reserve.places : [];
  if (reserve.kind === 'choose' && first !== undefined) {
    return {
      kind: 'reserve',
      label: strings.reserve,
      href: first.href,
      icon: 'calendar-clock',
      isExternal: false,
      ...(reserve.places.length > 1 ? { places: reserve.places } : {}),
    };
  }
  const digits = phone?.replace(/[^\d]/g, '') ?? '';
  if (phone !== undefined && digits.length >= 3) {
    return { kind: 'call', label: strings.callToBook, href: telOf(phone), icon: 'phone', isExternal: false };
  }
  if (directions !== undefined) {
    return {
      kind: 'directions',
      label: strings.directions,
      href: directions,
      icon: 'map',
      isExternal: true,
      fullName: strings.directionsNewTab(mapsName),
    };
  }
  return undefined;
}

/** Props for BusinessReserve. */
export interface BusinessReserveProps {
  readonly action: BusinessAction;
}

/** The page's one action, full width, a thumb's height; with places to pick, a menu of them first. */
export function BusinessReserve({ action }: BusinessReserveProps) {
  if (action.places !== undefined && action.places.length > 1) {
    return (
      <MenuTrigger>
        <Button variant="primary" size="touch" icon={action.icon} isFullWidth="center">
          {action.label}
        </Button>
        <Menu label={strings.reserveWhere} width="trigger" placement="top">
          {action.places.map((place) => (
            <MenuItem key={place.href} id={place.href} href={place.href} icon="map-pin">
              {place.name}
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
    );
  }
  return (
    <ButtonLink
      variant="primary"
      size="touch"
      icon={action.icon}
      href={action.href}
      isFullWidth="center"
      {...(action.isExternal ? { isExternal: true } : {})}
      {...(action.fullName === undefined ? {} : { label: action.fullName })}
    >
      {action.label}
    </ButtonLink>
  );
}
