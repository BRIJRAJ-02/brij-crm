// Brief
// Purpose: the Tables page (spec 0065, H2), in checklabs' Tables page's order: a line of help, the zones as chips
// (All, each zone with its colour, Unzoned last), "12 of 20 tables" with Print QR sheet (the picked tables, else the
// zone shown) and Clear, then a card per zone of its tables (Table, Seats, Code; QR and Edit, the rest in ⋯); one
// drawer adds or edits a table, another holds its QR code; the whole place's codes download as a zip.
// Main task: set up the tables and get a printed code onto every one.
// Leaves out: the floor plan editor and per table menus (not ours), joins and online booking (the place's page), and
// the fuller scan picture (spec 0067's Insights): a table's scans sit in its ⋯ as Analytics.
import type { BusinessView, HospitalityStore, Place, PlaceFloor, PlaceQrCodes, Resource, TableQr } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import {
  Button,
  ButtonGroup,
  ButtonLink,
  Callout,
  Card,
  CardTitleLevel,
  ChoiceChips,
  Code,
  DescriptionList,
  EmptyState,
  focusLater,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  PageColumn,
  QrCode,
  SectionBar,
  Select,
  Skeleton,
  Table,
  TopBar,
  VisuallyHidden,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { saveFile } from '../link-page/qr-png.ts';
import { useIsNarrow } from '../menus/narrow.ts';
import { businessSettingsHref } from '../settings/nav.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { qrPrintHref, type QrLook } from './look.ts';
import { codeFile, codeFileName, tableMenuAddress, zipCodes, type DrawnCode } from './codes.ts';
import { strings } from './strings.ts';
import { TableDrawer } from './TableDrawer.tsx';
import { ALL_ZONES, UNZONED, zoneGroups, type ZoneGroup } from './zones.ts';

/** A zone card's columns, after checklabs' Label, Cap. and Code (its Venue and Menu are one per place here). */
const COLUMNS: readonly TableColumn[] = [
  { id: 'table', label: strings.table, isRowHeader: true, size: 'fill' },
  { id: 'seats', label: strings.seats, align: 'end', size: 'fit' },
  { id: 'code', label: strings.code, size: 'fit' },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

/** At a phone's width a row keeps its name, its whole code (wrapping) and ⋯; the seats are in its drawer. */
const NARROW_COLUMNS: readonly TableColumn[] = [
  { id: 'table', label: strings.table, isRowHeader: true, size: 'fit' },
  { id: 'code', label: strings.code, size: 'fill' },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

/** What a drawer or dialog is open for. */
type Open =
  | { readonly kind: 'add' }
  | { readonly kind: 'edit'; readonly table: Resource }
  | { readonly kind: 'delete'; readonly table: Resource }
  | { readonly kind: 'code'; readonly id: string }
  | { readonly kind: 'analytics'; readonly id: string }
  | { readonly kind: 'renew'; readonly table: TableQr };

/** The page: the place switcher, then the place's tables. */
export function QrScreen({
  slug,
  hospitality,
  look,
  toasts,
}: {
  readonly slug: string;
  readonly hospitality: HospitalityStore;
  readonly look: QrLook;
  readonly toasts: Toasts;
}) {
  const held = hospitality.business(slug);
  const business = useHospitality(held);
  const [placeId, setPlaceId] = useState<string | undefined>();
  const topBar = <TopBar title={strings.title} icon="qr-code" />;
  if (business.status === 'loading') {
    return <WorkspacePage currentPage="qr" page={{ topBar, body: <Skeleton shape="block" /> }} />;
  }
  if (business.status === 'error') {
    return (
      <WorkspacePage
        currentPage="qr"
        page={{ topBar, body: <EmptyState tone="error" title={strings.failed} onRetry={held.retry} /> }}
      />
    );
  }
  const place = business.value.places.find((each) => each.id === placeId) ?? business.value.places[0];
  if (place === undefined) {
    return (
      <WorkspacePage
        currentPage="qr"
        page={{
          topBar,
          body: (
            <EmptyState
              icon="store"
              title={strings.noPlace}
              actions={
                <ButtonLink href={businessSettingsHref(slug)} variant="primary" icon="store">
                  {strings.addPlace}
                </ButtonLink>
              }
            />
          ),
        }}
      />
    );
  }
  return (
    <PlaceCodes
      key={place.id}
      slug={slug}
      hospitality={hospitality}
      business={business.value}
      place={place}
      onPlace={setPlaceId}
      look={look}
      toasts={toasts}
    />
  );
}

/** One place's tables: the bar's switcher, Download all and Add table, then the zones, the count and the cards. */
function PlaceCodes({
  slug,
  hospitality,
  business,
  place,
  onPlace,
  look,
  toasts,
}: {
  readonly slug: string;
  readonly hospitality: HospitalityStore;
  readonly business: BusinessView;
  readonly place: Place;
  readonly onPlace: (placeId: string) => void;
  readonly look: QrLook;
  readonly toasts: Toasts;
}) {
  const held = hospitality.qrCodes(slug, place.id);
  const state = useHospitality(held);
  useEffect(() => held.retain(), [held]);
  // The place's floor (seats, zones, and Add, Edit and Delete), read while the page is open.
  const floorHeld = hospitality.floor(slug, place.id);
  const floorState = useHospitality(floorHeld);
  useEffect(() => floorHeld.retain(), [floorHeld]);
  const floor = floorState.status === 'ready' ? floorState.value : undefined;
  const [open, setOpen] = useState<Open | undefined>();
  // Kept while a dialog closes, so its title never reads "Delete ?" on the way out.
  const [lastOpen, setLastOpen] = useState<Open | undefined>();
  if (open !== undefined && open !== lastOpen) setLastOpen(open);
  const [zone, setZone] = useState<string>(ALL_ZONES);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const isNarrow = useIsNarrow();
  const [zipping, setZipping] = useState(false);
  const codes = state.status === 'ready' ? state.value : undefined;
  const tables = useMemo(() => codes?.tables ?? [], [codes]);
  const hasTables = tables.length > 0;
  const venue = business.profile?.name ?? place.name;
  const close = () => setOpen(undefined);

  const placeSwitch =
    business.places.length > 1 ? (
      <Select
        label={strings.place}
        isLabelHidden
        items={business.places.map((each) => ({ id: each.id, label: each.name }))}
        value={place.id}
        onChange={(next) => {
          if (typeof next === 'string') onPlace(next);
        }}
      />
    ) : undefined;
  const topBar = (
    <TopBar title={strings.title} icon="qr-code">
      {placeSwitch}
      {hasTables && (
        // One click with the preset: every table, PNG at 512 pixels, one zip. SVG is in each table's QR drawer.
        <Button
          icon="download"
          {...(isNarrow ? { label: strings.downloadAllLabel } : { children: strings.downloadAll })}
          isPending={zipping}
          onPress={() => setZipping(true)}
        />
      )}
      {floor === undefined ? null : (
        <Button
          variant="primary"
          icon="plus"
          {...(isNarrow ? { label: strings.addTable } : { children: strings.addTable })}
          onPress={() => setOpen({ kind: 'add' })}
        />
      )}
    </TopBar>
  );

  if (state.status !== 'ready') {
    return (
      <WorkspacePage
        currentPage="qr"
        page={{
          topBar,
          body:
            state.status === 'loading' ? (
              <Skeleton shape="block" />
            ) : (
              <EmptyState tone="error" title={strings.failed} onRetry={held.retry}>
                {state.error.message}
              </EmptyState>
            ),
        }}
      />
    );
  }
  const value = state.value;
  const shown = (id: string) => tables.find((table) => table.id === id);
  const showing = open ?? lastOpen;
  const codeTable = showing?.kind === 'code' || showing?.kind === 'analytics' ? shown(showing.id) : undefined;
  const editing = showing?.kind === 'edit' ? showing.table : undefined;
  const editingCode = editing === undefined ? undefined : shown(editing.id);

  return (
    <WorkspacePage
      currentPage="qr"
      page={{
        topBar,
        body: (
          <PageColumn>
            <SectionBar description={strings.help} />
            <MenuState slug={slug} codes={value} />
            <TablesByZone
              slug={slug}
              placeId={place.id}
              codes={value}
              floor={floor}
              zone={zone}
              onZone={setZone}
              picked={picked}
              onPicked={setPicked}
              onOpen={setOpen}
            />
            {floor === undefined || (open?.kind !== 'add' && open?.kind !== 'edit') ? null : (
              <TableDrawer
                key={open.kind === 'edit' ? open.table.id : 'add'}
                floor={floor}
                {...(open.kind === 'edit' ? { table: open.table } : {})}
                {...(editingCode === undefined
                  ? {}
                  : {
                      code: {
                        code: editingCode.code,
                        address: tableMenuAddress(value.menuKey, editingCode.code),
                      },
                    })}
                {...(zone === ALL_ZONES || zone === UNZONED ? {} : { startZone: zone })}
                onCreateZone={async (name) => {
                  const id = hospitality.newId();
                  const refused = await hospitality.saveArea(slug, place.id, name, undefined, id);
                  if (refused !== undefined) throw refused;
                  return id;
                }}
                onAdd={async (input) => {
                  const refused = await hospitality.addResources(slug, place.id, { kind: 'table', ...input });
                  if (refused !== undefined) throw refused;
                }}
                onSave={async (table, change) => {
                  const refused = await hospitality.updateResource(slug, place.id, table.id, change);
                  if (refused !== undefined) throw refused;
                }}
                onClose={close}
                toasts={toasts}
              />
            )}
            <Modal
              isOpen={open?.kind === 'delete'}
              onOpenChange={(isOpen) => {
                if (!isOpen) close();
              }}
              title={strings.deleteTitle(showing?.kind === 'delete' ? showing.table.label : '')}
              variant="confirm"
              tone="danger"
              actions={
                <>
                  <Button slot="close">{strings.cancel}</Button>
                  <Button
                    variant="danger-solid"
                    onPress={() => {
                      if (open?.kind !== 'delete') return;
                      const { table } = open;
                      void hospitality.deleteResource(slug, place.id, table.id).then((refused) => {
                        toasts.toast(
                          refused === undefined
                            ? { tone: 'success', message: strings.deleted(table.label) }
                            : { tone: 'danger', message: refused.message },
                        );
                      });
                      setPicked((was) => new Set([...was].filter((id) => id !== table.id)));
                      close();
                      // The row's ⋯ goes with the row: focus moves to the page's heading.
                      focusLater(() => document.querySelector<HTMLElement>('h1'));
                    }}
                  >
                    {strings.delete}
                  </Button>
                </>
              }
            >
              {strings.deleteText}
            </Modal>
            {zipping ? (
              <ZipAll
                codes={value}
                venue={venue}
                look={look}
                onDone={(failed) => {
                  setZipping(false);
                  toasts.toast(
                    failed
                      ? { tone: 'danger', message: strings.downloadFailed }
                      : { tone: 'success', message: strings.zipped(tables.length) },
                  );
                }}
              />
            ) : null}
            <TableCodeDrawer
              table={showing?.kind === 'code' ? codeTable : undefined}
              codes={value}
              look={look}
              isOpen={open?.kind === 'code' && codeTable !== undefined}
              onClose={close}
              toasts={toasts}
            />
            <Modal
              isOpen={open?.kind === 'analytics' && codeTable !== undefined}
              onOpenChange={(isOpen) => {
                if (!isOpen) close();
              }}
              title={strings.analyticsTitle(showing?.kind === 'analytics' ? (codeTable?.label ?? '') : '')}
              actions={
                <Button variant="primary" slot="close">
                  {strings.close}
                </Button>
              }
            >
              {codeTable === undefined ? null : (
                <>
                  <DescriptionList
                    items={[
                      { term: strings.scans, description: String(codeTable.scans) },
                      { term: strings.code, description: <Code>{codeTable.code}</Code> },
                    ]}
                  />
                  {strings.scansLine}
                </>
              )}
            </Modal>
            <Modal
              isOpen={open?.kind === 'renew'}
              onOpenChange={(isOpen) => {
                if (!isOpen) close();
              }}
              title={strings.newCodeTitle(showing?.kind === 'renew' ? showing.table.label : '')}
              variant="confirm"
              tone="danger"
              actions={
                <>
                  <Button slot="close">{strings.cancel}</Button>
                  <Button
                    variant="danger-solid"
                    onPress={() => {
                      if (open?.kind !== 'renew') return;
                      const { table } = open;
                      close();
                      void hospitality.regenerateTableCode(slug, place.id, table.id).then((refused) => {
                        toasts.toast(
                          refused === undefined
                            ? { tone: 'success', message: strings.newCodeDone(table.label) }
                            : { tone: 'danger', message: refused.message },
                        );
                      });
                    }}
                  >
                    {strings.newCodeConfirm}
                  </Button>
                </>
              }
            >
              {strings.newCodeText}
            </Modal>
          </PageColumn>
        ),
      }}
    />
  );
}

/** Says why a scan shows nothing yet: the menu was never published, or it is hidden. */
export function MenuState({ slug, codes }: { readonly slug: string; readonly codes: PlaceQrCodes }) {
  if (codes.menuState === 'live') return null;
  return (
    <Callout
      tone="warning"
      actions={
        <ButtonLink href={`/w/${slug}/menus`} icon="utensils">
          {strings.openMenus}
        </ButtonLink>
      }
    >
      {codes.menuState === 'unpublished' ? strings.unpublished : strings.hidden}
    </Callout>
  );
}

/**
 * One table's QR in a drawer (checklabs' QR sheet): the code large, its Code and Link to read and copy, then Open
 * menu, SVG and PNG at 512 pixels. A new code is the row's ⋯, never here.
 */
function TableCodeDrawer({
  table,
  codes,
  look,
  isOpen,
  onClose,
  toasts,
}: {
  readonly table: TableQr | undefined;
  readonly codes: PlaceQrCodes;
  readonly look: QrLook;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly toasts: Toasts;
}) {
  const codeRef = useRef<SVGSVGElement>(null);
  const [saving, setSaving] = useState<'png' | 'svg' | undefined>();
  // Kept while the drawer closes, so its exit shows the code it had.
  const [last, setLast] = useState(table);
  if (table !== undefined && table !== last) setLast(table);
  const showing = table ?? last;
  if (showing === undefined) return null;
  const name = showing.label;
  const address = tableMenuAddress(codes.menuKey, showing.code);
  const save = (format: 'png' | 'svg') => {
    const svg = codeRef.current;
    if (svg === null || saving !== undefined) return;
    setSaving(format);
    codeFile(svg, format)
      .then((file) => saveFile(file, codeFileName(codes.placeName, showing.label, format)))
      .catch(() => toasts.toast({ tone: 'danger', message: strings.downloadFailed }))
      .finally(() => setSaving(undefined));
  };
  return (
    <Modal
      variant="drawer"
      title={strings.codeTitle(name)}
      isOpen={isOpen}
      isBusy={saving !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      footerStart={
        <ButtonLink href={address} isExternal icon="external-link">
          {strings.openMenu}
        </ButtonLink>
      }
      actions={
        <>
          <Button
            icon="download"
            isPending={saving === 'svg'}
            onPress={() => save('svg')}
            label={strings.downloadSvg(name)}
          >
            {strings.svg}
          </Button>
          <Button
            variant="primary"
            icon="download"
            isPending={saving === 'png'}
            onPress={() => save('png')}
            label={strings.downloadPng(name)}
          >
            {strings.png}
          </Button>
        </>
      }
    >
      <QrCode
        ref={codeRef}
        value={address}
        label={strings.codeLabel(name)}
        size="fill"
        {...(look.colour === undefined ? {} : { colour: look.colour })}
        {...(look.logoSrc === undefined ? {} : { picture: look.logoSrc })}
      />
      <DescriptionList
        items={[
          {
            term: strings.code,
            description: <Code>{showing.code}</Code>,
            copy: { value: showing.code, label: strings.copyCode },
          },
          { term: strings.link, description: address, copy: { value: address, label: strings.copyLink } },
        ]}
      />
    </Modal>
  );
}

/**
 * Every table's code as one zip: the codes are drawn out of sight, then each is saved at 512 pixels in order and the
 * zip handed to the browser's download. Unmounts itself through `onDone`.
 */
function ZipAll({
  codes,
  venue,
  look,
  onDone,
}: {
  readonly codes: PlaceQrCodes;
  readonly venue: string;
  readonly look: QrLook;
  readonly onDone: (failed: boolean) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    let cancelled = false;
    const drawn: DrawnCode[] = codes.tables.flatMap((table) => {
      const svg = holder.current?.querySelector<SVGSVGElement>(`svg[aria-label="${CSS.escape(table.code)}"]`);
      return svg === null || svg === undefined ? [] : [{ label: table.label, svg }];
    });
    zipCodes(codes.placeName, drawn, 'png')
      .then((zip) => {
        if (cancelled) return;
        saveFile(zip, codeFileName(venue, codes.placeName, 'zip'));
        done.current(false);
      })
      .catch(() => {
        if (!cancelled) done.current(true);
      });
    return () => {
      cancelled = true;
    };
  }, [codes, venue]);
  return (
    <VisuallyHidden>
      <div ref={holder} aria-hidden="true">
        {codes.tables.map((table) => (
          <QrCode
            key={table.id}
            value={tableMenuAddress(codes.menuKey, table.code)}
            label={table.code}
            {...(look.colour === undefined ? {} : { colour: look.colour })}
            {...(look.logoSrc === undefined ? {} : { picture: look.logoSrc })}
          />
        ))}
      </div>
    </VisuallyHidden>
  );
}

/**
 * The tables after checklabs' Tables page: the zone chips (All, each zone with its colour, Unzoned last, with
 * counts), the count with Print QR sheet and Clear, then one card per zone of its tables in reading order: Table,
 * Seats, Code, then QR, Edit and ⋯. Rows tick for printing; Print takes the ticked rows, else the zone shown.
 */
function TablesByZone({
  slug,
  placeId,
  codes,
  floor,
  zone,
  onZone,
  picked,
  onPicked,
  onOpen,
}: {
  readonly slug: string;
  readonly placeId: string;
  readonly codes: PlaceQrCodes;
  readonly floor: PlaceFloor | undefined;
  readonly zone: string;
  readonly onZone: (zone: string) => void;
  readonly picked: ReadonlySet<string>;
  readonly onPicked: (picked: ReadonlySet<string>) => void;
  readonly onOpen: (open: Open) => void;
}) {
  const isNarrow = useIsNarrow();
  const tables = codes.tables;
  const resources = useMemo(() => new Map(floor?.resources.map((each) => [each.id, each]) ?? []), [floor]);
  // By the floor's zone once it has come; until then by the zone name the codes carry.
  const zoneNames = useMemo(
    () =>
      new Map(
        floor === undefined
          ? tables.flatMap((table) => (table.areaName === undefined ? [] : [[table.areaName, table.areaName] as const]))
          : floor.areas.map((each) => [each.id, each.name] as const),
      ),
    [floor, tables],
  );
  const groups = zoneGroups(
    tables,
    (table) => (floor === undefined ? table.areaName : resources.get(table.id)?.areaId),
    (id) => zoneNames.get(id),
    strings.unzoned,
  );
  if (tables.length === 0) {
    return (
      <EmptyState
        icon="qr-code"
        title={strings.noTables}
        actions={
          floor === undefined ? undefined : (
            <Button variant="primary" icon="plus" onPress={() => onOpen({ kind: 'add' })}>
              {strings.addFirstTable}
            </Button>
          )
        }
      >
        {strings.noTablesText}
      </EmptyState>
    );
  }
  // A zone that has gone (its last table deleted) shows them all again.
  const chosen = groups.some((group) => group.id === zone) ? zone : ALL_ZONES;
  const shownGroups = chosen === ALL_ZONES ? groups : groups.filter((group) => group.id === chosen);
  const shownIds = shownGroups.flatMap((group) => group.tables.map((table) => table.id));
  // Only rows still here count as picked (a deleted one leaves the selection).
  const live = new Set(tables.map((table) => table.id));
  const pickedIds = tables.filter((table) => picked.has(table.id) && live.has(table.id)).map((table) => table.id);
  const printing = pickedIds.length > 0 ? pickedIds : chosen === ALL_ZONES ? undefined : shownIds;
  const named = groups.filter((group) => group.id !== UNZONED);
  const unzoned = groups.find((group) => group.id === UNZONED);
  return (
    <>
      <ChoiceChips
        label={strings.zones}
        isSingle
        choices={[
          { id: ALL_ZONES, label: strings.allZones(tables.length) },
          ...named.map((group) => ({
            id: group.id,
            label: strings.zoneCount(group.name, group.tables.length),
            ...(group.hue === undefined ? {} : { dot: group.hue }),
          })),
          ...(unzoned === undefined ? [] : [{ id: UNZONED, label: strings.unzonedCount(unzoned.tables.length) }]),
        ]}
        selected={[chosen]}
        // Choosing the chosen zone again shows them all (checklabs').
        onChange={(next) => onZone(next[0] ?? ALL_ZONES)}
      />
      <SectionBar
        description={strings.shownOf(shownIds.length, tables.length, pickedIds.length)}
        end={
          <>
            <ButtonLink href={qrPrintHref(slug, placeId, printing)} icon="printer">
              {strings.printSheet}
            </ButtonLink>
            {pickedIds.length === 0 ? null : (
              <Button
                variant="ghost"
                label={strings.clearLabel}
                onPress={() => {
                  onPicked(new Set());
                  focusLater(() => document.querySelector<HTMLElement>('h1'));
                }}
              >
                {strings.clear}
              </Button>
            )}
          </>
        }
      />
      {/* The zone cards sit straight under the TopBar's h1, so their titles are h2s. */}
      <CardTitleLevel value={2}>
        {shownGroups.map((group) => (
          <ZoneCard
            key={group.id}
            group={group}
            codes={codes}
            resources={resources}
            isNarrow={isNarrow}
            picked={picked}
            onPicked={onPicked}
            onOpen={onOpen}
          />
        ))}
      </CardTitleLevel>
    </>
  );
}

/** One zone's card: its tables, each Table, Seats, Code, then QR, Edit and ⋯ (View menu, Analytics, New code, Delete). */
function ZoneCard({
  group,
  codes,
  resources,
  isNarrow,
  picked,
  onPicked,
  onOpen,
}: {
  readonly group: ZoneGroup<TableQr>;
  readonly codes: PlaceQrCodes;
  readonly resources: ReadonlyMap<string, Resource>;
  readonly isNarrow: boolean;
  readonly picked: ReadonlySet<string>;
  readonly onPicked: (picked: ReadonlySet<string>) => void;
  readonly onOpen: (open: Open) => void;
}) {
  const ids = new Set(group.tables.map((table) => table.id));
  // Each card ticks its own rows; the page keeps every card's together.
  const mine = new Set([...picked].filter((id) => ids.has(id)));
  return (
    <Card title={group.name} description={strings.tablesCount(group.tables.length)}>
      <Table
        label={group.name}
        columns={isNarrow ? NARROW_COLUMNS : COLUMNS}
        rows={group.tables}
        getRowId={(table) => table.id}
        selected={mine}
        onSelectedChange={(next) => onPicked(new Set([...[...picked].filter((id) => !ids.has(id)), ...next]))}
        getSelectLabel={(table) => strings.selectTable(table.label)}
        onRowAction={(id) => onOpen({ kind: 'code', id })}
        renderCell={(table, column) => {
          const resource = resources.get(table.id);
          if (column === 'table') return table.label;
          if (column === 'seats')
            return resource === undefined ? '' : strings.seatsRange(resource.minCapacity, resource.maxCapacity);
          if (column === 'code') return <Code>{table.code}</Code>;
          return <RowActions table={table} resource={resource} codes={codes} isNarrow={isNarrow} onOpen={onOpen} />;
        }}
      />
    </Card>
  );
}

/** A row's QR and Edit, then ⋯ with the rest; at a phone's width all of them in ⋯. */
function RowActions({
  table,
  resource,
  codes,
  isNarrow,
  onOpen,
}: {
  readonly table: TableQr;
  readonly resource: Resource | undefined;
  readonly codes: PlaceQrCodes;
  readonly isNarrow: boolean;
  readonly onOpen: (open: Open) => void;
}) {
  const name = table.label;
  const address = tableMenuAddress(codes.menuKey, table.code);
  const act = (key: string) => {
    if (key === 'qr') onOpen({ kind: 'code', id: table.id });
    else if (key === 'view') globalThis.open(address, '_blank', 'noopener');
    else if (key === 'analytics') onOpen({ kind: 'analytics', id: table.id });
    else if (key === 'renew') onOpen({ kind: 'renew', table });
    else if (resource === undefined) return;
    else if (key === 'edit') onOpen({ kind: 'edit', table: resource });
    else if (key === 'delete') onOpen({ kind: 'delete', table: resource });
  };
  const more = (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={strings.moreFor(name)} />
      <Menu label={strings.moreFor(name)} onAction={(key) => act(String(key))}>
        {isNarrow ? (
          <MenuItem id="qr" icon="qr-code">
            {strings.qr}
          </MenuItem>
        ) : null}
        {isNarrow && resource !== undefined ? (
          <MenuItem id="edit" icon="pencil">
            {strings.edit}
          </MenuItem>
        ) : null}
        <MenuItem id="view" icon="external-link">
          {strings.viewMenu}
        </MenuItem>
        <MenuItem id="analytics" icon="chart-line">
          {strings.analytics}
        </MenuItem>
        <MenuSeparator />
        <MenuItem id="renew" icon="refresh-cw" isDanger>
          {strings.newCode}
        </MenuItem>
        {resource === undefined ? null : (
          <MenuItem id="delete" icon="trash" isDanger>
            {strings.delete}
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );
  if (isNarrow) return more;
  return (
    <ButtonGroup label={strings.actionsFor(name)} layout="row">
      <Button variant="ghost" icon="qr-code" label={strings.showCodeFor(name)} onPress={() => act('qr')}>
        {strings.qr}
      </Button>
      {resource === undefined ? null : (
        <Button variant="ghost" icon="pencil" label={strings.editFor(name)} onPress={() => act('edit')}>
          {strings.edit}
        </Button>
      )}
      {more}
    </ButtonGroup>
  );
}
