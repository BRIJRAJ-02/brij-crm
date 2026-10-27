// Brief
// Purpose: the optional links on first run's Your link page (27 October 2026): a page with one booking page on it
// is a thin page, so its owner can put a link or two on it here rather than only after setup.
// Main task: an address per row, "+ Add another" for the next; an empty row adds nothing.
// Leaves out: titles (each link is named from its address, renamed in the editor), notes, icons, sections and
// ordering, and more than three rows: this is a head start, not the editor.
import { Button, Field, FieldGroup } from '@crm/ui';
import { strings } from './strings.ts';

/** The most rows first run offers: a head start, not the editor. */
export const LINK_ROWS_MAX = 3;

/** The addresses worth sending: the rows with something typed. */
export function filledLinks(rows: readonly string[]): readonly string[] {
  return rows.map((row) => row.trim()).filter((row) => row !== '');
}

/**
 * A link's title from its address, as the page will show it until it is renamed: the host without `www.`
 * ("https://www.studiostealth.com/" gives "studiostealth.com"), else what was typed, held to the 60 a title takes.
 */
export function titleFromUrl(url: string): string {
  const typed = url.trim();
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`).hostname;
    return host.replace(/^www\./, '').slice(0, 60);
  } catch {
    return typed.slice(0, 60);
  }
}

/** Props for the optional links. */
export interface LinksFieldsProps {
  readonly rows: readonly string[];
  readonly onRows: (rows: readonly string[]) => void;
  /** The claim is running: the rows wait with it. */
  readonly isBusy?: boolean;
}

/**
 * Links, optional: one address per row under one label, each row named for
 * screen readers ("Link 2"), with "+ Add another" while there is room.
 */
export function LinksFields({ rows, onRows, isBusy = false }: LinksFieldsProps) {
  return (
    <FieldGroup label={strings.linksLabel}>
      {rows.map((row, index) => (
        <Field
          // The rows are a short list the person only grows, so a row's place is its identity.
          key={index}
          label={strings.linkLabel(index + 1)}
          isLabelHidden
          name={`link-${String(index)}`}
          autoComplete="off"
          inputMode="url"
          placeholder={strings.linkPlaceholder}
          isDisabled={isBusy}
          value={row}
          onChange={(url) => {
            onRows(rows.map((each, at) => (at === index ? url : each)));
          }}
        />
      ))}
      {rows.length < LINK_ROWS_MAX && (
        // The library's add-a-row control, as Invite your team's "Add another" is, so the two steps match.
        <Button
          variant="ghost"
          icon="plus"
          isDisabled={isBusy}
          onPress={() => {
            onRows([...rows, '']);
          }}
        >
          {strings.linkAdd}
        </Button>
      )}
    </FieldGroup>
  );
}
