// The view bar's Import / Export menu (spec 0040): Import <plural> for members
// who may write the object, and Export this view (CSV) for everyone who can
// read it. Both were only under "This view" in the switcher's menu, where few
// looked; they stay there too.
import type { ObjectSummary } from '@crm/data';
import { Button, Menu, MenuItem, MenuTrigger } from '@crm/ui';
import { importHref } from '../imports/paths.ts';
import { strings as importStrings } from '../imports/strings.ts';

/** Props for the view bar's Import / Export menu. */
export interface TransferMenuProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  /** Export this view (CSV): the screen's export, with its one toast. */
  readonly onExport: () => void;
}

/** A menu button at the view bar's end: Import <plural> (where the member may write), then Export this view. */
export function TransferMenu({ slug, object, onExport }: TransferMenuProps) {
  const canImport = object.access === 'write' && !object.isArchived;
  return (
    <MenuTrigger>
      <Button icon="download" iconRight="chevron-down" label={importStrings.transferMenu} isLabelCollapsible>
        {importStrings.transferMenu}
      </Button>
      <Menu
        label={importStrings.transferMenu}
        onAction={(key) => {
          if (key === 'export') onExport();
        }}
      >
        {canImport && (
          <MenuItem id="import" icon="upload" href={importHref(slug, object)}>
            {importStrings.importPlural(object.pluralName)}
          </MenuItem>
        )}
        <MenuItem id="export" icon="download">
          {importStrings.exportView}
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
