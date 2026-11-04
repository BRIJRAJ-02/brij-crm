// Brief
// Purpose: Menu QR's page (spec 0065, H2): every table of a place with its own code, laid out after checklabs'
// tables QR flow: a list of tables, a code per row in a dialog, and the whole place's codes as a zip or a print sheet.
// Main task: get a printed code onto every table: Print sheet (tent cards), or download the codes for a print shop.
// Leaves out: adding or editing tables (the place's page, linked from the empty state), a general code for the window
// and named spots (later), and the fuller scan picture (spec 0067's Insights).
import type { BusinessView, HospitalityStore, Place, PlaceQrCodes, TableQr } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { tableDisplayName } from '@crm/contracts/menu';
import {
  Button,
  ButtonGroup,
  ButtonLink,
  Callout,
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
import { useEffect, useRef, useState } from 'react';
import { saveFile } from '../link-page/qr-png.ts';
import { businessSettingsHref, placeTablesHref } from '../settings/nav.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { qrPrintHref, type QrLook } from './look.ts';
import { codeFile, codeFileName, tableMenuAddress, zipCodes, type DrawnCode } from './codes.ts';
import { strings } from './strings.ts';

/** The list's columns: Area only while some table has one. */
const columnsFor = (hasAreas: boolean): readonly TableColumn[] => [
  { id: 'table', label: strings.table, isRowHeader: true, size: 'fill' },
  ...(hasAreas ? [{ id: 'area', label: strings.area }] : []),
  { id: 'scans', label: strings.scans, align: 'end', size: 'fit' },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

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
  const [shown, setShown] = useState<string | undefined>();
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
            variant={codes?.menuState === 'live' ? 'primary' : 'secondary'}
            icon="printer"
          >
            {strings.print}
          </ButtonLink>
        </>
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
            <Table
              label={strings.title}
              columns={columnsFor(tables.some((table) => table.areaName !== undefined))}
              rows={tables}
              getRowId={(table) => table.id}
              onRowAction={(id) => setShown(id)}
              renderCell={(table, column) => {
                if (column === 'table') return tableDisplayName(table.label);
                if (column === 'area') return table.areaName ?? '';
                if (column === 'scans') return String(table.scans);
                const name = tableDisplayName(table.label);
                return (
                  <ButtonGroup label={strings.actionsFor(name)}>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="qr-code"
                      onPress={() => setShown(table.id)}
                      label={strings.showCodeFor(name)}
                    />
                    <MenuTrigger>
                      <Button variant="ghost" size="sm" icon="ellipsis" label={strings.actionsFor(name)} />
                      <Menu
                        label={strings.actionsFor(name)}
                        onAction={(key) => {
                          if (key === 'renew') setRenewing(table);
                        }}
                      >
                        <MenuItem id="renew" icon="refresh-cw" isDanger>
                          {strings.newCode}
                        </MenuItem>
                      </Menu>
                    </MenuTrigger>
                  </ButtonGroup>
                );
              }}
              emptyState={
                <EmptyState
                  icon="qr-code"
                  title={strings.noTables}
                  actions={
                    <ButtonLink href={placeTablesHref(slug, place.id)} variant="primary" icon="plus">
                      {strings.addTables}
                    </ButtonLink>
                  }
                >
                  {strings.noTablesText}
                </EmptyState>
              }
            />
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
