import { useLayoutEffect, useRef, useState } from 'react';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import styles from './TruncatedText.module.css';

/** Props for TruncatedText. */
export interface TruncatedTextProps {
  readonly children: string;
  /** Tabular figures, for numbers and amounts that line up in a column. */
  readonly isNumeric?: boolean;
}

/** One line of text, cut with an ellipsis when it doesn't fit, with the full text in a tooltip only when it is cut. */
export function TruncatedText({ children, isNumeric = false }: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isCut, setCut] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => {
      setCut(element.scrollWidth > element.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [children]);

  // Always inside the tooltip, switched off while the text fits, so the
  // measured element never remounts when it becomes cut.
  return (
    <Tooltip content={children} isTextTrigger isDisabled={!isCut}>
      <span ref={ref} className={styles.root} data-numeric={isNumeric || undefined}>
        {children}
      </span>
    </Tooltip>
  );
}
