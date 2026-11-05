// A picked colour's contrast, said beside it (spec 0065, AC-6570 as amended): a green or red dot and the words, so the
// dot is never the only cue.
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import { strings } from './strings.ts';

/** Props for ContrastBadge. */
export interface ContrastBadgeProps {
  /** The contrast ratio, such as 4.53 for 4.53:1. */
  readonly ratio: number;
  /** Whether it passes AA for what the colour does (the caller knows: 4.5:1 for words, 3:1 for a control). */
  readonly passes: boolean;
}

/** "AA 12.1:1" with a green dot, or "Fails AA 2.1:1" with a red one. */
export function ContrastBadge({ ratio, passes }: ContrastBadgeProps) {
  return (
    <StatusDot hue={passes ? 'green' : 'red'}>
      {passes ? strings.contrastPasses(ratio) : strings.contrastFails(ratio)}
    </StatusDot>
  );
}
