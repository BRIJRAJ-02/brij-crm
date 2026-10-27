// Brief
// Purpose: the optional links on first run's Your link page (27 October 2026): a page with one booking page on it
// is a thin page, so its owner can put a link or two on it here rather than only after setup.
// Main task: a title and an address per row, "+ Add another" for the next, and nothing filled in is nothing added.
// Leaves out: notes, icons, hues, sections and ordering (the link page editor), and more than three rows: this is
// a head start, not the editor.
import { Button, Field, FieldGroup } from '@crm/ui';
import { strings } from './strings.ts';

/** A row as it is typed: both parts empty means the row adds nothing. */
export interface LinkDraft {
  readonly title: string;
  readonly url: string;
}

/** The most rows first run offers: a head start, not the editor. */
export const LINK_ROWS_MAX = 3;

/** An empty row. */
export const EMPTY_LINK: LinkDraft = { title: '', url: '' };

/** The rows worth sending: both parts given. A row with one part is left to the field's own refusal. */
export function filledLinks(rows: readonly LinkDraft[]): readonly LinkDraft[] {
  return rows.filter((row) => row.title.trim() !== '' && row.url.trim() !== '');
}

/** Props for the optional links. */
export interface LinksFieldsProps {
  readonly rows: readonly LinkDraft[];
  readonly onRows: (rows: readonly LinkDraft[]) => void;
  /** The claim is running: the rows wait with it. */
  readonly isBusy?: boolean;
}

/**
 * Add links, optional: a title and an address per row under one label, with
 * "+ Add another" while there is room. Every row is optional, so nothing here
 * can hold the step up.
 */
export function LinksFields({ rows, onRows, isBusy = false }: LinksFieldsProps) {
  const change = (index: number, part: Partial<LinkDraft>) => {
    onRows(rows.map((row, at) => (at === index ? { ...row, ...part } : row)));
  };
  return (
    <FieldGroup label={strings.linksLabel} hint={strings.linksHint}>
      {rows.map((row, index) => (
        // The rows are a short list the person only grows, so a row's place is its identity.
        <div key={index}>
          <Field
            label={strings.linkTitle}
            name={`link-title-${String(index)}`}
            autoComplete="off"
            maxLength={60}
            isDisabled={isBusy}
            value={row.title}
            onChange={(title) => {
              change(index, { title });
            }}
          />
          <Field
            label={strings.linkUrl}
            name={`link-url-${String(index)}`}
            autoComplete="off"
            inputMode="url"
            placeholder={strings.linkUrlPlaceholder}
            isDisabled={isBusy}
            value={row.url}
            onChange={(url) => {
              change(index, { url });
            }}
          />
        </div>
      ))}
      {rows.length < LINK_ROWS_MAX && (
        <Button
          variant="ghost"
          icon="plus"
          isDisabled={isBusy}
          onPress={() => {
            onRows([...rows, EMPTY_LINK]);
          }}
        >
          {strings.linkAdd}
        </Button>
      )}
    </FieldGroup>
  );
}
