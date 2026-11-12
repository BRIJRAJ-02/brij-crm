import { Button as AriaButton, Input, TextField } from 'react-aria-components';
import { useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from '../Button/Button.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { cx } from '../../lib/cx.ts';
import './DescriptionList.css';

/** How a row's text value edits and whether it offers copy (email, phone, url). */
export type DescriptionType = 'text' | 'email' | 'phone' | 'url' | 'number';

/** One attribute row. Give `display` for values drawn by another component (a Tag, a PersonLine); those rows don't edit inline. */
export interface DescriptionItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
  readonly type?: DescriptionType;
  readonly value?: string;
  readonly display?: ReactNode;
  readonly isReadOnly?: boolean;
  /** Shown in tertiary text when empty; defaults to "Add <label>". */
  readonly placeholder?: string;
}

const COPYABLE: ReadonlySet<DescriptionType> = new Set(['email', 'phone', 'url']);
const INPUT_TYPE: Readonly<Record<DescriptionType, string>> = { text: 'text', email: 'email', phone: 'tel', url: 'url', number: 'text' };

/** A record's attributes: icon well and grey label on the left, the value on the right, edited in place on click. Replaces DescriptionList and AttributeList. */
export function DescriptionList({ label, items, onChange }: { readonly label: string; readonly items: ReadonlyArray<DescriptionItem>; readonly onChange?: (id: string, value: string) => void }) {
  return (
    <dl className="tf-dl" aria-label={label}>
      {items.map((it) => <DescriptionRow key={it.id} item={it} onChange={onChange} />)}
    </dl>
  );
}

function DescriptionRow({ item, onChange }: { readonly item: DescriptionItem; readonly onChange?: (id: string, value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.value ?? '');
  const [copied, setCopied] = useState(false);
  const valueRef = useRef<HTMLButtonElement>(null);
  // Enter commits, then the field unmounts and loses focus: only the first finish counts.
  const live = useRef(false);
  const type = item.type ?? 'text';
  const editable = !item.isReadOnly && item.display === undefined && onChange !== undefined;
  const empty = item.value === undefined || item.value === '';
  const Icon = item.icon;

  const start = () => { setDraft(item.value ?? ''); live.current = true; setEditing(true); };
  const finish = (save: boolean, refocus: boolean) => {
    if (!live.current) return;
    live.current = false;
    setEditing(false);
    if (save && draft.trim() !== (item.value ?? '')) onChange?.(item.id, draft.trim());
    if (refocus) requestAnimationFrame(() => valueRef.current?.focus());
  };
  const copy = () => {
    void navigator.clipboard?.writeText(item.value ?? '').catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const shown = item.display ?? (empty ? <span className="tf-dl__empty">{item.placeholder ?? `Add ${item.label.toLowerCase()}`}</span> : <span className="tf-dl__text">{item.value}</span>);
  return (
    <div className={cx('tf-dl__row', editing && 'is-editing')}>
      <dt className="tf-dl__label">
        <span className="tf-dl__well" aria-hidden="true">{Icon && <Icon size={14} strokeWidth={1.75} />}</span>
        {item.label}
      </dt>
      <dd className="tf-dl__cell">
        {editable ? (
          <AriaButton ref={valueRef} className="tf-dl__value" onPress={start} aria-label={empty ? `Add ${item.label}` : `${item.label}: ${item.value ?? ''}. Edit`}>{shown}</AriaButton>
        ) : (
          <span className="tf-dl__value tf-dl__value--static">{shown}</span>
        )}
        {editing && (
          <TextField aria-label={item.label} value={draft} onChange={setDraft} autoFocus className="tf-dl__field">
            <Input className="tf-dl__input" type={INPUT_TYPE[type]} inputMode={type === 'number' ? 'decimal' : undefined}
              placeholder={item.placeholder ?? item.label}
              onKeyDown={(e) => { if (e.key === 'Enter') finish(true, true); if (e.key === 'Escape') { e.stopPropagation(); finish(false, true); } }}
              onBlur={() => finish(true, false)} />
          </TextField>
        )}
        {COPYABLE.has(type) && !empty && !editing && (
          <span className="tf-dl__copy">
            <Tooltip label={copied ? 'Copied' : `Copy ${item.label.toLowerCase()}`}>
              <IconButton size="sm" label={copied ? 'Copied' : `Copy ${item.label.toLowerCase()}`} onPress={copy}>
                <span className="tf-dl__swap" data-state={copied ? 'b' : 'a'} aria-hidden="true">
                  <Copy data-icon="a" size={14} strokeWidth={1.75} /><Check data-icon="b" size={14} strokeWidth={2} />
                </span>
              </IconButton>
            </Tooltip>
          </span>
        )}
      </dd>
    </div>
  );
}
