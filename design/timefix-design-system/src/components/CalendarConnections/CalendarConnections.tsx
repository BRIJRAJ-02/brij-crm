import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { AlertTriangle, ChevronDown, MoreHorizontal, Plus, RefreshCw, Unplug } from 'lucide-react';
import { Button, IconButton } from '../Button/Button.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { Tag, type Hue } from '../Tag/Tag.tsx';
import { MenuTrigger, Menu, MenuItem, MenuSection, MenuSeparator } from '../Menu/Menu.tsx';
import { cx } from '../../lib/cx.ts';
import './CalendarConnections.css';

/** A calendar provider. Drawn as a neutral letter tile, no brand marks. */
export type CalendarProvider = 'Google' | 'Outlook' | 'iCloud' | 'CalDAV';
/** One connected account. */
export interface CalendarAccount {
  readonly id: string;
  readonly provider: CalendarProvider;
  readonly email: string;
  readonly calendars: number;
  readonly status: 'connected' | 'reconnect';
  readonly checkConflicts: boolean;
}

/** One calendar inside an account (Work, Personal, Holidays): whether it's checked for conflicts, shown on your week, logs meetings to the CRM, and its colour. */
export interface CalendarItem { readonly id: string; readonly name: string; readonly conflicts: boolean; readonly week: boolean; readonly log: boolean; readonly colour: Hue }
const COLOURS: ReadonlyArray<{ readonly id: Hue; readonly label: string }> = [{ id: 'blue', label: 'Blue' }, { id: 'green', label: 'Green' }, { id: 'purple', label: 'Purple' }, { id: 'orange', label: 'Orange' }, { id: 'red', label: 'Red' }, { id: 'sky', label: 'Sky' }, { id: 'yellow', label: 'Yellow' }, { id: 'gray', label: 'Grey' }];

/** Props for CalendarConnections. */
export interface CalendarConnectionsProps {
  readonly accounts: ReadonlyArray<CalendarAccount>;
  readonly onCheckConflicts: (id: string, on: boolean) => void;
  /** Resolves when the account is connected again. */
  readonly onReconnect: (id: string) => Promise<void>;
  /** Runs the provider's connect flow; resolves when the new account is in `accounts`. */
  readonly onConnect: (provider: CalendarProvider) => Promise<void>;
  /** Providers offered under the list. */
  readonly providers?: ReadonlyArray<CalendarProvider>;
  /** Each account's own calendars; with `onCalendarChange` a row opens to set each one. */
  readonly calendarsOf?: (accountId: string) => ReadonlyArray<CalendarItem> | undefined;
  readonly onCalendarChange?: (accountId: string, calendarId: string, patch: Partial<CalendarItem>) => void;
  /** Disconnect from the row's menu. The consumer asks first (it ends the connection). */
  readonly onDisconnect?: (id: string) => void;
  /** Sync now from the row's menu; resolves when done. */
  readonly onSync?: (id: string) => Promise<void>;
  /** "Synced 2 min ago" under the list. */
  readonly syncedText?: string;
}

const NAME: Readonly<Record<CalendarProvider, string>> = { Google: 'Google Calendar', Outlook: 'Outlook Calendar', iCloud: 'iCloud Calendar', CalDAV: 'CalDAV' };
/** A provider as a neutral rounded tile with its first letter. */
export function ProviderTile({ provider }: { readonly provider: CalendarProvider }) {
  return <span className="tf-calconn__tile" aria-hidden="true">{provider.slice(0, 1)}</span>;
}

type Busy = Readonly<Record<string, 'pending' | 'done' | undefined>>;

/** A tick that draws in after a connect finishes (10 success check). */
function Done() {
  return <svg className="tf-calconn__check" width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7" pathLength={1} /></svg>;
}

/** Connected calendars: provider, account, status, a conflicts switch, reconnect, and a connect flow that confirms with a check. */
export function CalendarConnections({ accounts, onCheckConflicts, onReconnect, onConnect, providers = ['Google', 'Outlook', 'iCloud'], calendarsOf, onCalendarChange, onDisconnect, onSync, syncedText }: CalendarConnectionsProps) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const flipOpen = (id: string) => setOpenIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [busy, setBusy] = useState<Busy>({});
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [known] = useState(() => new Set(accounts.map((a) => a.id)));
  const mark = (key: string, v: 'pending' | 'done' | undefined) => setBusy((b) => ({ ...b, [key]: v }));
  const run = async (key: string, work: () => Promise<void>) => {
    mark(key, 'pending');
    try { await work(); mark(key, 'done'); window.setTimeout(() => mark(key, undefined), 1600); }
    catch { mark(key, undefined); }
  };
  const isNew = (id: string) => !known.has(id) && !fresh.has(id);
  return (
    <div className="tf-calconn">
      <ul className="tf-calconn__list" aria-label="Connected calendars">
        {accounts.map((a) => (
          <li key={a.id} className={cx('tf-calconn__row', isNew(a.id) && 'is-new')} onAnimationEnd={() => setFresh((s) => new Set(s).add(a.id))}>
            <div className="tf-calconn__row-inner">
              <ProviderTile provider={a.provider} />
              <span className="tf-calconn__who">
                <span className="tf-calconn__email">{a.email}</span>
                {(() => {
                  const items = calendarsOf?.(a.id);
                  const n = items?.length ?? a.calendars;
                  const toggles = items !== undefined && onCalendarChange !== undefined && a.status === 'connected';
                  const label = `${toggles ? a.provider : NAME[a.provider]} · ${n} ${n === 1 ? 'calendar' : 'calendars'}`;
                  return toggles
                    ? <button type="button" className="tf-calconn__sub tf-calconn__toggle tf-num" aria-expanded={openIds.has(a.id)} aria-controls={`tf-calconn-${a.id}`} onClick={() => flipOpen(a.id)}>{label}<ChevronDown size={14} strokeWidth={1.75} aria-hidden className="tf-calconn__chev" /></button>
                    : <span className="tf-calconn__sub tf-num">{label}</span>;
                })()}
              </span>
              <span className="tf-calconn__status" key={a.status} data-changed={busy[a.id] === 'done' || undefined}>
                {a.status === 'connected'
                  ? <Tag size="sm" status="done">Connected</Tag>
                  : <Tag size="sm" hue="orange" icon={<AlertTriangle size={12} strokeWidth={2} aria-hidden />}>Needs reconnect</Tag>}
              </span>
              <span className="tf-calconn__end">
                {a.status === 'reconnect' ? (
                  <Button size="sm" variant="primary" isPending={busy[a.id] === 'pending'} onPress={() => run(a.id, () => onReconnect(a.id))}>Reconnect</Button>
                ) : (
                  <Switch isSelected={a.checkConflicts} onChange={(v) => onCheckConflicts(a.id, v)}>Check for conflicts</Switch>
                )}
                {(onSync || onDisconnect) && (
                  <MenuTrigger>
                    <IconButton size="sm" label={`More for ${a.email}`} isPending={busy[`sync:${a.id}`] === 'pending'}><MoreHorizontal size={16} strokeWidth={1.75} /></IconButton>
                    <Menu aria-label={`${a.email} actions`} placement="bottom end" onAction={(k) => { if (k === 'sync' && onSync) void run(`sync:${a.id}`, () => onSync(a.id)); else if (k === 'off') onDisconnect?.(a.id); }}>
                      {onSync && <MenuItem id="sync" icon={<RefreshCw size={16} strokeWidth={1.75} />} isDisabled={a.status !== 'connected'}>Sync now</MenuItem>}
                      {onSync && onDisconnect && <MenuSeparator />}
                      {onDisconnect && <MenuItem id="off" icon={<Unplug size={16} strokeWidth={1.75} />} isDanger>Disconnect</MenuItem>}
                    </Menu>
                  </MenuTrigger>
                )}
              </span>
            </div>
            {openIds.has(a.id) && onCalendarChange && (
              <ul className="tf-calconn__cals" id={`tf-calconn-${a.id}`} aria-label={`Calendars in ${a.email}`}>
                {(calendarsOf?.(a.id) ?? []).map((c) => (
                  <li key={c.id} className="tf-calconn__cal">
                    <MenuTrigger>
                      <AriaButton className="tf-calconn__dot" data-hue={c.colour} aria-label={`${c.name} colour: ${COLOURS.find((x) => x.id === c.colour)?.label ?? c.colour}. Change`} />
                      <Menu aria-label={`${c.name} colour`} placement="bottom start">
                        <MenuSection title="Colour" selectionMode="single" selectedKeys={[c.colour]} onSelectionChange={(k) => { const v = [...(k as Set<string | number>)][0]; if (v) onCalendarChange(a.id, c.id, { colour: String(v) as Hue }); }}>
                          {COLOURS.map((x) => <MenuItem key={x.id} id={x.id} icon={<span className="tf-calconn__dot tf-calconn__dot--sm" data-hue={x.id} aria-hidden="true" />}>{x.label}</MenuItem>)}
                        </MenuSection>
                      </Menu>
                    </MenuTrigger>
                    <span className="tf-calconn__calname">{c.name}</span>
                    <span className="tf-calconn__calopts">
                      <Checkbox isSelected={c.conflicts} isDisabled={!a.checkConflicts} onChange={(v) => onCalendarChange(a.id, c.id, { conflicts: v })}>Conflicts</Checkbox>
                      <Checkbox isSelected={c.week} onChange={(v) => onCalendarChange(a.id, c.id, { week: v })}>On my week</Checkbox>
                      <Checkbox isSelected={c.log} onChange={(v) => onCalendarChange(a.id, c.id, { log: v })}>Log to CRM</Checkbox>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <div className="tf-calconn__add">
        <span className="tf-calconn__add-label">{syncedText ? <span className="tf-num">{syncedText} · </span> : null}Add a calendar</span>
        <span className="tf-calconn__providers">
          {providers.map((p) => {
            const state = busy[`new:${p}`];
            return (
              <Button key={p} size="sm" isPending={state === 'pending'} onPress={() => { if (!state) void run(`new:${p}`, () => onConnect(p)); }}
                icon={state === 'done' ? <Done /> : <Plus size={14} strokeWidth={1.75} />} aria-label={state === 'done' ? `${NAME[p]} connected` : `Connect ${NAME[p]}`}>
                <span className="tf-calconn__label" key={state ?? 'idle'}>{state === 'done' ? 'Connected' : p}</span>
              </Button>
            );
          })}
        </span>
      </div>
    </div>
  );
}
