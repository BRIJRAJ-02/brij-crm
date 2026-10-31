import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';

/**
 * Date and time: "Today 14:30" near today, else the exact day and time in the provider's language and time zone
 * (the field types pass, 31 October 2026), with the exact time and its zone in a tooltip.
 */
export function TimestampDisplay({ value, surface }: DisplayProps<'timestamp'>) {
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  return <RelativeTime variant="moment" value={value as string} />;
}
