import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';

/** Timestamp: relative ("3 hours ago"), with the exact time in a tooltip. */
export function TimestampDisplay({ value, surface }: DisplayProps<'timestamp'>) {
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  return <RelativeTime value={value as string} />;
}
