import { createContext, useContext, useRef, useState } from 'react';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import styles from './TruncatedText.module.css';

/** Props for TruncatedText. */
export interface TruncatedTextProps {
  readonly children: string;
  /** Tabular figures, for numbers and amounts that line up in a column. */
  readonly isNumeric?: boolean;
  /** How many lines it may wrap to before the ellipsis: 1 (the default) or 2, for an excerpt. */
  readonly lines?: 1 | 2;
}

/**
 * Set by a host that shows one tooltip for many elements (the grid): inside
 * it, TruncatedText draws only its text, marked `data-truncated`, and the host
 * shows the full text of whichever is cut.
 */
export const SharedTooltipContext = createContext(false);

/** One line of text (or two, with `lines={2}`), cut with an ellipsis when it doesn't fit, with the full text in a tooltip only when it is cut. */
export function TruncatedText(props: TruncatedTextProps) {
  return useContext(SharedTooltipContext) ? <CutText {...props} /> : <TextWithTooltip {...props} />;
}

/** The text alone, for a host's shared tooltip. */
function CutText({ children, isNumeric = false, lines = 1 }: TruncatedTextProps) {
  return (
    <span
      className={styles.root}
      data-truncated=""
      data-numeric={isNumeric || undefined}
      data-lines={lines === 1 ? undefined : lines}
    >
      {children}
    </span>
  );
}

function TextWithTooltip({ children, isNumeric = false, lines = 1 }: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isOpen, setOpen] = useState(false);
  // Measured only as the tooltip is about to open: a table draws hundreds of
  // these, and reading each one's layout as it mounts would stall the scroll.
  const isCut = () => {
    const element = ref.current;
    return (
      element !== null && (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)
    );
  };
  return (
    <Tooltip
      content={children}
      isTextTrigger
      isOpen={isOpen}
      onOpenChange={(next) => {
        setOpen(next && isCut());
      }}
    >
      <span
        ref={ref}
        className={styles.root}
        data-numeric={isNumeric || undefined}
        data-lines={lines === 1 ? undefined : lines}
      >
        {children}
      </span>
    </Tooltip>
  );
}
