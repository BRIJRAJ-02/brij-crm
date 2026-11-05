// A reservation's party size as checklabs' booking form asks for it: a soft band with "Party size" and "Up to 4
// guests" at its start and one fewer, the count and one more at its end; at the most the page takes online, a line
// under it with the way to book a bigger table ("More than 4? Call 020 7946 0000").
import { useId } from 'react';
import { Link } from '../../atoms/Link/Link.tsx';
import { Stepper } from '../../molecules/Stepper/Stepper.tsx';
import { telOf } from '../BusinessPage/BusinessReserve.tsx';
import styles from './PartyBand.module.css';
import { strings } from './strings.ts';

/** Props for PartyBand. */
export interface PartyBandProps {
  /** The party, between `min` and `max`. */
  readonly value: number;
  /** The fewest guests the page takes online. */
  readonly min: number;
  /** The most guests the page takes online: one more turns off there, and the line under the band shows. */
  readonly max: number;
  readonly onChange: (value: number) => void;
  /** The restaurant's phone, for "More than 4? Call …" at the most; without one the line says to call the restaurant. */
  readonly phone?: string | undefined;
}

/**
 * A reservation's party size (spec 0066 B7, after checklabs' booking form): "Party size" over "Up to {max} guests",
 * and one fewer, the count and one more, in one band; at the most, how to book a bigger table, said politely.
 */
export function PartyBand({ value, min, max, onChange, phone }: PartyBandProps) {
  const labelId = useId();
  const isAtMost = value >= max;
  return (
    <div className={styles.root}>
      <div className={styles.band}>
        <div className={styles.words}>
          <p id={labelId} className={styles.label}>
            {strings.partySize}
          </p>
          <p className={styles.line}>{strings.upTo(max)}</p>
        </div>
        {/* The shared Stepper at its 40px size: the band's own words name it, so its label is for screen readers. */}
        <Stepper
          label={strings.partySize}
          isLabelHidden
          size="md"
          value={value}
          min={min}
          max={max}
          onChange={onChange}
          fewerLabel={strings.fewer}
          moreLabel={strings.more}
        />
      </div>
      {/* Always in the page, so the line is said as it appears at the most. */}
      <p className={styles.more} role="status">
        {isAtMost && (
          <>
            {strings.moreThan(max)}{' '}
            {phone === undefined || phone === '' ? (
              strings.callRestaurant
            ) : (
              <Link href={telOf(phone)} weight="strong">
                {strings.call(phone)}
              </Link>
            )}
          </>
        )}
      </p>
    </div>
  );
}
