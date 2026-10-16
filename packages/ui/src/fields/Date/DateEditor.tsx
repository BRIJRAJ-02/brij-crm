import { useRef, useState } from 'react';
import { DatePicker } from '../../molecules/DatePicker/DatePicker.tsx';
import type { EditorProps } from '../types.ts';
import { isCompactSurface, toCommittable } from '../values.ts';

/**
 * Date: the DatePicker, typed in the language's order or picked, with quick
 * picks in the provider's time zone. It commits once, when focus leaves the
 * field or the calendar closes, never on each typed digit.
 */
export function DateEditor({ attribute, value, surface, onCommit, error }: EditorProps<'date'>) {
  const [draft, setDraft] = useState<string | null>(typeof value === 'string' ? value : null);
  const committed = useRef(draft);
  const [message, setMessage] = useState<string | undefined>(undefined);
  // A value changed from outside (live, or the screen refusing an edit) shows, as the title and records do.
  const incoming = typeof value === 'string' ? value : null;
  const [shownValue, setShownValue] = useState(incoming);
  if (incoming !== shownValue) {
    setShownValue(incoming);
    setDraft(incoming);
  }
  const isCompact = isCompactSurface(surface);
  const commit = (next: string | null) => {
    // Nothing new: what was last committed, or the value as it came in (from outside, unchanged since).
    if (next === committed.current || next === shownValue) return;
    const result = toCommittable<'date'>(attribute, next);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(undefined);
    committed.current = next;
    onCommit(result.value);
  };
  const shown = message ?? error;
  return (
    <DatePicker
      label={attribute.name}
      isLabelHidden={isCompact}
      size={isCompact ? 'sm' : 'md'}
      isRequired={attribute.isRequired}
      value={draft}
      {...(shown === undefined ? {} : { error: shown })}
      onChange={setDraft}
      onFocusChange={(isFocused) => {
        if (!isFocused) commit(draft);
      }}
      onOpenChange={(isOpen) => {
        if (!isOpen) commit(draft);
      }}
    />
  );
}
