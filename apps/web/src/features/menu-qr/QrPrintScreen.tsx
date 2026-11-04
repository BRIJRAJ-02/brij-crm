// Brief
// Purpose: Menu QR's print sheet (spec 0065, H2): every table of a place as an A4 tent card with the logo, the venue,
// "Scan for the menu", the table's name and its code, printed from the browser with print CSS (no PDF service).
// Main task: choose 2 or 4 cards a sheet, then Print.
// Leaves out: stickers and other layouts (later), editing tables or codes (the QR codes page), and the app's frame:
// it stands alone so only the sheets print.
import type { HospitalityStore, PlaceQrCodes } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { tableDisplayName } from '@crm/contracts/menu';
import { Button, ButtonLink, EmptyState, QrSheet, SegmentedControl, VisuallyHidden } from '@crm/ui';
import { useEffect, useState } from 'react';
import { placeTablesHref } from '../settings/nav.ts';
import { tableMenuAddress } from './codes.ts';
import { qrPageHref, type QrLook } from './look.ts';
import { MenuState } from './QrScreen.tsx';
import { strings } from './strings.ts';

/** The sheet for one place: its codes as tent cards, the per sheet choice and Print above, never printed. */
export function QrPrintScreen({
  slug,
  placeId,
  hospitality,
  venue,
  look,
}: {
  readonly slug: string;
  readonly placeId: string;
  readonly hospitality: HospitalityStore;
  readonly venue: string;
  readonly look: QrLook;
}) {
  const held = hospitality.qrCodes(slug, placeId);
  const state = useHospitality(held);
  useEffect(() => held.retain(), [held]);
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
  if (codes.tables.length === 0) {
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
        cards={codes.tables.map((table) => ({
          id: table.id,
          name: tableDisplayName(table.label),
          value: tableMenuAddress(codes.menuKey, table.code),
        }))}
        perPage={perPage}
        {...(look.colour === undefined ? {} : { colour: look.colour })}
        {...(look.logoSrc === undefined ? {} : { logoSrc: look.logoSrc })}
        notice={codes.menuState === 'live' ? undefined : <MenuState slug={slug} codes={codes} />}
        controls={back}
        actions={
          <>
            <SegmentedControl
              label={strings.perPage}
              segments={[
                { value: '2', label: strings.two },
                { value: '4', label: strings.four },
              ]}
              value={String(perPage)}
              onChange={(next) => setPerPage(next === '4' ? 4 : 2)}
            />
            <Button variant="primary" icon="printer" onPress={() => globalThis.print()}>
              {strings.printNow}
            </Button>
          </>
        }
      />
    </main>
  );
}
