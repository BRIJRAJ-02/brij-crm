// Tables, for a business that books them: by area, seats, online or staff only, and whether one joins its neighbour. Lives in Availability.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextField } from '../Field/Field.tsx';
import { NumberField } from '../NumberField/NumberField.tsx';
import { Select } from '../Select/Select.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { Section, SettingRow, i14 } from './parts.tsx';
import { nextId, plural, type BookingsAction, type BookingsState, type Table } from './state.ts';

/** The Tables card. Add several at once by typing a run ("T10 to T14"). */
export function TablesSection({ state, dispatch }: { readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void }) {
  const { toast } = useToast();
  const tables = state.tables ?? [];
  const areas = [...new Set(tables.map((t) => t.area))];
  const [adding, setAdding] = useState(false);
  const [range, setRange] = useState('');
  const [seats, setSeats] = useState(4);
  const [area, setArea] = useState(areas[0] ?? 'Main room');
  const set = (t: Table) => dispatch({ type: 'tables/set', tables: tables.map((x) => (x.id === t.id ? t : x)) });
  const names = (() => {
    const m = range.trim().match(/^([A-Za-z]*)(\d+)\s*(?:to|-|–)\s*[A-Za-z]*(\d+)$/);
    if (m) { const [, p = '', a = '0', b = '0'] = m; const lo = Number(a); const hi = Math.min(Number(b), lo + 30); return hi >= lo ? Array.from({ length: hi - lo + 1 }, (_, n) => `${p}${lo + n}`) : []; }
    return range.trim() ? [range.trim()] : [];
  })();
  return (
    <Section title="Tables" description={`${plural(tables.length, 'table')} · ${tables.reduce((s, t) => s + t.seats, 0)} seats. Guests are given the best fit; joinable tables pair up for bigger parties.`}
      action={<Button size="sm" variant="secondary" icon={<Plus {...i14} />} onPress={() => { setRange(''); setAdding(true); }}>Add tables</Button>}>
      {areas.map((a) => (
        <div key={a} className="tf-bkf-settings">
          <span className="tf-bkf__label">{a}</span>
          {tables.filter((t) => t.area === a).map((t) => (
            <SettingRow key={t.id} title={`${t.name} · seats ${t.seats}`} description={t.joinable ? 'Joins its neighbour for bigger parties' : undefined}>
              <span className="tf-bkf-setting__pair">
                <Switch aria-label={`${t.name} joins its neighbour`} isSelected={t.joinable} onChange={(joinable) => set({ ...t, joinable })}><span className="tf-bkf__onword">Joins</span></Switch>
                <Switch aria-label={`${t.name} bookable online`} isSelected={t.online} onChange={(online) => set({ ...t, online })}><span className="tf-bkf__onword">{t.online ? 'Online' : 'Staff only'}</span></Switch>
              </span>
            </SettingRow>
          ))}
        </div>
      ))}
      <Dialog isOpen={adding} onOpenChange={setAdding} title="Add tables" description="One name, or a run like T10 to T14."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={names.length === 0} onPress={() => {
          dispatch({ type: 'tables/set', tables: [...tables, ...names.map((n) => ({ id: nextId('t'), name: n, seats, area, online: true, joinable: false }))] });
          setAdding(false); toast({ message: `${plural(names.length, 'table')} added`, tone: 'success' });
        }}>{names.length > 1 ? `Add ${names.length} tables` : 'Add table'}</Button></>}>
        <div className="tf-bkf__stack">
          <TextField label="Names" value={range} onChange={setRange} placeholder="T10 to T14" autoFocus description={names.length > 1 ? `${names[0]} … ${names[names.length - 1]}` : undefined} />
          <div className="tf-bkf__pair">
            <NumberField label="Seats each" value={seats} minValue={1} maxValue={20} onChange={(n) => setSeats(Number.isFinite(n) ? n : 2)} />
            <Select label="Area" value={area} onChange={(v) => setArea(v ?? area)} items={[...new Set([...areas, 'Main room', 'Terrace'])].map((x) => ({ id: x, label: x }))} />
          </div>
        </div>
      </Dialog>
    </Section>
  );
}
