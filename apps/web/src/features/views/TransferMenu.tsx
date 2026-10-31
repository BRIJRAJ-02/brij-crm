// The view bar's Import / Export menu (spec 0040): Import <plural> for members
// who may write the object, and Export to Excel and Export to CSV (the shown
// columns, one press each, lane wip/crm-dataio) for everyone who can read it,
// with an All columns (M) submenu of the two when some are hidden. Both
// were only under "This view" in the switcher's menu, where few looked; they
// stay there too. A view whose table counts past 100,000 records offers the
// exports switched off, saying to narrow the filter.
import { useView } from '@crm/data/react';
import type { ObjectSummary, RecordsView, WindowCount } from '@crm/data';
import { Button, Menu, MenuItem, MenuSeparator, MenuTrigger, SubmenuTrigger } from '@crm/ui';
import { isOverExportLimit } from '../imports/export-run.ts';
import { importHref } from '../imports/paths.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { strings as importStrings } from '../imports/strings.ts';

/** Props for the view bar's Import / Export menu. */
export interface TransferMenuProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  /** How many columns the view shows, and how many it has with the hidden ones. */
  readonly shownColumns: number;
  readonly allColumns: number;
  /** The table's records, whose count switches the exports off past the limit; none on a board. */
  readonly records?: RecordsView;
  /** Export: the screen's export, with its one toast; `withHidden` writes the hidden columns too. */
  readonly onExport: (withHidden: boolean, format: 'csv' | 'xlsx') => void;
}

/**
 * A menu button at the view bar's end: Import <plural> (where the member may write), then the exports (for holders
 * of `records.export`). Nothing at all for someone who may do neither (a guest).
 */
export function TransferMenu(props: TransferMenuProps) {
  const canExport = useCan('records.export');
  const canImport = props.object.access === 'write' && !props.object.isArchived;
  if (!canExport && !canImport) return null;
  return props.records === undefined ? <Transfer {...props} /> : <CountedTransfer {...props} records={props.records} />;
}

/** The menu with the table's count, read through the view (it holds no columns of its own). */
function CountedTransfer(props: TransferMenuProps & { readonly records: RecordsView }) {
  const { count } = useView(props.records);
  return <Transfer {...props} count={count} />;
}

function Transfer({
  slug,
  object,
  shownColumns,
  allColumns,
  onExport,
  count,
}: TransferMenuProps & { readonly count?: WindowCount }) {
  const canImport = object.access === 'write' && !object.isArchived;
  const canExport = useCan('records.export');
  const isTooMany = isOverExportLimit(count);
  const tooMany = isTooMany ? { isDisabled: true, description: importStrings.exportTooMany } : {};
  return (
    <MenuTrigger>
      <Button icon="download" iconRight="chevron-down" label={importStrings.transferMenu} isLabelCollapsible>
        {importStrings.transferMenu}
      </Button>
      <Menu
        label={importStrings.transferMenu}
        onAction={(key) => {
          if (key === 'export-xlsx') onExport(false, 'xlsx');
          if (key === 'export-csv') onExport(false, 'csv');
        }}
      >
        {canImport && (
          <MenuItem id="import" icon="upload" href={importHref(slug, object)}>
            {importStrings.importPlural(object.pluralName)}
          </MenuItem>
        )}
        {canImport && canExport && <MenuSeparator />}
        {canExport && (
          <MenuItem
            id="export-xlsx"
            icon="file-spreadsheet"
            {...(isTooMany ? tooMany : { description: importStrings.columnsShown(shownColumns) })}
          >
            {importStrings.exportExcel}
          </MenuItem>
        )}
        {canExport && (
          <MenuItem id="export-csv" icon="download" {...tooMany}>
            {importStrings.exportCsv}
          </MenuItem>
        )}
        {canExport && allColumns > shownColumns && (
          // The rarer case, one level down: the hidden columns too, in either format.
          <SubmenuTrigger>
            <MenuItem id="export-all" icon="eye" {...(isTooMany ? tooMany : {})}>
              {importStrings.exportAll(allColumns)}
            </MenuItem>
            <Menu
              label={importStrings.exportAll(allColumns)}
              onAction={(key) => {
                if (key === 'all-xlsx') onExport(true, 'xlsx');
                if (key === 'all-csv') onExport(true, 'csv');
              }}
            >
              <MenuItem id="all-xlsx" icon="file-spreadsheet">
                {importStrings.excel}
              </MenuItem>
              <MenuItem id="all-csv" icon="download">
                {importStrings.csv}
              </MenuItem>
            </Menu>
          </SubmenuTrigger>
        )}
      </Menu>
    </MenuTrigger>
  );
}
