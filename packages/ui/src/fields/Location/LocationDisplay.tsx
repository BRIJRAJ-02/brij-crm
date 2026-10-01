import { memoIntl } from '../../lib/intl-memo.ts';
import type { LocationValue } from '@crm/contracts/values';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import styles from './LocationDisplay.module.css';

/** "London, United Kingdom": the locality, region and country, with the country's name in the language. */
export function shortLocation(location: LocationValue, locale: string): string {
  const country =
    location.countryCode === undefined
      ? undefined
      : memoIntl(`region:${locale}`, () => new Intl.DisplayNames(locale, { type: 'region' })).of(location.countryCode);
  return [location.locality, location.region, country].filter((part) => part !== undefined && part !== '').join(', ');
}

/** The whole address, one line per part. */
function fullLocation(location: LocationValue, locale: string): readonly string[] {
  const place = [location.locality, location.region, location.postcode].filter((part) => part !== undefined).join(' ');
  const country =
    location.countryCode === undefined
      ? undefined
      : memoIntl(`region:${locale}`, () => new Intl.DisplayNames(locale, { type: 'region' })).of(location.countryCode);
  return [location.line1, location.line2, location.line3, location.line4, place, country].filter(
    (line): line is string => line !== undefined && line !== '',
  );
}

/** Location: "London, United Kingdom" in cells and on cards; the whole address in the panel and forms. */
export function LocationDisplay({ value, surface }: DisplayProps<'location'>) {
  const { locale } = useFormatSettings();
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  const location = value as LocationValue;
  if (surface === 'cell' || surface === 'card' || surface === 'filter') {
    return <TruncatedText>{shortLocation(location, locale)}</TruncatedText>;
  }
  return (
    <span className={styles.root}>
      {fullLocation(location, locale).map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}
