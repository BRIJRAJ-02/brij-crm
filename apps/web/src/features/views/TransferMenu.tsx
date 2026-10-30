// The view bar's Import / Export menu (spec 0040): Import <plural> for members
// who may write the object, and Export view (N columns) for everyone who can
// read it, with Export all columns (M) beside it when some are hidden. Both
// were only under "This view" in the switcher's menu, where few looked; they
// stay there too. A view whose table counts past 100,000 records offers the
// exports switched off, saying to narrow the filter.
import { useView } from '@crm/data/react';
import type { ObjectSummary, RecordsView, WindowCount } from '@crm/data';
import { Button, Menu, MenuItem, MenuTrigger } from '@crm/ui';
import { isOverExportLimit } from '../imports/export-run.ts';
import { importHref } from '../imports/paths.ts';
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
  readonly onExport: (withHidden: boolean) => void;
}

/** A menu button at the view bar's end: Import <plural> (where the member may write), then the exports. */
export function TransferMenu(props: TransferMenuProps) {
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
          if (key === 'export') onExport(false);
          if (key === 'export-all') onExport(true);
        }}
      >
        {canImport && (
          <MenuItem id="import" icon="upload" href={importHref(slug, object)}>
            {importStrings.importPlural(object.pluralName)}
          </MenuItem>
        )}
        <MenuItem id="export" icon="download" {...tooMany}>
          {importStrings.exportShown(shownColumns)}
        </MenuItem>
        {allColumns > shownColumns && (
          <MenuItem
            id="export-all"
            icon="eye"
            {...(isTooMany ? tooMany : { description: importStrings.exportAllText })}
          >
            {importStrings.exportAll(allColumns)}
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );
}
