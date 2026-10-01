import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import { optionOf } from '../Select/SelectDisplay.tsx';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';

/** Status: a StatusDot in the status's hue, with its label. */
export function StatusDisplay({ attribute, value, surface }: DisplayProps<'status'>) {
  if (typeof value !== 'string') return <EmptyValue surface={surface} />;
  const status = optionOf(attribute, value);
  return (
    <StatusDot hue={status.hue} isArchived={status.archived}>
      {status.label}
    </StatusDot>
  );
}
