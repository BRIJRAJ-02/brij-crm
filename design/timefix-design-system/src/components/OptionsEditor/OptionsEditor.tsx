import { Button as AriaButton, DialogTrigger, Input, TextField } from 'react-aria-components';
import { DragArea, DragGroup, useDragGroup, type DragGroups } from '../../lib/drag.ts';
import { DragHandle, DragItem } from '../DragHandle/DragHandle.tsx';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Archive, ArchiveRestore, Plus } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import type { AttributeOption } from '../AttributeField/AttributeField.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { ColorSwatchPicker, HUE_NAMES } from '../ColorPicker/ColorPicker.tsx';
import { IconButton, Button } from '../Button/Button.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { MenuTrigger, Menu, MenuItem } from '../Menu/Menu.tsx';
import { StatusIcon, type StatusShape } from '../Icon/StatusIcon.tsx';
import { Count, type Hue } from '../Tag/Tag.tsx';
import { Collapse } from '../Motion/Motion.tsx';
import './OptionsEditor.css';

/** Where a status stage sits: work not begun, under way, or finished (won or lost). */
export type StatusGroup = 'notStarted' | 'inProgress' | 'done';

/** A select option or status stage being edited: its colour, label, group (status only) and whether it is archived. */
export interface EditableOption extends AttributeOption {
  readonly group?: StatusGroup;
  /** Archived options keep their values on old records but can't be picked. */
  readonly archived?: boolean;
  /** A stage that ends a pipeline: won or lost (forecasts and open counts read it). */
  readonly outcome?: 'won' | 'lost';
  /** A stage's target time, in whole days; a record sitting longer reads as stale. */
  readonly targetDays?: number;
}

/** The three status groups, with the shape each new stage in them takes. */
export const STATUS_GROUPS: ReadonlyArray<{ readonly id: StatusGroup; readonly label: string; readonly shape: StatusShape }> = [
  { id: 'notStarted', label: 'Not started', shape: 'draft' },
  { id: 'inProgress', label: 'In progress', shape: 'progress' },
  { id: 'done', label: 'Done', shape: 'done' },
];

const HUE_CYCLE: ReadonlyArray<Hue> = ['blue', 'green', 'orange', 'purple', 'sky', 'yellow', 'red', 'lime', 'gray'];
/** The hue after the last option's, so a list typed in one go comes out varied. */
export function nextHue(options: ReadonlyArray<AttributeOption>): Hue {
  const last = options[options.length - 1]?.hue;
  return HUE_CYCLE[(last ? HUE_CYCLE.indexOf(last) + 1 : 0) % HUE_CYCLE.length] ?? 'blue';
}

const ALL = 'all';
const UNDO_MS = 5_000;
const COLLAPSE_MS = 250;
const PICK_CLOSE_MS = 120;

/** Props for OptionsEditor. */
export interface OptionsEditorProps {
  /** `status` groups stages under Not started, In progress and Done. */
  readonly kind: 'select' | 'status';
  readonly options: ReadonlyArray<EditableOption>;
  /** The whole list after any change (order, label, colour, group, archive). */
  readonly onChange: (options: ReadonlyArray<EditableOption>) => void;
  /** The heading ("Options", "Stages"). */
  readonly label?: string;
}

/**
 * A select's options or a status's stages: a colour swatch, an editable label and a grip per row. Drag (or Enter on the grip, arrows, Enter) to reorder,
 * across groups for a status. Add option drops a row in and focuses it; Enter in a label adds the next. Archive collapses a row to "Archived · Undo".
 */
export function OptionsEditor({ kind, options, onChange, label = kind === 'status' ? 'Stages' : 'Options' }: OptionsEditorProps) {
  const [fresh, setFresh] = useState<string>();
  const [undo, setUndo] = useState<Readonly<Record<string, 'open' | 'closing'>>>({});
  const timers = useRef(new Map<string, number[]>());
  useEffect(() => () => timers.current.forEach((ts) => ts.forEach((t) => window.clearTimeout(t))), []);
  const latest = useRef(options);
  latest.current = options;

  // A stage saved without a group (older data) sits where its shape says: draft not started, done or failed done, the rest in progress.
  const groupOf = (o: EditableOption): StatusGroup | undefined => (kind !== 'status' ? undefined : o.group ?? (o.shape === 'draft' ? 'notStarted' : o.shape === 'done' || o.shape === 'failed' || o.outcome ? 'done' : 'inProgress'));
  const live = options.filter((o) => !o.archived);
  const shelved = options.filter((o) => o.archived && undo[o.id] === undefined);
  const dupes = new Set(live.map((o) => o.label.trim().toLowerCase()).filter((l, i, all) => l !== '' && all.indexOf(l) !== i));

  const patch = (id: string, change: Partial<EditableOption>) => onChange(latest.current.map((o) => (o.id === id ? { ...o, ...change } : o)));
  const add = (group?: StatusGroup, after?: string) => {
    const id = `opt-${Date.now().toString(36)}`;
    const shape = STATUS_GROUPS.find((g) => g.id === group)?.shape;
    const peers = latest.current.filter((o) => !o.archived && groupOf(o) === group);
    const made: EditableOption = { id, label: '', hue: nextHue(peers.length > 0 ? peers : latest.current), ...(group ? { group, shape } : {}) };
    const list = [...latest.current];
    const at = after ? list.findIndex((o) => o.id === after) + 1 : (() => { const lastPeer = peers[peers.length - 1]; return lastPeer ? list.indexOf(lastPeer) + 1 : list.length; })();
    list.splice(at, 0, made);
    setFresh(id);
    onChange(list);
  };
  const dropIfEmpty = (id: string) => {
    const o = latest.current.find((x) => x.id === id);
    if (o && o.label.trim() === '' && !o.archived) onChange(latest.current.filter((x) => x.id !== id));
  };
  const clearTimers = (id: string) => { timers.current.get(id)?.forEach((t) => window.clearTimeout(t)); timers.current.delete(id); };
  const archive = (id: string) => {
    patch(id, { archived: true });
    setUndo((u) => ({ ...u, [id]: 'open' }));
    clearTimers(id);
    timers.current.set(id, [
      window.setTimeout(() => setUndo((u) => ({ ...u, [id]: 'closing' })), UNDO_MS),
      window.setTimeout(() => setUndo(({ [id]: _gone, ...rest }) => rest), UNDO_MS + COLLAPSE_MS),
    ]);
  };
  const restore = (id: string) => {
    clearTimers(id);
    setUndo(({ [id]: _gone, ...rest }) => rest);
    patch(id, { archived: false });
  };

  const groups: ReadonlyArray<{ readonly id?: StatusGroup; readonly label?: string; readonly shape?: StatusShape }> = kind === 'status' ? STATUS_GROUPS : [{}];
  const shownIn = (g?: StatusGroup) => options.filter((o) => groupOf(o) === g && (!o.archived || undo[o.id] !== undefined)).map((o) => o.id);
  const dragGroups: DragGroups = Object.fromEntries(groups.map((g) => [g.id ?? ALL, shownIn(g.id)]));
  // A drop: each group's rows in their new order (a stage moved to another group takes its shape), the shelved ones after.
  const moved = (next: DragGroups) => {
    const placed = groups.flatMap((g) => (next[g.id ?? ALL] ?? []).map((id) => {
      const o = options.find((x) => x.id === id);
      return o && kind === 'status' && groupOf(o) !== g.id ? { ...o, group: g.id, shape: STATUS_GROUPS.find((x) => x.id === g.id)?.shape } : o;
    })).filter((o): o is EditableOption => Boolean(o));
    onChange([...placed, ...options.filter((o) => !placed.some((p) => p.id === o.id))]);
  };
  return (
    <section className="tf-optionseditor" aria-label={label}>
      <div className="tf-optionseditor__head">
        <span className="tf-optionseditor__label">{label}</span>
        <Count>{live.length}</Count>
      </div>
      <DragArea groups={dragGroups} onChange={moved} textOf={(id) => options.find((o) => o.id === id)?.label || 'untitled option'} groupName={(g) => STATUS_GROUPS.find((x) => x.id === g)?.label ?? 'the list'}
        overlay={(id) => { const o = options.find((x) => x.id === id); return o ? <div className="tf-optionseditor__row"><div className="tf-optionseditor__rowbody"><DragHandle label="" reveal="always" isLifted /><span className="tf-optionseditor__swatch"><Swatch option={o} kind={kind} /></span><span className="tf-optionseditor__lifted">{o.label || 'Untitled'}</span></div></div> : null; }}>
        {(liveGroups) => groups.map((g) => (
          <OptionGroup
            key={g.id ?? 'all'} group={g.id} title={g.label} shape={g.shape} kind={kind}
            rows={(liveGroups[g.id ?? ALL] ?? []).map((id) => options.find((o) => o.id === id)).filter((o): o is EditableOption => Boolean(o))}
            fresh={fresh} dupes={dupes} undo={undo}
            onPatch={patch} onAdd={add} onLeave={dropIfEmpty} onArchive={archive} onRestore={restore}
          />
        ))}
      </DragArea>
      {dupes.size > 0 && <p className="tf-optionseditor__error" role="alert">Two {kind === 'status' ? 'stages' : 'options'} share a name. Rename one so people can tell them apart.</p>}
      {shelved.length > 0 && (
        <MenuTrigger>
          <Button size="sm" variant="ghost" icon={<ArchiveRestore size={14} strokeWidth={1.75} />} className="tf-optionseditor__shelf">{shelved.length} archived</Button>
          <Menu aria-label="Restore an archived option" onAction={(k) => restore(String(k))}>
            {shelved.map((o) => <MenuItem key={o.id} id={o.id} icon={<Swatch option={o} kind={kind} />} description="Restore">{o.label || 'Untitled'}</MenuItem>)}
          </Menu>
        </MenuTrigger>
      )}
    </section>
  );
}

interface GroupProps {
  readonly group?: StatusGroup;
  readonly title?: string;
  readonly shape?: StatusShape;
  readonly kind: 'select' | 'status';
  readonly rows: ReadonlyArray<EditableOption>;
  readonly fresh?: string;
  readonly dupes: ReadonlySet<string>;
  readonly undo: Readonly<Record<string, 'open' | 'closing'>>;
  readonly onPatch: (id: string, change: Partial<EditableOption>) => void;
  readonly onAdd: (group?: StatusGroup, after?: string) => void;
  readonly onLeave: (id: string) => void;
  readonly onArchive: (id: string) => void;
  readonly onRestore: (id: string) => void;
}

function OptionGroup({ group, title, shape, kind, rows, fresh, dupes, undo, onPatch, onAdd, onLeave, onArchive, onRestore }: GroupProps) {
  const noun = kind === 'status' ? 'stage' : 'option';
  const liveCount = rows.filter((o) => !o.archived).length;
  const drop = useDragGroup(group ?? ALL);
  return (
    <div className="tf-optionseditor__group">
      {title !== undefined && shape !== undefined && (
        <div className="tf-optionseditor__grouphead">
          <StatusIcon shape={shape} size={14} aria-hidden="true" />
          <span>{title}</span>
          <span className="tf-optionseditor__groupcount">{liveCount}</span>
        </div>
      )}
      <DragGroup id={group ?? ALL}>
        <ul ref={drop.ref} aria-label={title ?? 'Options'} className="tf-optionseditor__list" data-drop-target={(drop.isOver && kind === 'status') || undefined}>
          {rows.length === 0 && <li className="tf-optionseditor__empty">Drop a {noun} here</li>}
          {rows.map((o) => (
            <DragItem key={o.id} id={o.id} group={group ?? ALL} isDisabled={o.archived} className={cx('tf-optionseditor__row', o.archived && 'is-archived')}>
              {(d) => o.archived ? (
                <Collapse open={undo[o.id] === 'open'}>
                  <div className="tf-optionseditor__undo">
                    <span><strong>{o.label || 'Untitled'}</strong> archived. Records keep it.</span>
                    <Button size="sm" variant="ghost" onPress={() => onRestore(o.id)}>Undo</Button>
                  </div>
                </Collapse>
              ) : (
                <Row option={o} kind={kind} isFresh={fresh === o.id} isDupe={dupes.has(o.label.trim().toLowerCase())} grip={<DragHandle label={`Move ${o.label || 'untitled option'}`} isLifted={d.isDragging} drag={d.grip} reveal="always" />}
                  onPatch={onPatch} onEnter={() => onAdd(group, o.id)} onLeave={onLeave} onArchive={onArchive} />
              )}
            </DragItem>
          ))}
        </ul>
      </DragGroup>
      <Button size="sm" variant="ghost" icon={<Plus size={14} strokeWidth={1.75} />} className="tf-optionseditor__add" onPress={() => onAdd(group)}>Add {noun}</Button>
    </div>
  );
}

/** The colour at the start of a row: a hue dot, or the stage's status shape in its hue. */
function Swatch({ option, kind }: { readonly option: EditableOption; readonly kind: 'select' | 'status' }) {
  const style = { '--tf-opt-hue': `var(--dot-${option.hue})`, '--tf-opt-text': `var(--tag-${option.hue}-text)` } as CSSProperties;
  return kind === 'status' && option.shape
    ? <span className="tf-optionseditor__shape" style={style}><StatusIcon shape={option.shape} size={14} aria-hidden="true" /></span>
    : <span className="tf-optionseditor__dot" style={style} aria-hidden="true" />;
}

interface RowProps {
  readonly option: EditableOption;
  readonly kind: 'select' | 'status';
  readonly isFresh: boolean;
  readonly isDupe: boolean;
  readonly onPatch: (id: string, change: Partial<EditableOption>) => void;
  readonly onEnter: () => void;
  readonly onLeave: (id: string) => void;
  readonly onArchive: (id: string) => void;
  readonly grip: ReactNode;
}

function Row({ option: o, kind, isFresh, isDupe, grip, onPatch, onEnter, onLeave, onArchive }: RowProps) {
  const [picking, setPicking] = useState(false);
  const [entering, setEntering] = useState(isFresh);
  const before = useRef(o.label);
  useEffect(() => { if (!entering) return; const t = window.setTimeout(() => setEntering(false), 320); return () => window.clearTimeout(t); }, [entering]);
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); if (o.label.trim() !== '') onEnter(); }
    if (e.key === 'Escape') { onPatch(o.id, { label: before.current }); e.currentTarget.blur(); }
  };
  return (
    <div className={cx('tf-optionseditor__rowin', entering && 'is-new')}>
      <div className="tf-optionseditor__rowbody">
        {grip}
        <DialogTrigger isOpen={picking} onOpenChange={setPicking}>
          <AriaButton className="tf-optionseditor__swatch" aria-label={`Colour of ${o.label || 'untitled option'}: ${HUE_NAMES[o.hue]}`}><Swatch option={o} kind={kind} /></AriaButton>
          <Popover label={`Colour of ${o.label || 'untitled option'}`} placement="bottom start">
            <ColorSwatchPicker label="Colour" value={o.hue} onChange={(hue) => { onPatch(o.id, { hue }); window.setTimeout(() => setPicking(false), PICK_CLOSE_MS); }} />
          </Popover>
        </DialogTrigger>
        <TextField aria-label={`${kind === 'status' ? 'Stage' : 'Option'} name`} value={o.label} onChange={(v) => onPatch(o.id, { label: v })} className="tf-optionseditor__name" isInvalid={isDupe}>
          <Input
            className="tf-optionseditor__input" placeholder={kind === 'status' ? 'Type a stage' : 'Type an option'} autoFocus={isFresh} onKeyDown={keys}
            onFocus={() => { before.current = o.label; }} onBlur={() => onLeave(o.id)}
          />
        </TextField>
        <Tooltip label="Archive">
          <IconButton label={`Archive ${o.label || 'untitled option'}`} size="sm" className="tf-optionseditor__archive" onPress={() => onArchive(o.id)}><Archive size={14} strokeWidth={1.75} /></IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
