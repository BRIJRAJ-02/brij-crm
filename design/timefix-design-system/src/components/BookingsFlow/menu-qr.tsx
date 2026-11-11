// Table QR codes for the Menu app (spec 0065 H2), in checklabs' Tables flow: zone chips (All, each zone with its count, Unzoned last; the
// chosen chip again shows all), "12 of 20 tables · 2 selected" with Print QR sheet and Clear, then a card a table: tick, code, label, seats,
// download and ⋯ (View menu, Analytics with its scans, Copy link, PNG, New code…). Print sheet: A4 tiles (six a page) or tent cards.
import { copyText } from '../../lib/copy.ts';
import { useRef, useState } from 'react';
import { BarChart3, Copy, Download, Eye, MoreHorizontal, Printer, QrCode as QrIcon } from 'lucide-react';
import { Button, IconButton } from '../Button/Button.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Checkbox } from '../Checkbox/Checkbox.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../Menu/Menu.tsx';
import { QrCode, downloadQr, qrPrintSheet, qrSheet } from '../QrCode/QrCode.tsx';
import { useToast } from '../Toast/Toast.tsx';
import type { Hue } from '../Tag/Tag.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import { cx } from '../../lib/cx.ts';
import { i14, i16 } from './parts.tsx';
import { seatsText } from './tables.tsx';
import { plural, tableMenuUrl, tableCode, type BookingsAction, type BookingsState, type Table } from './state.ts';

const HUES: ReadonlyArray<Hue> = ['blue', 'green', 'orange', 'purple', 'sky', 'red', 'lime', 'yellow'];
/** A zone's colour, picked from its name so it stays put. */
export const zoneHue = (z: string): Hue => (z ? HUES[[...z].reduce((n, ch) => n + ch.charCodeAt(0), 0) % HUES.length] ?? 'blue' : 'gray');
/** Reading order: T2 before T10. */
const natural = (a: Table, b: Table) => a.name.localeCompare(b.name, undefined, { numeric: true });
/** Menu opens from the table's code in 30 days: the held count, else a steady made-up one for the prototype. */
export const scansOf = (t: Table) => t.scans ?? ([...(t.code ?? t.name)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 90) + 6;

/** A code on every table: scanning opens the menu with the table set, so staff know where the guest sits. */
export function QrCodes({ state, dispatch, onGuest, onTables }: { readonly state: BookingsState; readonly dispatch: (a: BookingsAction) => void; readonly onGuest: (table?: string) => void; readonly onTables: () => void }) {
  const { toast } = useToast();
  const tables = (state.tables ?? []).filter((t) => !t.archived);
  const zones = [...new Set(tables.map((t) => t.area))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  const refs = useRef<Record<string, SVGSVGElement | null>>({});
  const [zone, setZone] = useState<string>();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [renew, setRenew] = useState<Table>();
  const [stats, setStats] = useState<Table>();
  const [printing, setPrinting] = useState(false);
  const live = (state.menuLive?.menus ?? []).some((m) => m.isLive);
  const shown = tables.filter((t) => zone === undefined || t.area === zone);
  const saved = (o: string) => { if (o === 'saved') toast({ message: 'Saved to your downloads', tone: 'success' }); else if (o === 'failed') toast({ message: 'Couldn’t save the file. Try again.' }); };
  const forPrint = picked.size ? tables.filter((t) => picked.has(t.id)) : shown;
  const all = async () => {
    const codes = tables.flatMap((t) => { const svg = refs.current[t.id]; return svg ? [{ svg, label: t.name, line: 'Scan for the menu' }] : []; });
    saved(await saveFile(`${state.business?.handle ?? 'menu'}-table-codes.svg`, new Blob([qrSheet(codes, `${state.workspace} · table codes`)], { type: 'image/svg+xml' })));
  };
  const pick = (id: string, on: boolean) => setPicked((x) => { const n = new Set(x); if (on) n.add(id); else n.delete(id); return n; });
  if (tables.length === 0) return <EmptyState icon={<QrIcon size={20} strokeWidth={1.75} />} title="No tables yet" description="Add your tables, then print a code for each." action={<Button variant="primary" onPress={onTables}>Add tables</Button>} />;
  return (
    <div className="tf-bkf__stack">
      {!live && <Callout tone="warning">No menu is on show, so a scan opens an empty page. Show a menu first.</Callout>}
      <div className="tf-bkf__bar">
        <span className="tf-bkf__muted">Each table gets its own code. Guests scan it to open the menu with their table set.</span>
        <span className="tf-bkf__spacer" />
        <Button variant="ghost" onPress={onTables}>Edit tables</Button>
        <Button variant="secondary" icon={<Download {...i14} />} onPress={() => { void all(); }}>Download all</Button>
      </div>
      <ChoiceChips label="Zones" isLabelHidden selectionMode="single" size="sm" selectedKeys={[zone === undefined ? '__all' : zone || '__none']}
        items={[{ id: '__all', label: `All · ${tables.length}` }, ...zones.map((z) => ({ id: z || '__none', label: `${z || 'Unzoned'} · ${tables.filter((t) => t.area === z).length}`, dot: zoneHue(z) }))]}
        onSelectionChange={(k) => { const v = [...k][0]; const next = v === undefined || v === '__all' ? undefined : v === '__none' ? '' : v; setZone(next === zone ? undefined : next); setPicked(new Set()); }} />
      <div className="tf-bkf__bar">
        <span className="tf-bkf__muted tf-num" role="status">{shown.length} of {plural(tables.length, 'table')}{picked.size ? ` · ${picked.size} selected` : ''}</span>
        <span className="tf-bkf__spacer" />
        {picked.size > 0 && <Button size="sm" variant="ghost" onPress={() => setPicked(new Set())}>Clear</Button>}
        <Button size="sm" variant="secondary" icon={<Printer {...i14} />} onPress={() => setPrinting(true)}>Print QR sheet</Button>
      </div>
      {zones.filter((z) => zone === undefined || z === zone).map((a) => (
        <section key={a || 'unzoned'} className="tf-bkf-qrarea" aria-label={a || 'Unzoned'}>
          <h3 className="tf-bkf-res-group__h"><span className="tf-bkf-qrarea__name"><span className={`tf-bkf-qrarea__dot tf-bkf-qrarea__dot--${zoneHue(a)}`} aria-hidden="true" />{a || 'Unzoned'}</span><span className="tf-bkf__muted tf-num">{plural(tables.filter((t) => t.area === a).length, 'table')}</span></h3>
          <ul className="tf-bkf-qrgrid">
            {tables.filter((t) => t.area === a).sort(natural).map((t) => (
              <li key={t.id} className={cx('tf-bkf-qrcard', picked.has(t.id) && 'is-picked')}>
                <QrCode value={`https://${tableMenuUrl(state, t)}`} label={`QR code for ${t.name}'s menu`} size="sm" withLogo ground="paper" ref={(el) => { refs.current[t.id] = el; }} />
                <span className="tf-bkf-qrcard__text"><span className="tf-bkf-qrcard__title"><Checkbox aria-label={`Select ${t.name}`} isSelected={picked.has(t.id)} onChange={(on) => pick(t.id, on)} /><strong>{t.name}</strong></span>
                  <span className="tf-bkf__muted tf-num">{seatsText(t)}</span><span className="tf-bkf__muted tf-num tf-bkf-qrcard__code">{t.code ?? '—'}</span></span>
                <span className="tf-bkf-res__acts">
                  <IconButton size="sm" label={`Download ${t.name}'s code`} onPress={() => { const svg = refs.current[t.id]; if (svg) void downloadQr(svg, `${t.name}-menu`, 'svg').then(saved); }}><Download {...i14} /></IconButton>
                  <MenuTrigger>
                    <IconButton size="sm" label={`More for ${t.name}`}><MoreHorizontal {...i14} /></IconButton>
                    <Menu aria-label={`${t.name} code`} placement="bottom end" onAction={(k) => {
                      if (k === 'open') onGuest(t.code ?? t.name);
                      else if (k === 'stats') setStats(t);
                      else if (k === 'copy') { void copyText(`https://${tableMenuUrl(state, t)}`).then((ok) => toast(ok ? { message: 'Link copied', tone: 'success' } : { message: `Copy didn’t work. Select the link and copy it: ${`https://${tableMenuUrl(state, t)}`}`, tone: 'danger' })); }
                      else if (k === 'png') { const svg = refs.current[t.id]; if (svg) void downloadQr(svg, `${t.name}-menu`, 'png').then(saved); }
                      else if (k === 'renew') setRenew(t);
                    }}>
                      <MenuItem id="open" icon={<Eye {...i16} />}>Scan it as a guest</MenuItem>
                      <MenuItem id="stats" icon={<BarChart3 {...i16} />} description={`${scansOf(t)} scans in 30 days`}>Analytics</MenuItem>
                      <MenuItem id="copy" icon={<Copy {...i16} />} description={tableMenuUrl(state, t)}>Copy link</MenuItem>
                      <MenuItem id="png" icon={<Download {...i16} />}>Download PNG</MenuItem>
                      <MenuSeparator />
                      <MenuItem id="renew" icon={<QrIcon {...i16} />}>New code…</MenuItem>
                    </Menu>
                  </MenuTrigger>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {printing && <PrintSheet urlOf={(t) => `https://${tableMenuUrl(state, t)}`} tables={[...forPrint].sort(natural)} refs={refs.current} title={state.workspace} onClose={() => setPrinting(false)} onSaved={saved} />}
      {stats && <Dialog isOpen onOpenChange={(o) => { if (!o) setStats(undefined); }} title={`${stats.name} · scans`} description="How often guests opened the menu from this table’s code." actions={<Button variant="primary" slot="close">Done</Button>}>
        <dl className="tf-bkf-qrstats">
          <div><dt>Last 30 days</dt><dd className="tf-num">{scansOf(stats)}</dd></div>
          <div><dt>A day, on average</dt><dd className="tf-num">{(scansOf(stats) / 30).toFixed(1)}</dd></div>
          <div><dt>Busiest of the {plural(tables.length, 'table')}</dt><dd className="tf-num">#{[...tables].sort((a, b) => scansOf(b) - scansOf(a)).findIndex((x) => x.id === stats.id) + 1}</dd></div>
        </dl>
      </Dialog>}
      {renew && (
        <Dialog isOpen onOpenChange={(o) => { if (!o) setRenew(undefined); }} title={`New code for ${renew.name}?`} description="The printed code on this table stops working. Print the new one before you put it out."
          actions={<><Button variant="ghost" slot="close">Keep this code</Button><Button variant="danger" onPress={() => {
            dispatch({ type: 'tables/set', tables: (state.tables ?? []).map((x) => (x.id === renew.id ? { ...x, code: tableCode(x.name) } : x)) });
            setRenew(undefined); toast({ message: `${renew.name} has a new code. Download it to print.`, tone: 'success' });
          }}>Make a new code</Button></>} />
      )}
    </div>
  );
}

/** The print sheet: A4 tiles (six a page) or tent cards (two a page), previewed as it prints, then saved for the printer. */
function PrintSheet({ urlOf, tables, refs, title, onClose, onSaved }: { readonly urlOf: (t: Table) => string; readonly tables: ReadonlyArray<Table>; readonly refs: Readonly<Record<string, SVGSVGElement | null>>; readonly title: string; readonly onClose: () => void; readonly onSaved: (o: string) => void }) {
  const [layout, setLayout] = useState<'tiles' | 'tents'>('tiles');
  const per = layout === 'tiles' ? 6 : 2;
  const pages = Math.max(1, Math.ceil(tables.length / per));
  const save = async () => {
    const codes = tables.flatMap((t) => { const svg = refs[t.id]; return svg ? [{ svg, label: t.name, line: 'Scan for the menu' }] : []; });
    onSaved(await saveFile(`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${layout === 'tiles' ? 'qr-tiles' : 'tent-cards'}.svg`, new Blob([qrPrintSheet(codes, layout, title)], { type: 'image/svg+xml' })));
  };
  return (
    <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) onClose(); }} title="Print QR sheet" description={`${plural(tables.length, 'table')} · scan-ready · ${plural(pages, 'A4 page')}`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" icon={<Printer {...i14} />} onPress={() => { void save(); }}>Save for printing</Button></>}>
      <div className="tf-bkf__stack">
        <SegmentedControl aria-label="Layout" size="sm" selectedKey={layout} onSelectionChange={(k) => setLayout(k === 'tents' ? 'tents' : 'tiles')} items={[{ id: 'tiles', label: 'A4 tiles, six a page' }, { id: 'tents', label: 'Tent cards, two a page' }]} />
        <div className="tf-bkf-print" aria-label="Preview of the first page">
          <div className={cx('tf-bkf-print__page', `tf-bkf-print__page--${layout}`)}>
            {tables.slice(0, per).map((t) => (
              <div key={t.id} className="tf-bkf-print__cell">
                {layout === 'tents' && <div className="tf-bkf-print__flip" aria-hidden="true"><QrCode value={urlOf(t)} label="" size="fill" ground="paper" /><strong>{t.name}</strong></div>}
                <div className="tf-bkf-print__face"><QrCode value={urlOf(t)} label={`${t.name}'s code`} size="fill" ground="paper" /><strong>{t.name}</strong><span>Scan for the menu</span></div>
              </div>
            ))}
          </div>
        </div>
        {pages > 1 && <p className="tf-bkf__muted">The first page is shown; {pages - 1} more follow in the same layout.</p>}
      </div>
    </Dialog>
  );
}
