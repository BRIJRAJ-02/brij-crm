// Brief
// Purpose: the Tables page (spec 0065, H2, after checklabs' Tables page): every table of a place with its own code,
// grouped by area under area pills, each row's seats, code and scans, its QR in a dialog, Edit and Delete; Add tables;
// the whole place's codes as a print sheet or a zip.
// Main task: set up the tables and get a printed code onto every one.
// Leaves out: the floor plan editor and per table menus (not ours), areas' own editing (the place's page), and the
// fuller scan picture (spec 0067's Insights).
import type { BusinessView, HospitalityStore, Place, PlaceFloor, PlaceQrCodes, Resource, TableQr } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { tableDisplayName } from '@crm/contracts/menu';
import {
  Button,
  ButtonGroup,
  ButtonLink,
  Callout,
  Card,
  Code,
  ChoiceChips,
  CopyButton,
  EmptyState,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  PageColumn,
  QrCode,
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
import { AddTablesDialog, TableDialog } from '../hospitality/FloorScreen.tsx';
import { useIsNarrow } from '../menus/narrow.ts';
import { businessSettingsHref } from '../settings/nav.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { qrPrintHref, type QrLook } from './look.ts';
import { codeFile, codeFileName, tableMenuAddress, zipCodes, type DrawnCode } from './codes.ts';
import { strings } from './strings.ts';

/** An area card's columns, after checklabs' Label, Cap. and Code (its Menu and Venue are one per place here). */
const COLUMNS: readonly TableColumn[] = [
  { id: 'table', label: strings.table, isRowHeader: true, size: 'fill' },
  { id: 'seats', label: strings.seats, align: 'end', size: 'fit' },
  { id: 'code', label: strings.code, size: 'fit' },
  { id: 'scans', label: strings.scans, align: 'end', size: 'fit' },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

/** At a phone's width a row keeps its name, seats and actions; the code and scans are in its QR dialog. */
const NARROW_COLUMNS = COLUMNS.filter((column) => column.id !== 'code' && column.id !== 'scans');

/** Labels in reading order: T2 before T10 (checklabs' numeric aware sort). */
const byLabel = (a: { readonly label: string }, b: { readonly label: string }) =>
  a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });

/** The pill for tables in no area. */
const NO_AREA = 'none';

/** The page: the place switcher, then the place's codes. */
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

/** One place's codes: the bar's switcher, Print sheet and Download all, then the list. */
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
  const floorState = useHospitality(hospitality.floor(slug, place.id));
  const floor = floorState.status === 'ready' ? floorState.value : undefined;
  const [shown, setShown] = useState<string | undefined>();
  const [editing, setEditing] = useState<
    { readonly kind: 'add' } | { readonly kind: 'edit' | 'delete'; readonly table: Resource } | undefined
  >();
  const [area, setArea] = useState<string>('all');
  const isNarrow = useIsNarrow();
  const [renewing, setRenewing] = useState<TableQr | undefined>();
  const [zipping, setZipping] = useState<'png' | 'svg' | undefined>();
  const codes = state.status === 'ready' ? state.value : undefined;
  const tables = codes?.tables ?? [];
  const hasTables = tables.length > 0;
  const venue = business.profile?.name ?? place.name;

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
        <>
          {/* One click with the preset: every table, PNG at 512 pixels, one zip. SVG is in each code's dialog. */}
          <Button
            icon="download"
            label={strings.downloadAll}
            isPending={zipping !== undefined}
            onPress={() => setZipping('png')}
          />
          <ButtonLink
            href={qrPrintHref(slug, place.id)}
            icon="printer"
            {...(isNarrow ? { label: strings.print } : { children: strings.print })}
          />
        </>
      )}
      {floor === undefined ? null : (
        <Button
          variant="primary"
          icon="plus"
          {...(isNarrow ? { label: strings.addTable } : { children: strings.addTable })}
          onPress={() => setEditing({ kind: 'add' })}
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
  const open = tables.find((table) => table.id === shown);
  return (
    <WorkspacePage
      currentPage="qr"
      page={{
        topBar,
        body: (
          <PageColumn>
            <MenuState slug={slug} codes={value} />
            <TablesByArea
              tables={tables}
              floor={floor}
              area={area}
              onArea={setArea}
              onShow={setShown}
              onEdit={(table) => setEditing({ kind: 'edit', table })}
              onDelete={(table) => setEditing({ kind: 'delete', table })}
              onRenew={setRenewing}
              onAdd={() => setEditing({ kind: 'add' })}
            />
            {floor === undefined ? null : (
              <>
                <AddTablesDialog
                  startKind="table"
                  key={editing?.kind === 'add' ? 'add:open' : 'add:closed'}
                  isOpen={editing?.kind === 'add'}
                  onOpenChange={(isOpen) => {
                    if (!isOpen) setEditing(undefined);
                  }}
                  floor={floor}
                  onAdd={async (input) => {
                    const refused = await hospitality.addResources(slug, place.id, input);
                    if (refused !== undefined) throw refused;
                  }}
                />
                <TableDialog
                  table={editing?.kind === 'edit' ? editing.table : undefined}
                  floor={floor}
                  onClose={() => setEditing(undefined)}
                  onSave={async (table, change) => {
                    const refused = await hospitality.updateResource(slug, place.id, table.id, change);
                    if (refused !== undefined) throw refused;
                  }}
                />
              </>
            )}
            <Modal
              isOpen={editing?.kind === 'delete'}
              onOpenChange={(isOpen) => {
                if (!isOpen) setEditing(undefined);
              }}
              title={strings.deleteTitle(editing?.kind === 'delete' ? tableDisplayName(editing.table.label) : '')}
              variant="confirm"
              tone="danger"
              actions={
                <>
                  <Button slot="close">{strings.cancel}</Button>
                  <Button
                    variant="danger-solid"
                    onPress={() => {
                      if (editing?.kind !== 'delete') return;
                      const name = tableDisplayName(editing.table.label);
                      void hospitality.deleteResource(slug, place.id, editing.table.id).then((refused) => {
                        toasts.toast(
                          refused === undefined
                            ? { tone: 'success', message: strings.deleted(name) }
                            : { tone: 'danger', message: refused.message },
                        );
                      });
                      setEditing(undefined);
                    }}
                  >
                    {strings.delete}
                  </Button>
                </>
              }
            >
              {strings.deleteText}
            </Modal>
            {zipping === undefined ? null : (
              <ZipAll
                codes={value}
                venue={venue}
                look={look}
                format={zipping}
                onDone={(failed) => {
                  setZipping(undefined);
                  toasts.toast(
                    failed
                      ? { tone: 'danger', message: strings.downloadFailed }
                      : { tone: 'success', message: strings.zipped(tables.length) },
                  );
                }}
              />
            )}
            <TableCodeModal
              table={open}
              codes={value}
              look={look}
              isOpen={open !== undefined}
              onClose={() => setShown(undefined)}
              onRenew={(table) => {
                // One dialog at a time: the code's closes, then the question opens.
                setShown(undefined);
                setRenewing(table);
              }}
              toasts={toasts}
            />
            <Modal
              isOpen={renewing !== undefined}
              onOpenChange={(isOpen) => {
                if (!isOpen) setRenewing(undefined);
              }}
              title={strings.newCodeTitle(renewing === undefined ? '' : tableDisplayName(renewing.label))}
              variant="confirm"
              tone="danger"
              actions={
                <>
                  <Button slot="close">{strings.cancel}</Button>
                  <Button
                    variant="danger-solid"
                    onPress={() => {
                      if (renewing === undefined) return;
                      const name = tableDisplayName(renewing.label);
                      setRenewing(undefined);
                      void hospitality.regenerateTableCode(slug, place.id, renewing.id).then((refused) => {
                        toasts.toast(
                          refused === undefined
                            ? { tone: 'success', message: strings.newCodeDone(name) }
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

/** One table's code, large: its link to copy or open, PNG and SVG at 512 pixels, and New code. */
function TableCodeModal({
  table,
  codes,
  look,
  isOpen,
  onClose,
  onRenew,
  toasts,
}: {
  readonly table: TableQr | undefined;
  readonly codes: PlaceQrCodes;
  readonly look: QrLook;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onRenew: (table: TableQr) => void;
  readonly toasts: Toasts;
}) {
  const codeRef = useRef<SVGSVGElement>(null);
  const [saving, setSaving] = useState<'png' | 'svg' | undefined>();
  // Kept while the dialog closes, so its exit shows the code it had.
  const [last, setLast] = useState(table);
  if (table !== undefined && table !== last) setLast(table);
  const showing = table ?? last;
  if (showing === undefined) return null;
  const name = tableDisplayName(showing.label);
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
      title={strings.codeTitle(name)}
      isOpen={isOpen}
      isBusy={saving !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      footerStart={
        <Button variant="danger" icon="refresh-cw" onPress={() => onRenew(showing)}>
          {strings.newCode}
        </Button>
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
      <ButtonGroup label={strings.link}>
        <CopyButton value={address} label={strings.copyLink} />
        <ButtonLink href={address} isExternal icon="external-link">
          {strings.openMenu}
        </ButtonLink>
      </ButtonGroup>
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
  format,
  onDone,
}: {
  readonly codes: PlaceQrCodes;
  readonly venue: string;
  readonly look: QrLook;
  readonly format: 'png' | 'svg';
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
    zipCodes(codes.placeName, drawn, format)
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
  }, [codes, format, venue]);
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
 * The tables after checklabs' Tables page: the area pills (All, each area, No area, with counts) over one card per
 * area (A to Z, No area last), each a table of its tables in reading order: name, seats, code, scans, then QR and ⋯.
 */
function TablesByArea({
  tables,
  floor,
  area,
  onArea,
  onShow,
  onEdit,
  onDelete,
  onRenew,
  onAdd,
}: {
  readonly tables: readonly TableQr[];
  readonly floor: PlaceFloor | undefined;
  readonly area: string;
  readonly onArea: (area: string) => void;
  readonly onShow: (id: string) => void;
  readonly onEdit: (table: Resource) => void;
  readonly onDelete: (table: Resource) => void;
  readonly onRenew: (table: TableQr) => void;
  readonly onAdd: () => void;
}) {
  const isNarrow = useIsNarrow();
  const resources = useMemo(() => new Map(floor?.resources.map((each) => [each.id, each]) ?? []), [floor]);
  const areaOf = (table: TableQr) => resources.get(table.id)?.areaId ?? NO_AREA;
  const areaNames = new Map(floor?.areas.map((each) => [each.id, each.name]) ?? []);
  const groups = [...new Set(tables.map(areaOf))]
    .map((id) => ({
      id,
      name: id === NO_AREA ? strings.noArea : (areaNames.get(id) ?? strings.noArea),
      tables: tables.filter((table) => areaOf(table) === id).sort(byLabel),
    }))
    .sort((a, b) => (a.id === NO_AREA ? 1 : b.id === NO_AREA ? -1 : a.name.localeCompare(b.name)));
  if (tables.length === 0) {
    return (
      <EmptyState
        icon="qr-code"
        title={strings.noTables}
        actions={
          <Button variant="primary" icon="plus" onPress={onAdd}>
            {strings.addTables}
          </Button>
        }
      >
        {strings.noTablesText}
      </EmptyState>
    );
  }
  const shown = area === 'all' ? groups : groups.filter((group) => group.id === area);
  return (
    <>
      {groups.length < 2 ? null : (
        <ChoiceChips
          label={strings.areas}
          isLabelHidden
          isSingle
          choices={[
            { id: 'all', label: strings.allAreas(tables.length) },
            ...groups.map((group) => ({
              id: group.id,
              label:
                group.id === NO_AREA
                  ? strings.noAreaCount(group.tables.length)
                  : strings.areaCount(group.name, group.tables.length),
            })),
          ]}
          selected={[area]}
          // Choosing the chosen area again shows them all (checklabs').
          onChange={(next) => onArea(next[0] ?? 'all')}
        />
      )}
      {shown.map((group) => (
        <Card key={group.id} title={group.name} description={strings.tablesCount(group.tables.length)}>
          <Table
            label={group.name}
            columns={isNarrow ? NARROW_COLUMNS : COLUMNS}
            rows={group.tables}
            getRowId={(table) => table.id}
            onRowAction={onShow}
            renderCell={(table, column) => {
              const resource = resources.get(table.id);
              if (column === 'table') return tableDisplayName(table.label);
              if (column === 'seats')
                return resource === undefined ? '' : strings.seatsRange(resource.minCapacity, resource.maxCapacity);
              if (column === 'code') return <Code>{table.code.slice(0, 6).toUpperCase()}</Code>;
              if (column === 'scans') return String(table.scans);
              const name = tableDisplayName(table.label);
              return (
                <ButtonGroup label={strings.actionsFor(name)}>
                  <Button
                    variant="ghost"
                    icon="qr-code"
                    onPress={() => onShow(table.id)}
                    label={strings.showCodeFor(name)}
                  />
                  <MenuTrigger>
                    <Button variant="ghost" icon="ellipsis" label={strings.actionsFor(name)} />
                    <Menu
                      label={strings.actionsFor(name)}
                      onAction={(key) => {
                        if (key === 'renew') onRenew(table);
                        else if (resource === undefined) return;
                        else if (key === 'edit') onEdit(resource);
                        else if (key === 'delete') onDelete(resource);
                      }}
                    >
                      {resource === undefined ? null : (
                        <MenuItem id="edit" icon="pencil">
                          {strings.edit}
                        </MenuItem>
                      )}
                      <MenuItem id="renew" icon="refresh-cw">
                        {strings.newCode}
                      </MenuItem>
                      {resource === undefined ? null : (
                        <MenuItem id="delete" icon="trash" isDanger>
                          {strings.delete}
                        </MenuItem>
                      )}
                    </Menu>
                  </MenuTrigger>
                </ButtonGroup>
              );
            }}
          />
        </Card>
      ))}
    </>
  );
}
