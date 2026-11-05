// The business page's location card (spec 0066, AC-6641, AC-6645): the full address beside its pin, the phone and
// site, then one Directions button to the visitor's own map app (Apple Maps on an Apple device, Google Maps
// elsewhere, the page tells it which) with the other app a press away in a small menu, both in a new tab. No
// embedded map: it would add a tracking origin and a hole in the page's policy.
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Link } from '../../atoms/Link/Link.tsx';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import styles from './BusinessLocation.module.css';
import { strings } from './strings.ts';

/** Which map app Directions opens first: Apple Maps on an Apple device, Google Maps everywhere else. */
export type MapsApp = 'apple' | 'google';

/** The two map apps' addresses for a place. */
export interface DirectionsLinks {
  readonly google: string;
  readonly apple: string;
}

/** Props for BusinessLocation. */
export interface BusinessLocationProps {
  /** The address's lines, as the business wrote them ("12 MG Road", "Bengaluru 560001"). */
  readonly lines: readonly string[];
  readonly phone?: string | undefined;
  /** The two map apps' addresses; absent with no address to go to. */
  readonly directions?: DirectionsLinks | undefined;
  /** The visitor's own map app, first; the other goes in the menu. Google Maps when absent. */
  readonly mapsApp?: MapsApp | undefined;
  /** The business's own site. */
  readonly website?: string | undefined;
}

/** A phone number as a `tel:` address: its digits and a leading plus only. */
const telOf = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** A map app's name. */
export const mapsAppName = (app: MapsApp) => (app === 'apple' ? strings.appleMaps : strings.googleMaps);

/** The address, the phone and site, and Directions with the other map app in a menu. */
export function BusinessLocation({ lines, phone, directions, mapsApp = 'google', website }: BusinessLocationProps) {
  const other: MapsApp = mapsApp === 'apple' ? 'google' : 'apple';
  return (
    <div className={styles.root}>
      {lines.length > 0 && (
        <address className={styles.address}>
          <span className={styles.pin}>
            <Icon name="map-pin" />
          </span>
          <span className={styles.lines}>
            {lines.map((line, index) => (
              <span key={line} className={index === 0 ? styles.first : undefined}>
                {line}
              </span>
            ))}
          </span>
        </address>
      )}
      {(phone !== undefined || website !== undefined) && (
        <ul className={styles.contact}>
          {phone !== undefined && (
            <li>
              <Link href={telOf(phone)} icon="phone" weight="strong">
                {phone}
              </Link>
            </li>
          )}
          {website !== undefined && (
            <li>
              <Link href={website} icon="globe" weight="strong" opensInNewTab>
                {strings.website}
              </Link>
            </li>
          )}
        </ul>
      )}
      {directions !== undefined && (
        <div className={styles.directions}>
          <ButtonLink
            variant="secondary"
            size="touch"
            icon="map"
            href={directions[mapsApp]}
            isExternal
            isFullWidth="center"
            label={strings.directionsNewTab(mapsAppName(mapsApp))}
          >
            {strings.directions}
          </ButtonLink>
          <MenuTrigger>
            <Button variant="secondary" size="touch" icon="chevron-down" label={strings.otherMapApps} />
            <Menu label={strings.otherMapApps} placement="bottom end">
              <MenuItem href={directions[other]} icon="map" isExternal>
                {strings.openIn(mapsAppName(other))}
              </MenuItem>
            </Menu>
          </MenuTrigger>
        </div>
      )}
    </div>
  );
}
