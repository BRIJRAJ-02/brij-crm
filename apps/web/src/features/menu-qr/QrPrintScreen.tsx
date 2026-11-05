// Brief
// Purpose: Menu QR's print sheet (spec 0065, H2, after checklabs' print sheet): the picked tables, else the zone shown,
// else every table of a place, as A4 sheets of tiles (six a sheet, the default) or tent cards (two or four), each
// with the table's label and code, printed from the browser with print CSS (no PDF service).
// Main task: choose tiles or tents, then Print.
// Leaves out: editing tables or codes (the Tables page), and the app's frame: it stands alone so only the sheets print.
import type { HospitalityStore, PlaceQrCodes } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { Button, ButtonLink, EmptyState, QrSheet, SegmentedControl, VisuallyHidden, type QrSheetLayout } from '@crm/ui';
import { useEffect, useState } from 'react';
import { placeTablesHref } from '../settings/nav.ts';
import { tableMenuAddress } from './codes.ts';
import { printedTables, qrPageHref, type QrLook } from './look.ts';
import { MenuState } from './QrScreen.tsx';
import { strings } from './strings.ts';
import { byLabel } from './zones.ts';

/** The sheet for one place: its codes as tiles or tents, the layout and Print above, never printed. */
export function QrPrintScreen({
  slug,
  placeId,
  tables,
  hospitality,
  venue,
  look,
}: {
  readonly slug: string;
  readonly placeId: string;
  /** The tables to print (the address's `tables`), or undefined for every one. */
  readonly tables?: string;
  readonly hospitality: HospitalityStore;
  readonly venue: string;
  readonly look: QrLook;
}) {
  const held = hospitality.qrCodes(slug, placeId);
  const state = useHospitality(held);
  useEffect(() => held.retain(), [held]);
  const [layout, setLayout] = useState<QrSheetLayout>('tiles');
  const [perPage, setPerPage] = useState<2 | 4>(2);
  const back = (
    <ButtonLink href={qrPageHref(slug)} variant="ghost" icon="arrow-left">
      {strings.back}
    </ButtonLink>
  );
  if (state.status === 'loading') {
    return (
      <main>
        <EmptyState title={strings.printTitle} isLoading />
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main>
        <EmptyState tone="error" title={strings.failed} onRetry={held.retry} actions={back}>
          {state.error.message}
        </EmptyState>
      </main>
    );
  }
  const codes: PlaceQrCodes = state.value;
  const only = printedTables(tables);
  // The tables asked for, in reading order (the cards' order on the page); a table deleted since is left out.
  const printed = codes.tables.filter((table) => only === undefined || only.has(table.id)).sort(byLabel);
  if (printed.length === 0) {
    return (
      <main>
        <EmptyState
          icon="qr-code"
          title={strings.noTables}
          actions={
            <>
              {back}
              <ButtonLink href={placeTablesHref(slug, placeId)} variant="primary" icon="plus">
                {strings.addTables}
              </ButtonLink>
            </>
          }
        >
          {strings.noTablesText}
        </EmptyState>
      </main>
    );
  }
  return (
    <main>
      <VisuallyHidden>
        <h1>{strings.printTitle}</h1>
      </VisuallyHidden>
      <QrSheet
        venue={venue}
        cards={printed.map((table) => ({
          id: table.id,
          name: table.label,
          code: table.code,
          value: tableMenuAddress(codes.menuKey, table.code),
        }))}
        layout={layout}
        perPage={perPage}
        {...(look.colour === undefined ? {} : { colour: look.colour })}
        {...(look.logoSrc === undefined ? {} : { logoSrc: look.logoSrc })}
        notice={codes.menuState === 'live' ? undefined : <MenuState slug={slug} codes={codes} />}
        controls={
          <>
            {back}
            {strings.scanReady(printed.length)}
          </>
        }
        actions={
          <>
            <SegmentedControl
              label={strings.layout}
              segments={[
                { value: 'tiles', label: strings.tiles },
                { value: 'tents', label: strings.tents },
              ]}
              value={layout}
              onChange={(next) => setLayout(next === 'tents' ? 'tents' : 'tiles')}
            />
            {layout === 'tents' ? (
              <SegmentedControl
                label={strings.perPage}
                segments={[
                  { value: '2', label: strings.two },
                  { value: '4', label: strings.four },
                ]}
                value={String(perPage)}
                onChange={(next) => setPerPage(next === '4' ? 4 : 2)}
              />
            ) : null}
            <Button variant="primary" icon="printer" onPress={() => globalThis.print()}>
              {strings.printNow}
            </Button>
          </>
        }
      />
    </main>
  );
}
