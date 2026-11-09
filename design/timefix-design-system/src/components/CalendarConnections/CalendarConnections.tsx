import { useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Tag } from '../Tag/Tag.tsx';
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
export function CalendarConnections({ accounts, onCheckConflicts, onReconnect, onConnect, providers = ['Google', 'Outlook', 'iCloud'] }: CalendarConnectionsProps) {
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
                <span className="tf-calconn__sub tf-num">{NAME[a.provider]} · {a.calendars} {a.calendars === 1 ? 'calendar' : 'calendars'}</span>
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
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="tf-calconn__add">
        <span className="tf-calconn__add-label">Add a calendar</span>
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
