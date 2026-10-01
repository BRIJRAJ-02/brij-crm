// The field set's types (spec 0003, attribute values): what every display and
// editor takes, and what each attribute type registers once.
import type {
  ActorDisplay,
  AttributeType,
  AttributeValueOf,
  DisplayFor,
  FilterOperator,
  SelectOption,
} from '@crm/contracts/values';
import type { ComponentType } from 'react';
import type { IconName } from '../atoms/Icon/icons.ts';
import type { ListSource } from '../lib/list-source.ts';

/** Where a value is drawn: a grid cell, the record panel, a board card, a form, a filter value, an import preview. */
export type Surface = 'cell' | 'panel' | 'card' | 'form' | 'filter' | 'preview';

/** Everything the field set needs to know about an attribute. */
export interface FieldAttribute {
  readonly id: string;
  readonly name: string;
  readonly type: AttributeType;
  readonly allowMultiple: boolean;
  /** A select's options or a status attribute's statuses, in order (a StatusOption has the same shape). */
  readonly options?: readonly SelectOption[];
  /** Currency: the code new amounts start in. */
  readonly defaultCurrency?: string;
  /** Phone: the country numbers without a code are read in. */
  readonly defaultCountry?: string;
  /** Record reference: whether it holds one record or several. */
  readonly cardinality?: 'one' | 'many';
  readonly isRequired: boolean;
  readonly isUnique: boolean;
  readonly isReadOnly: boolean;
  readonly readOnlyReason?: string;
  /** A formula, rollup or lookup: the system works it out, people never edit it. */
  readonly computed?: 'formula' | 'rollup' | 'lookup';
  /** An AI attribute: the assistant fills it; a hand edit replaces it. */
  readonly ai?: { readonly canRefresh: boolean };
}

/** One value of type `T`, or a list of them when the attribute allows several. */
export type FieldValue<T extends AttributeType> = AttributeValueOf<T> | readonly AttributeValueOf<T>[];

/** The display shapes for a value: one per value, in the same order for a list. */
export type FieldDisplay<T extends AttributeType> = DisplayFor<T> | readonly DisplayFor<T>[];

/** Props every display takes. */
export interface DisplayProps<T extends AttributeType> {
  readonly attribute: FieldAttribute;
  readonly value: FieldValue<T> | null;
  /** The data layer's display shapes (names and pictures for references, members and files). */
  readonly display?: FieldDisplay<T>;
  readonly surface: Surface;
  /** How many chips show before "+N". Cards use 3; cells measure. */
  readonly maxVisible?: number;
}

/** Props every editor takes. */
export interface EditorProps<T extends AttributeType> {
  readonly attribute: FieldAttribute;
  readonly value: FieldValue<T> | null;
  readonly display?: FieldDisplay<T>;
  readonly surface: Surface;
  /** Called with a value that parses with the type's schema, or `null` to clear. Never with anything else. */
  readonly onCommit: (value: FieldValue<T> | null) => void;
  /** Esc in a cell or a popover. */
  readonly onCancel?: () => void;
  /** A refusal the screen passes back (uniqueness, access), shown as the field's error. */
  readonly error?: string;
  /** References and members: searches outside and returns what to offer. */
  readonly onSearch?: (query: string) => ListSource<DisplayFor<T> & object>;
  /** Files: uploads them through #32. */
  readonly onUpload?: (files: readonly File[]) => void;
  /** The signed in member, offered first as "Me" by the member picker. */
  readonly me?: ActorDisplay;
  /** The grid opened the editor by typing this: typed editors start from it, replacing the value, and searches start with it. */
  readonly startText?: string;
  /** The grid started the edit: a list, menu or search opens at once, so one key reaches the choices. */
  readonly autoOpen?: boolean;
}

/** A pasted or imported text the type can't take, and why ("No option called 'Hot'"). */
export interface TextRefusal {
  readonly code: 'TEXT_REFUSED';
  readonly reason: string;
}

/** Phone parsing, from libphonenumber-js, loaded by whoever pastes or imports (it is large, so it loads on demand). */
export interface PhoneParser {
  readonly parse: (
    text: string,
    defaultCountry?: string,
  ) => { readonly number: string; readonly country: string } | undefined;
}

/** What text conversion needs: the language and time zone, the attribute, and members to match names against. */
export interface TextContext {
  readonly locale: string;
  readonly timeZone: string;
  readonly attribute: FieldAttribute;
  readonly members?: readonly ActorDisplay[];
  readonly defaultCountry?: string;
  readonly phone?: PhoneParser;
  /** The value's display shapes (record and member names), so references copy as names. */
  readonly display?: unknown;
}

/** How a filter operator takes its operand. */
export type OperandKind = 'value' | 'text' | 'range' | 'list' | 'relative' | 'none' | 'through';

/** One filter operator an attribute type offers, and how it reads. */
export interface OperatorDef {
  readonly operator: FilterOperator;
  readonly operand: OperandKind;
}

/** What one attribute type registers, once: its display, its editor, its operators and its text conversion. */
export interface AttributeTypeDef<T extends AttributeType> {
  readonly type: T;
  /** The icon in column headers and pickers. */
  readonly icon: IconName;
  readonly Display: ComponentType<DisplayProps<T>>;
  readonly Editor: ComponentType<EditorProps<T>>;
  /** The filter operators it offers; a select's depend on whether it allows several. Every type adds is empty and is not empty. */
  readonly operators: (attribute: FieldAttribute) => readonly OperatorDef[];
  /** A value as text, for copy, CSV and the import preview. */
  readonly toText: (value: FieldValue<T>, context: TextContext) => string;
  /** Text back into a value, for paste and the import preview, or why it can't be. */
  readonly fromText: (text: string, context: TextContext) => FieldValue<T> | TextRefusal;
  /** How a cell aligns the value: numbers end aligned. */
  readonly align: 'start' | 'end';
  /** How the grid edits it: in the cell, in a popover, or not at all. */
  readonly editIn: 'cell' | 'popover' | 'none';
  /** A popover editor done after one choice (a date, a single select), so the grid closes it on commit. */
  readonly closesOnCommit?: boolean;
  /** Its editor is a list that opens itself (a select, a status), so the grid draws it in the cell, already open, not in a popover. */
  readonly isListEditor?: boolean;
  /** A click or Space toggles the value where it is (a checkbox); it never opens an editor. */
  readonly togglesInPlace?: boolean;
  /** What clearing the value leaves: `false` for a checkbox, which is never empty. Unset means empty. */
  readonly cleared?: FieldValue<T>;
  /** A new grid column's width tier. An attribute that holds several values is always `wide` (`columnWidthOf`). */
  readonly width: ColumnWidth;
}

/** A grid column's width tier: `size-column-narrow`, `size-column` or `size-column-wide`. */
export type ColumnWidth = 'narrow' | 'default' | 'wide';

/** A change one grid cell asks for. */
export interface CellChange {
  readonly rowId: string;
  readonly columnId: string;
  readonly value: unknown;
}
