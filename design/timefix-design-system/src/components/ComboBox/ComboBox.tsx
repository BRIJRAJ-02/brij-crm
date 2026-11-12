import { ComboBox as AriaComboBox, Group, Input, Label, ListBox, ListBoxItem, ListBoxSection, Header, Text, type Key } from 'react-aria-components';
import { useEffect, useRef, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { PersonLine } from '../Avatar/Avatar.tsx';
import { Skeleton, Spinner } from '../Motion/Motion.tsx';
import { Popover, PICKER_FIELD, PICKER_LABEL, PICKER_HELP } from '../Popover/Popover.tsx';
import './ComboBox.css';

/** A record a reference can point at: a person (round avatar) or a company (square). */
export interface RecordRef {
  readonly id: string;
  readonly name: string;
  /** `record` is a record of any other object (a deal, a project): `object` names it. */
  readonly kind: 'person' | 'company' | 'record';
  /** The grey line: a person's company and email, a company's domain. */
  readonly sub?: string;
  /** For `record`: the object's name, in the singular ("Deal"). */
  readonly object?: string;
}

/** Props for ReferencePicker. */
export interface ReferencePickerProps {
  readonly label: string;
  readonly placeholder?: string;
  /** Shown before anything is typed. */
  readonly recent?: ReadonlyArray<RecordRef>;
  /** Finds records for the typed text. May be slow: rows show skeletons until it answers. */
  readonly search: (query: string) => Promise<ReadonlyArray<RecordRef>>;
  readonly onSelect?: (record: RecordRef) => void;
  /** Offers "Create “text”" when nothing matches. */
  readonly onCreate?: (name: string) => void;
  readonly description?: string;
  readonly isDisabled?: boolean;
  readonly autoFocus?: boolean;
}

const CREATE = '__tf-create';

/** One record row: a person as PersonLine, a company with a square avatar. */
function RecordRow({ record }: { readonly record: RecordRef }) {
  return <PersonLine name={record.name} sub={record.kind === 'record' && record.object ? [record.object, record.sub].filter(Boolean).join(' · ') : record.sub} shape={record.kind === 'person' ? 'round' : 'square'} />;
}

function SkeletonRows() {
  return (
    <div className="tf-combo__skeletons" aria-hidden="true">
      {[72, 56, 64].map((w) => (
        <div key={w} className="tf-combo__skeleton-row">
          <Skeleton width="var(--size-avatar)" height={28} round />
          <span className="tf-combo__skeleton-text"><Skeleton width={`${w}%`} height={10} /><Skeleton width={`${w - 24}%`} height={8} /></span>
        </div>
      ))}
    </div>
  );
}

/**
 * Searches records and picks one: people as PersonLines, companies with square avatars, Recent before anything is typed,
 * skeleton rows while a search is in flight, and "No matches · Create “acme”" when nothing is found.
 */
export function ReferencePicker({ label, placeholder = 'Search people and companies…', recent = [], search, onSelect, onCreate, description, isDisabled, autoFocus }: ReferencePickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReadonlyArray<RecordRef>>([]);
  const [loading, setLoading] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const q = query.trim();
  useEffect(() => {
    if (q === '') { setResults([]); setLoading(false); return; }
    let live = true;
    setLoading(true);
    search(q).then((found) => { if (live) { setResults(found); setLoading(false); } }, () => { if (live) { setResults([]); setLoading(false); } });
    return () => { live = false; };
  }, [q, search]);
  const pick = (key: Key | null) => {
    if (key === null) return;
    if (key === CREATE) { onCreate?.(q); setQuery(''); return; }
    const record = [...results, ...recent].find((r) => r.id === key);
    if (record) { onSelect?.(record); setQuery(''); }
  };
  const showCreate = onCreate !== undefined && q !== '' && !loading && results.length === 0;
  return (
    <AriaComboBox
      className="tf-combo" inputValue={query} onInputChange={setQuery} selectedKey={null} onSelectionChange={pick}
      onOpenChange={(open) => { if (open) setWidth(field.current?.offsetWidth); }}
      menuTrigger="focus" allowsEmptyCollection defaultFilter={() => true} isDisabled={isDisabled} autoFocus={autoFocus}
    >
      <Label className={PICKER_LABEL}>{label}</Label>
      <Group ref={field} className={cx(PICKER_FIELD, 'tf-combo__field')}>
        <Search className="tf-combo__icon" size={16} strokeWidth={1.75} aria-hidden="true" />
        <Input className="tf-combo__input" placeholder={placeholder} />
        {loading && <Spinner size={14} label="Searching" />}
      </Group>
      {description !== undefined && <Text slot="description" className={PICKER_HELP}>{description}</Text>}
      {/* Anchored to the whole field (React Aria anchors a combobox to its input alone). */}
      <Popover triggerRef={field} style={width ? { width } : undefined} className="tf-combo__pop" offset={6}>
        <ListBox className="tf-combo__list" renderEmptyState={() => (loading ? <SkeletonRows /> : <div className="tf-combo__empty">{q === '' ? 'Type a name or email' : 'No matches'}</div>)}>
          {q === '' && recent.length > 0 && (
            <ListBoxSection className="tf-combo__section">
              <Header className="tf-combo__header">Recent</Header>
              {recent.map((r) => <ListBoxItem key={r.id} id={r.id} textValue={r.name} className="tf-combo__item"><RecordRow record={r} /></ListBoxItem>)}
            </ListBoxSection>
          )}
          {q !== '' && !loading && results.map((r) => (
            <ListBoxItem key={r.id} id={r.id} textValue={r.name} className="tf-combo__item tf-combo__item--found"><RecordRow record={r} /></ListBoxItem>
          ))}
          {showCreate && (
            <ListBoxItem id={CREATE} textValue={`Create ${q}`} className="tf-combo__item tf-combo__item--create">
              <span className="tf-combo__plus" aria-hidden="true"><Plus size={16} strokeWidth={1.75} /></span>
              <span><span className="tf-combo__none">No matches · </span>Create <strong className="tf-combo__create-name">“{q}”</strong></span>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaComboBox>
  );
}
