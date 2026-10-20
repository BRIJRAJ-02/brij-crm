import { Button } from '../Button/Button.tsx';
import { Tooltip } from './Tooltip.tsx';

/** Props for LockReason. */
export interface LockReasonProps {
  /** Why it can't change, as a sentence: "The system sets this when the record is made." */
  readonly reason: string;
  /** `sm` is a chip's 20px, beside an 11px label (a read only attribute's name in a record's details). */
  readonly size?: 'sm' | 'md';
}

/**
 * A lock beside something that can't change, saying why: a quiet icon button
 * whose name is the reason, with the reason in a tooltip on hover and on
 * keyboard focus, so everyone can reach it.
 */
export function LockReason({ reason, size = 'md' }: LockReasonProps) {
  return (
    <Tooltip content={reason}>
      <Button variant="ghost" size={size} icon="lock" label={reason} />
    </Tooltip>
  );
}
