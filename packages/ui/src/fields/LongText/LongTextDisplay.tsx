import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { TruncatedText } from '../../atoms/TruncatedText/TruncatedText.tsx';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import styles from './LongTextDisplay.module.css';
import { strings } from './strings.ts';

/**
 * The record panel's long text: about six lines, then Show more, so a long
 * note never pushes every field under it out of sight. Show more appears only
 * when the text runs past the clamp, measured again as the panel's width
 * changes (a ResizeObserver), and says whether the text is open.
 */
function ClampedText({ text }: { readonly text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [isOpen, setOpen] = useState(false);
  const [isLong, setLong] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || isOpen) return;
    const measure = () => {
      setLong(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    // A wider or narrower panel clamps a different amount: measure again as it resizes.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [text, isOpen]);
  return (
    <span className={styles.clamped}>
      <span ref={ref} id={id} className={styles.root} data-clamped={isOpen ? undefined : ''}>
        {text}
      </span>
      {(isLong || isOpen) && (
        <span>
          <Button
            variant="link"
            isExpanded={isOpen}
            controls={id}
            onPress={() => {
              setOpen((was) => !was);
            }}
          >
            {isOpen ? strings.showLess : strings.showMore}
          </Button>
        </span>
      )}
    </span>
  );
}

/**
 * Long text: clipped to one line in cells and on cards; on the record panel
 * the first six lines and Show more; the whole text, with its line breaks, in
 * a form and a preview.
 */
export function LongTextDisplay({ value, surface }: DisplayProps<'long_text'>) {
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  const text = value as string;
  if (surface === 'cell' || surface === 'card' || surface === 'filter') {
    return <TruncatedText>{text.replaceAll(/\s+/g, ' ')}</TruncatedText>;
  }
  if (surface === 'panel') return <ClampedText text={text} />;
  return <span className={styles.root}>{text}</span>;
}
