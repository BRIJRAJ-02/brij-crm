import { Button } from '../Button/Button.tsx';
import { Tooltip } from './Tooltip.tsx';

/** Props for LockReason. */
export interface LockReasonProps {
  /** Why it can't change, as a sentence: "The system sets this when the record is made." */
  readonly reason: string;
}

/**
 * A lock beside something that can't change, saying why: a quiet icon button
 * whose name is the reason, with the reason in a tooltip on hover and on
 * keyboard focus, so everyone can reach it.
 */
export function LockReason({ reason }: LockReasonProps) {
  return (
    <Tooltip content={reason}>
      <Button variant="ghost" icon="lock" label={reason} />
    </Tooltip>
  );
}
