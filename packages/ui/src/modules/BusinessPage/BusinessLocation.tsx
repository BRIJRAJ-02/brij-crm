// The business page's location (spec 0066, AC-6641, AC-6645): the full address, the phone, and Directions to the
// visitor's own map app (Google or Apple Maps), in a new tab. No embedded map: it would add a tracking origin and a
// hole in the page's policy.
import { ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import styles from './BusinessLocation.module.css';
import { strings } from './strings.ts';

/** Props for BusinessLocation. */
export interface BusinessLocationProps {
  /** The address's lines, as the business wrote them ("12 MG Road", "Bengaluru 560001"). */
  readonly lines: readonly string[];
  readonly phone?: string | undefined;
  /** The two map apps' addresses; absent with no address to go to. */
  readonly directions?: { readonly google: string; readonly apple: string } | undefined;
  /** The business's own site. */
  readonly website?: string | undefined;
}

/** A phone number as a `tel:` address: its digits and a leading plus only. */
const telOf = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** The address, the phone and the two Directions buttons. */
export function BusinessLocation({ lines, phone, directions, website }: BusinessLocationProps) {
  return (
    <div className={styles.root}>
      {lines.length > 0 && (
        <address className={styles.address}>
          <Icon name="map-pin" />
          <span className={styles.lines}>
            {lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        </address>
      )}
      {(phone !== undefined || website !== undefined) && (
        <ul className={styles.contact}>
          {phone !== undefined && (
            <li>
              <a className={styles.link} href={telOf(phone)} aria-label={strings.call(phone)}>
                <Icon name="phone" />
                {phone}
              </a>
            </li>
          )}
          {website !== undefined && (
            <li>
              <a
                className={styles.link}
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={strings.websiteNewTab}
              >
                <Icon name="globe" />
                {strings.website}
              </a>
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
            href={directions.google}
            isExternal
            label={strings.directionsNewTab(strings.googleMaps)}
          >
            {strings.googleMaps}
          </ButtonLink>
          <ButtonLink
            variant="secondary"
            size="touch"
            icon="map"
            href={directions.apple}
            isExternal
            label={strings.directionsNewTab(strings.appleMaps)}
          >
            {strings.appleMaps}
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
