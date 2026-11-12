import {
  Select as AriaSelect, SelectValue, Button as AriaButton, Label, ListBox, ListBoxItem, Collection, Text, FieldError, Autocomplete,
  useFilter, type Key,
} from 'react-aria-components';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Tag, Count, type Hue } from '../Tag/Tag.tsx';
import type { StatusShape } from '../Icon/StatusIcon.tsx';
import { Popover, PopoverSearch, PICKER_FIELD, PICKER_LABEL, PICKER_HELP, PICKER_ERROR } from '../Popover/Popover.tsx';
import './Select.css';

/** One choice in a Select. */
export interface SelectOption {
  readonly id: string;
  readonly label: string;
  /** A grey line under the label (Vercel's described options: roles, plans). */
  readonly description?: string;
  /** Draws the option as a Tag with this status shape. */
  readonly status?: StatusShape;
  /** Draws the option as a Tag in this hue. */
  readonly hue?: Hue;
  /** A 16px icon or Avatar before a plain label. */
  readonly icon?: ReactNode;
  /** Draws the label in this font stack, a token or pack variable (a font list previews each face). */
  readonly face?: string;
  readonly isDisabled?: boolean;
}

/** Lists with more options than this get a search box. */
export const SELECT_SEARCH_THRESHOLD = 8;
const CREATE = '__tf-create';
const CLOSE_AFTER_PICK_MS = 120;

/** Props shared by Select and MultiSelect. */
interface SelectCommon {
  readonly label: string;
  readonly items: ReadonlyArray<SelectOption>;
  /** `tag` draws every option (and the value) as a Tag: select and status attributes. */
  readonly optionStyle?: 'plain' | 'tag';
  readonly placeholder?: string;
  /** Overrides the default (a search when there are more than 8 options). */
  readonly searchable?: boolean;
  /** Offers "Create “text”" when the search matches no option; return the new option's id to choose it. */
  readonly onCreate?: (label: string) => string | undefined;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isInvalid?: boolean;
  readonly isDisabled?: boolean;
  readonly isLabelHidden?: boolean;
  readonly className?: string;
}

/** Props for Select. */
export interface SelectProps extends SelectCommon {
  readonly value?: string | null;
  readonly defaultValue?: string | null;
  readonly onChange?: (id: string | null) => void;
}

/** Props for MultiSelect. */
export interface MultiSelectProps extends SelectCommon {
  readonly values?: ReadonlyArray<string>;
  readonly defaultValues?: ReadonlyArray<string>;
  readonly onChange?: (ids: ReadonlyArray<string>) => void;
  /** Tags shown in the closed field before "+n". */
  readonly maxVisible?: number;
}

function OptionFace({ item, style }: { readonly item: SelectOption; readonly style: 'plain' | 'tag' }) {
  if (style === 'tag' || item.status || item.hue) return <Tag size="sm" status={item.status} hue={item.hue}>{item.label}</Tag>;
  return <>{item.icon !== undefined && <span className="tf-select__icon" aria-hidden="true">{item.icon}</span>}<span className="tf-select__value-text" style={item.face ? { fontFamily: item.face } : undefined}>{item.label}</span></>;
}

function Tick() {
  return <svg className="tf-select__check" width={16} height={16} viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" pathLength={1} /></svg>;
}

/** The open list: optional search, the options, then the Create row under a hairline. */
function OptionList({ items, style, searchable, query, setQuery, canCreate, label }: { readonly items: ReadonlyArray<SelectOption>; readonly style: 'plain' | 'tag'; readonly searchable: boolean; readonly query: string; readonly setQuery: (q: string) => void; readonly canCreate: boolean; readonly label: string }) {
  const { contains } = useFilter({ sensitivity: 'base' });
  const q = query.trim();
  const showCreate = canCreate && q !== '' && !items.some((o) => o.label.toLowerCase() === q.toLowerCase());
  const list = (
    <ListBox className="tf-select__list" renderEmptyState={() => <div className="tf-select__empty">No matches</div>}>
      <Collection items={items}>
        {(item) => (
          <ListBoxItem id={item.id} textValue={item.label} isDisabled={item.isDisabled} className={cx('tf-select__option', item.description !== undefined && 'tf-select__option--tall')}>
            <span className="tf-select__option-main">
              <span className="tf-select__option-face"><OptionFace item={item} style={style} /></span>
              {item.description !== undefined && <Text slot="description" className="tf-select__desc">{item.description}</Text>}
            </span>
            <Tick />
          </ListBoxItem>
        )}
      </Collection>
      {showCreate && <ListBoxItem id={CREATE} textValue={q} className="tf-select__option tf-select__option--create">
        <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>Create <span className="tf-select__create-name">“{q}”</span></span>
      </ListBoxItem>}
    </ListBox>
  );
  if (!searchable) return list;
  return (
    <Autocomplete filter={contains} inputValue={query} onInputChange={setQuery}>
      <PopoverSearch placeholder={`Search ${label.toLowerCase()}…`} />
      {list}
    </Autocomplete>
  );
}

/** Opens late on purpose: a single pick shows its tick drawing, then the list closes 120ms later. */
function useDelayedClose(): readonly [boolean, (open: boolean) => void, () => void] {
  const [open, setOpen] = useState(false);
  const picked = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onOpenChange = (next: boolean) => {
    if (!next && picked.current) {
      picked.current = false;
      timer.current = window.setTimeout(() => setOpen(false), CLOSE_AFTER_PICK_MS);
      return;
    }
    window.clearTimeout(timer.current);
    setOpen(next);
  };
  return [open, onOpenChange, () => { picked.current = true; }] as const;
}

function FieldLabel({ label, isLabelHidden }: Pick<SelectCommon, 'label' | 'isLabelHidden'>) {
  return <Label className={cx(PICKER_LABEL, isLabelHidden && 'tf-sr-only')}>{label}</Label>;
}

function FieldHelp({ description, errorMessage }: Pick<SelectCommon, 'description' | 'errorMessage'>) {
  return (
    <>
      {description !== undefined && <Text slot="description" className={PICKER_HELP}>{description}</Text>}
      <FieldError className={PICKER_ERROR}>{errorMessage}</FieldError>
    </>
  );
}

/** One choice from a list, in a filled field: a stage, a status, a role, a currency. Status options draw as Tags with their shape; long lists search; "Create" adds an option. */
export function Select({ label, items, optionStyle = 'plain', placeholder = 'Choose…', searchable, onCreate, value, defaultValue = null, onChange, description, errorMessage, isInvalid, isDisabled, isLabelHidden, className }: SelectProps) {
  const [own, setOwn] = useState<string | null>(defaultValue);
  const current = value === undefined ? own : value;
  const [query, setQuery] = useState('');
  const [open, onOpenChange, markPicked] = useDelayedClose();
  const chosen = items.find((o) => o.id === current);
  const isSearchable = searchable ?? items.length > SELECT_SEARCH_THRESHOLD;
  const pick = (key: Key | null) => {
    let id = key === null ? null : String(key);
    if (id === CREATE) id = onCreate?.(query.trim()) ?? null;
    if (id === null) return;
    markPicked();
    setOwn(id);
    onChange?.(id);
  };
  return (
    <AriaSelect
      className={cx('tf-select', className)} value={current} onChange={pick} isOpen={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) setQuery(''); }}
      isInvalid={isInvalid} isDisabled={isDisabled} placeholder={placeholder}
    >
      <FieldLabel label={label} isLabelHidden={isLabelHidden} />
      <AriaButton className={cx(PICKER_FIELD, 'tf-select__trigger')}>
        <SelectValue className="tf-select__value">
          {() => (chosen ? <OptionFace item={chosen} style={optionStyle} /> : <span className="tf-select__placeholder">{placeholder}</span>)}
        </SelectValue>
        <ChevronDown className="tf-select__chev" size={16} strokeWidth={1.75} aria-hidden="true" />
      </AriaButton>
      <FieldHelp description={description} errorMessage={errorMessage} />
      <Popover width="trigger" className="tf-select__pop">
        <OptionList items={items} style={optionStyle} searchable={isSearchable} query={query} setQuery={setQuery} canCreate={onCreate !== undefined} label={label} />
      </Popover>
    </AriaSelect>
  );
}

/** Several choices from a list (tags, segments, languages). The closed field shows the first Tags then "+n"; the list stays open while you pick. */
export function MultiSelect({ label, items, optionStyle = 'tag', placeholder = 'Choose…', searchable, onCreate, values, defaultValues = [], onChange, maxVisible = 2, description, errorMessage, isInvalid, isDisabled, isLabelHidden, className }: MultiSelectProps) {
  const [own, setOwn] = useState<ReadonlyArray<string>>(defaultValues);
  const current = values ?? own;
  const [query, setQuery] = useState('');
  const chosen = items.filter((o) => current.includes(o.id));
  const isSearchable = searchable ?? items.length > SELECT_SEARCH_THRESHOLD;
  const pick = (keys: ReadonlyArray<Key>) => {
    const ids = keys.map(String);
    const created = ids.includes(CREATE) ? onCreate?.(query.trim()) : undefined;
    const next = [...ids.filter((k) => k !== CREATE), ...(created !== undefined ? [created] : [])];
    if (created !== undefined) setQuery('');
    setOwn(next);
    onChange?.(next);
  };
  const shown = chosen.slice(0, maxVisible);
  return (
    <AriaSelect
      selectionMode="multiple" className={cx('tf-select', className)} value={current} onChange={pick}
      onOpenChange={(o) => { if (!o) setQuery(''); }} isInvalid={isInvalid} isDisabled={isDisabled} placeholder={placeholder}
    >
      <FieldLabel label={label} isLabelHidden={isLabelHidden} />
      <AriaButton className={cx(PICKER_FIELD, 'tf-select__trigger')}>
        <SelectValue className="tf-select__value tf-select__value--tags">
          {() => chosen.length === 0
            ? <span className="tf-select__placeholder">{placeholder}</span>
            : <>
                {shown.map((o) => <Tag key={o.id} size="sm" status={o.status} hue={o.hue ?? (o.status ? undefined : 'gray')}>{o.label}</Tag>)}
                {chosen.length > shown.length && <Count>{`+${chosen.length - shown.length}`}</Count>}
              </>}
        </SelectValue>
        <ChevronDown className="tf-select__chev" size={16} strokeWidth={1.75} aria-hidden="true" />
      </AriaButton>
      <FieldHelp description={description} errorMessage={errorMessage} />
      <Popover width="trigger" className="tf-select__pop">
        <OptionList items={items} style={optionStyle} searchable={isSearchable} query={query} setQuery={setQuery} canCreate={onCreate !== undefined} label={label} />
      </Popover>
    </AriaSelect>
  );
}
