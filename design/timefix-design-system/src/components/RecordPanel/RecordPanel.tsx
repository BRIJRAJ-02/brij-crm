import { Button as AriaButton, Disclosure, DisclosurePanel, Heading } from 'react-aria-components';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, ChevronUp, ChevronDown, ChevronRight, Plus, Maximize2 } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { IconButton } from '../Button/Button.tsx';
import { Count } from '../Tag/Tag.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import { AttributeField, AttributeIcon, type Attribute, type AttributeValue } from '../AttributeField/AttributeField.tsx';
import './RecordPanel.css';

/** Slides between two views of one surface (record to record, list to detail): the old one leaves 8px one way through a 3px blur while the new one arrives from the other (transitions.dev 08 page side-by-side). */
export function PageSlide({ pageKey, direction = 'forward', children }: { readonly pageKey: string; readonly direction?: 'forward' | 'back'; readonly children: ReactNode }) {
  const last = useRef<{ key: string; node: ReactNode }>({ key: pageKey, node: children });
  const [leaving, setLeaving] = useState<{ key: string; node: ReactNode; dir: 'forward' | 'back' }>();
  const [entering, setEntering] = useState(false);
  if (last.current.key !== pageKey) {
    setLeaving({ key: last.current.key, node: last.current.node, dir: direction });
    setEntering(true);
    last.current = { key: pageKey, node: children };
  }
  useEffect(() => { last.current = { key: pageKey, node: children }; });
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => { setLeaving(undefined); setEntering(false); }, 260);
    return () => window.clearTimeout(t);
  }, [leaving]);
  const dir = leaving?.dir ?? direction;
  return (
    <div className={cx('tf-pslide', `tf-pslide--${dir}`)}>
      {leaving && <div key={`out-${leaving.key}`} className="tf-pslide__page tf-pslide__page--out" aria-hidden="true" inert>{leaving.node}</div>}
      <div key={pageKey} className={cx('tf-pslide__page', entering && 'tf-pslide__page--in')}>{children}</div>
    </div>
  );
}

/** One attribute on a record: a grey icon well, the name, and its value editing in place. */
export function AttributeRow({ attribute, value, onChange }: { readonly attribute: Attribute; readonly value: AttributeValue; readonly onChange: (v: AttributeValue) => void }) {
  return (
    <div className="tf-arow">
      <span className="tf-arow__label"><span className="tf-arow__well"><AttributeIcon type={attribute.type} size={14} /></span><span className="tf-arow__name">{attribute.name}</span></span>
      <AttributeField attribute={attribute} value={value} onChange={onChange} className="tf-arow__value" />
    </div>
  );
}

/** A collapsible group on a record (Linked records, Notes, Upcoming meetings): a chevron, the title, a count and an optional Add. */
export function RecordSection({ title, count, onAdd, defaultExpanded = true, children }: { readonly title: string; readonly count?: number; readonly onAdd?: () => void; readonly defaultExpanded?: boolean; readonly children: ReactNode }) {
  return (
    <Disclosure defaultExpanded={defaultExpanded} className="tf-rsec">
      <div className="tf-rsec__head">
        <Heading level={3} className="tf-rsec__heading">
          <AriaButton slot="trigger" className="tf-rsec__trigger">
            <span className="tf-rsec__chevron" aria-hidden="true"><ChevronRight size={14} strokeWidth={2} /></span>
            {title}
            {count !== undefined && <Count>{count}</Count>}
          </AriaButton>
        </Heading>
        {onAdd && <IconButton size="sm" label={`Add to ${title.toLowerCase()}`} onPress={onAdd}><Plus size={14} strokeWidth={1.75} /></IconButton>}
      </div>
      <DisclosurePanel className="tf-rsec__panel"><div className="tf-rsec__inner">{children}</div></DisclosurePanel>
    </Disclosure>
  );
}

/** Props for RecordPanel. */
export interface RecordPanelProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** The object's name for the toolbar ("Company"). */
  readonly objectName: string;
  /** Changes when a different record shows, so the body slides. */
  readonly recordKey: string;
  /** Labels the panel for screen readers ("Acme Corp"). */
  readonly label: string;
  readonly position?: { readonly index: number; readonly total: number; readonly onPrevious: () => void; readonly onNext: () => void };
  readonly onExpand?: () => void;
  /** The record: usually a small header, AttributeRows and RecordSections. */
  readonly children: ReactNode;
}

/** The peek drawer: a record opened beside the list without leaving it. It rises in with a short blur (transitions.dev 07 panel reveal), switches records with a side slide, and Esc closes it. */
export function RecordPanel({ isOpen, onClose, objectName, recordKey, label, position, onExpand, children }: RecordPanelProps) {
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const [dir, setDir] = useState<'forward' | 'back'>('forward');
  const mounted = useRef(false);
  useEffect(() => {
    // Never steal focus on first paint; move it only when the panel opens or closes later.
    if (!mounted.current) { mounted.current = true; return; }
    if (isOpen) {
      opener.current = document.activeElement;
      ref.current?.focus({ preventScroll: true });
    } else if (opener.current instanceof HTMLElement && ref.current?.contains(document.activeElement)) {
      opener.current.focus();
    }
  }, [isOpen]);
  return (
    <aside ref={ref} tabIndex={-1} className="tf-rpanel" data-open={isOpen || undefined} inert={!isOpen} aria-label={label} role="dialog" aria-modal="false"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); }
        const typing = !(e.target instanceof HTMLElement) || e.target.isContentEditable || e.target.closest('input, textarea, [role="listbox"], [role="grid"], [role="radiogroup"], [role="group"]') !== null;
        // J and K, or the arrow keys, step through the list (the flow and the tooltips say both).
        const next = e.key === 'j' || e.key === 'ArrowDown'; const prev = e.key === 'k' || e.key === 'ArrowUp';
        if (!typing && position && (next || prev)) { e.preventDefault(); if (next) { setDir('forward'); position.onNext(); } else { setDir('back'); position.onPrevious(); } }
      }}>
      <div className="tf-rpanel__bar">
        <span className="tf-rpanel__object">{objectName}</span>
        {position && <span className="tf-rpanel__pos">{position.index} of {position.total}</span>}
        <span className="tf-rpanel__tools">
          {position && <>
            <Tooltip label="Previous (K or ↑)" shortcut="K"><IconButton size="sm" label="Previous record" isDisabled={position.index <= 1} onPress={() => { setDir('back'); position.onPrevious(); }}><ChevronUp size={14} strokeWidth={1.75} /></IconButton></Tooltip>
            <Tooltip label="Next (J or ↓)" shortcut="J"><IconButton size="sm" label="Next record" isDisabled={position.index >= position.total} onPress={() => { setDir('forward'); position.onNext(); }}><ChevronDown size={14} strokeWidth={1.75} /></IconButton></Tooltip>
          </>}
          {onExpand && <Tooltip label="Open full page"><IconButton size="sm" label="Open full page" onPress={onExpand}><Maximize2 size={14} strokeWidth={1.75} /></IconButton></Tooltip>}
          <Tooltip label="Close" shortcut="Esc"><IconButton size="sm" label="Close" onPress={onClose}><X size={14} strokeWidth={1.75} /></IconButton></Tooltip>
        </span>
      </div>
      <div className="tf-rpanel__body">
        <PageSlide pageKey={recordKey} direction={dir}>{children}</PageSlide>
      </div>
      <p className="tf-rpanel__hint"><Kbd>J</Kbd><Kbd>K</Kbd> next and previous · <Kbd>Esc</Kbd> close</p>
    </aside>
  );
}
