// Brief
// Purpose: bring a spreadsheet of records into one object, or one of its lists (spec 0048, AC-4833), seeing what each
// row will do before anything changes.
// Main task: choose a CSV, check where its columns go, settle any value that won't read, read the preview, start.
// Leaves out: making far records of more than one object for a relation column, and file types other than CSV.
import {
  isDataError,
  toActorDisplays,
  toFieldAttribute,
  type AttributeDefinition,
  type ListView,
  type DataLayer,
  type ImportOnMatch,
  type ImportOnNoMatch,
  type ImportTarget,
  type MemberSummary,
  type ObjectSummary,
} from '@crm/data';
import { CSV_BOM, csvLine, readCsvFile, TRANSFER_LIMITS, type CsvResult, type CsvTable } from '@crm/data/imports';
import {
  AttributeDisplay,
  Button,
  Callout,
  Card,
  Checkbox,
  createPhoneParser,
  Disclosure,
  EmptyState,
  type FieldAttribute,
  FileDrop,
  Icon,
  loadPhoneLibrary,
  Modal,
  PageColumn,
  Pagination,
  type PhoneParser,
  ProgressBar,
  Radio,
  RadioGroup,
  SampleTable,
  SectionBar,
  SegmentedControl,
  Select,
  type SelectItem,
  sharedStrings,
  Steps,
  Table,
  type TableColumn,
  type TextContext,
  Tooltip,
  TopBar,
  useFormatSettings,
} from '@crm/ui';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { AttributeDialog } from '../settings/AttributeDialog.tsx';
import { objectHref } from '../workspace/objects.ts';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { saveCsv } from './download.ts';
import {
  autoMatch,
  choiceId,
  defaultMatch,
  importChoices,
  isFree,
  matchAttributes,
  type ImportChoice,
} from './matching.ts';
import { defaultDateOrder, longDay, numericDates, orderLocale, type DateOrder } from './date-order.ts';
import { columnNames, missingOptions, suggestAttribute } from './missing.ts';
import { importSummaryHref } from './paths.ts';
import { listHref } from '../lists/paths.ts';
import { RecentImports } from './RecentImports.tsx';
import {
  applyLabels,
  cellGroups,
  labelKey,
  rowPlan,
  type CellGroup,
  type LabelChoice,
  type RowMatch,
} from './review.ts';
import { ReviewStep, type LabelNote } from './ReviewStep.tsx';
import {
  cellText,
  errorRowsCsv,
  problemText,
  readCell,
  readRowsInSlices,
  type ErrorRow,
  type ReadChoices,
  type ReadRows,
} from './rows.ts';
import { unmatchedRequired } from './required.ts';
import { n, strings } from './strings.ts';

/** Props for the import page: what its route loaded through the data layer. */
export interface ImportScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  /** The workspace's objects, for a relation column's far object (its name, and whether the member may make its records). */
  readonly objects: readonly ObjectSummary[];
  /** Whether the object holds records already (undefined when the count didn't load): no match key then warns. */
  readonly hasRecords?: boolean | undefined;
  /**
   * Into a list (spec 0048, AC-4833): its writable fields take columns beside the object's, named "<List>: <Field>"
   * and listed first; each row then adds its record to the list, or updates its entry in an "Each record once" list.
   */
  readonly list?: { readonly list: ListView; readonly fields: readonly AttributeDefinition[] } | undefined;
}

/** What looking up a relation column's names found (decision 7), by column. */
type LinkCheck =
  | { readonly status: 'checking'; readonly attributeId: string }
  | { readonly status: 'failed'; readonly attributeId: string }
  | {
      readonly status: 'done';
      readonly attributeId: string;
      readonly total: number;
      readonly missing: readonly string[];
      readonly ambiguous: readonly string[];
    };

type Step = 'upload' | 'columns' | 'review' | 'preview';
type Filter = 'all' | 'ready' | 'errors';

/** What the match column's lookup found for the ready rows, for the preview's new, update and skip. */
type MatchCheck =
  | { readonly status: 'checking' }
  | { readonly status: 'failed' }
  | { readonly status: 'done'; readonly answers: readonly RowMatch[] };

/** The Select id for "Don't import", and the match Select's "Don't match, always add". */
const NONE = 'none';
/** The options a select or status attribute holds at most (the engine's limit, spec 0012). */
const OPTION_LIMIT = 500;
/** The Select item that makes a new attribute from the column (AC-1116). */
const NEW = 'new-attribute';
const SAMPLES_SHOWN = 3;
const SAMPLE_READ = 50;
const PAGE_SIZES = [25, 50, 100] as const;
/** The file types the upload takes, by extension (FileDrop matches on it, and says them plainly). */
const FILE_TYPES = ['.csv', '.tsv', '.txt'] as const;
/** The picker's key for each type a column suggests, where the two differ. */
const PICKER_KEYS: Readonly<Record<string, string>> = { url: 'link' };

/** A file read and ready to match, with each column's first values (read once). */
interface Loaded {
  readonly name: string;
  readonly table: CsvTable;
  readonly samples: readonly (readonly string[])[];
}

/** A notice on the preview: why the start failed, or that it was stopped. */
interface Notice {
  readonly tone: 'danger' | 'info';
  readonly message: string;
}

/** What a refusal from the reader says, in the page's words. */
function refusalText(result: Exclude<CsvResult, { ok: true }>): string {
  switch (result.reason) {
    case 'type':
      return strings.refusals.type;
    case 'bytes':
      return strings.refusals.bytes(result.bytes, result.limit);
    case 'rows':
      return strings.refusals.rows(result.limit);
    case 'columns':
      return strings.refusals.columns(result.columns, result.limit);
    case 'empty':
      return strings.refusals.empty;
    case 'quote':
      return strings.refusals.quote(result.row);
  }
}

/** An Excel file's refusal: how to save it as CSV; any other type keeps FileDrop's own sentence. */
const excelRefusal = (fileName: string): string | undefined =>
  /\.(xlsx|xlsm|xls)$/iu.test(fileName) ? strings.refusals.excel : undefined;

/** A column's first few values that aren't empty. */
function samplesOf(table: CsvTable, column: number, size: number): readonly string[] {
  const found: string[] = [];
  for (const row of table.rows) {
    const text = cellText(row[column]);
    if (text !== '') found.push(text);
    if (found.length >= size) break;
  }
  return found;
}

/** A date column whose values read either way round: the order chosen (or guessed), and one value read by it. */
interface DateColumn {
  readonly column: number;
  readonly order: DateOrder;
  readonly sample: string;
  readonly reads: string | undefined;
}

/** One row of the preview: a ready row, or one with errors. */
interface PreviewRow {
  readonly rowNumber: number;
  readonly cells: readonly string[];
  readonly error?: ErrorRow;
}

/** The field set's attribute for each definition, by id. */
const fieldsOf = (attributes: readonly AttributeDefinition[]): ReadonlyMap<string, FieldAttribute> =>
  new Map(attributes.map((attribute) => [attribute.id, toFieldAttribute(attribute) as FieldAttribute]));

/**
 * The import page (AC-1111 to AC-1123): Upload, Match columns, Review values
 * (only when a value won't read as it is), then Preview, where the match key
 * and the counts of what each row will do sit beside Start.
 */
export function ImportScreen({
  data,
  slug,
  object,
  attributes: given,
  members,
  objects,
  hasRecords,
  list: into,
}: ImportScreenProps) {
  const navigate = useNavigate();
  const canManage = useCan('schema.manage');
  // A list's fields first, each named for its list, so a column says where it goes (AC-4833).
  const listFields = useMemo(
    () =>
      (into?.fields ?? [])
        .filter((field) => !field.isSystem && !field.isArchived && field.readOnly === undefined)
        .map((field) => ({
          ...field,
          title: strings.listField(into?.list.name ?? '', field.title),
          position: field.position - 100_000,
        })),
    [into],
  );
  // Read again after the page makes an attribute or options, so the columns and the preview use them.
  const [objectAttributes, setAttributes] = useState(given);
  const attributes = useMemo(() => [...listFields, ...objectAttributes], [listFields, objectAttributes]);
  const [links, setLinks] = useState<ReadonlyMap<number, LinkCheck>>(new Map());
  const [columnsError, setColumnsError] = useState<string | undefined>(undefined);
  const linkRuns = useRef(new Map<number, number>());
  const [step, setStepNow] = useState<Step>('upload');
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [isReading, setReading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const [phone, setPhone] = useState<PhoneParser | undefined>(undefined);
  const [targets, setTargets] = useState<readonly (ImportTarget | undefined)[]>([]);
  // Unchosen (undefined): the object's usual key, else the first unique attribute a column fills; NONE: always add.
  const [matchId, setMatchId] = useState<string | undefined>(undefined);
  const [onMatch, setOnMatch] = useState<ImportOnMatch>('fill');
  const [onNoMatch, setOnNoMatch] = useState<ImportOnNoMatch>('create');
  const [result, setResult] = useState<ReadRows | undefined>(undefined);
  const [checked, setChecked] = useState<number | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [sending, setSending] = useState<{ readonly sent: number; readonly total: number } | undefined>(undefined);
  const [isStopping, setStopping] = useState(false);
  const [isStopAsked, setStopAsked] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  // Review values: whether the file needs it (decided by the first read), the label choices changed from their
  // defaults, the columns whose unreadable cells are kept as errors (the default leaves them empty), its groups.
  const [needsReview, setNeedsReview] = useState(false);
  const [labelChoices, setLabelChoices] = useState<ReadonlyMap<number, ReadonlyMap<string, LabelChoice>>>(new Map());
  const [keptColumns, setKeptColumns] = useState<ReadonlySet<number>>(new Set());
  const [groups, setGroups] = useState<readonly CellGroup[]>([]);
  const [reviewError, setReviewError] = useState<string | undefined>(undefined);
  const [isCreatingOptions, setCreatingOptions] = useState(false);
  const [matches, setMatches] = useState<MatchCheck | undefined>(undefined);
  // New attribute from a column: the attribute dialog, prefilled from the column.
  const [newFor, setNewFor] = useState<number | undefined>(undefined);
  const [now] = useState(() => Date.now());
  const stopped = useRef(false);
  const leaving = useRef(false);
  const checking = useRef(0);
  const matchRun = useRef(0);
  // Read through a call: the member may stop the sending while it awaits.
  const isStopped = () => stopped.current;

  const choices = useMemo(() => importChoices(attributes), [attributes]);
  const fields = useMemo(() => fieldsOf(attributes), [attributes]);
  const actors = useMemo(() => toActorDisplays(members), [members]);
  const byId = useMemo(() => new Map(attributes.map((attribute) => [attribute.id, attribute])), [attributes]);
  const locale = globalThis.navigator.languages[0] ?? 'en-US';
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // The workspace's own currency and country (Settings › Workspace › General): where a "$" and a number with no
  // country code start, when the attribute names none.
  const { currency: workspaceCurrency, country: workspaceCountry } = useFormatSettings();
  // A date column's day and month order (chosen in Match columns), by column; unchosen, guessed from the file.
  const [dateOrders, setDateOrders] = useState<ReadonlyMap<number, DateOrder>>(new Map());
  /** Each column's values that read either way round (3/4/2025), read once per file. */
  const numericByColumn = useMemo(
    () =>
      loaded === undefined
        ? []
        : loaded.table.headers.map((_, column) => numericDates(loaded.table.rows.map((row) => cellText(row[column])))),
    [loaded],
  );
  const dateColumns: readonly DateColumn[] = targets.flatMap((target, column) => {
    const attribute = target === undefined ? undefined : byId.get(target.attributeId);
    const texts = numericByColumn[column] ?? [];
    const [sample] = texts;
    if (attribute?.type !== 'date' || sample === undefined) return [];
    const order = dateOrders.get(column) ?? defaultDateOrder(texts, locale);
    const field = fields.get(attribute.id);
    const read =
      field === undefined
        ? undefined
        : readCell(sample, field, (each) => ({
            locale: orderLocale(order),
            timeZone,
            attribute: each,
            members: actors,
          }));
    return [{ column, order, sample, reads: read?.ok === true ? longDay(read.value, locale) : undefined }];
  });
  // The date attributes' reading language, so the field set reads each column's dates the way round it says.
  const dateLocales = new Map(
    dateColumns.flatMap((each) => {
      const target = targets[each.column];
      return target === undefined ? [] : [[target.attributeId, orderLocale(each.order)] as const];
    }),
  );
  const contextFor =
    (parser: PhoneParser | undefined, readsDates: ReadonlyMap<string, string> = new Map()) =>
    (attribute: FieldAttribute): TextContext => ({
      locale: readsDates.get(attribute.id) ?? locale,
      timeZone,
      attribute,
      members: actors,
      ...(parser === undefined ? {} : { phone: parser }),
      ...(workspaceCurrency === undefined ? {} : { defaultCurrency: workspaceCurrency }),
      ...(workspaceCountry === undefined ? {} : { defaultCountry: workspaceCountry }),
    });
  const context = contextFor(phone, dateLocales);
  const required = unmatchedRequired(attributes, targets);

  // A select or status column's labels that name no option (a scan of every row), each with whether Create is offered.
  const labelNotes = useMemo(
    () =>
      loaded === undefined
        ? []
        : targets.flatMap((target, column): readonly LabelNote[] => {
            const attribute =
              target === undefined || target.part !== undefined ? undefined : byId.get(target.attributeId);
            if (attribute?.type !== 'select' && attribute?.type !== 'status') return [];
            const labels = missingOptions(loaded.table.rows, column, attribute);
            if (labels.length === 0) return [];
            const held = (attribute.options ?? []).filter((option) => !option.isArchived).length;
            return [{ column, attribute, labels, canCreate: canManage && held + labels.length <= OPTION_LIMIT }];
          }),
    [byId, canManage, loaded, targets],
  );
  /** A label's choice: the member's, else Create option where they may, else Leave empty. */
  const choiceOf = (column: number, label: string): LabelChoice => {
    const chosen = labelChoices.get(column)?.get(labelKey(label));
    if (chosen !== undefined) return chosen;
    return labelNotes.find((note) => note.column === column)?.canCreate === true
      ? { kind: 'create' }
      : { kind: 'empty' };
  };
  /** The review's choices as the reader takes them: each select column's labels, and the columns left empty. */
  const readChoices = (withAttributes: ReadonlyMap<string, AttributeDefinition>): ReadChoices => {
    const byColumn = new Map(
      labelNotes.map((note) => [
        note.column,
        new Map(note.labels.map((label) => [labelKey(label), choiceOf(note.column, label)])),
      ]),
    );
    return {
      rewrite: (column, text) => {
        const decided = byColumn.get(column);
        const target = targets[column];
        const attribute = target === undefined ? undefined : withAttributes.get(target.attributeId);
        return decided === undefined || attribute === undefined ? text : applyLabels(text, attribute, decided);
      },
      emptyColumns: new Set(groups.map((group) => group.column).filter((column) => !keptColumns.has(column))),
    };
  };

  /** Moves to a step, focus to the page's title (the step's Card and the button pressed went away). */
  const setStep = (next: Step) => {
    setStepNow(next);
    focusTitle();
  };

  // Leaving with a file loaded asks first, in a Modal, and drops it (AC-1113); while rows are sending it says the
  // import stops. Closing the tab asks the browser's way, the only way it can.
  const isDirty = loaded !== undefined;
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty && !leaving.current,
    enableBeforeUnload: () => isDirty && !leaving.current,
    withResolver: true,
  });

  /** Forgets everything read from the file's rows: the next Continue reads them again. */
  const resetRead = () => {
    setResult(undefined);
    setNeedsReview(false);
    setGroups([]);
    setMatches(undefined);
  };

  const choose = async (files: readonly File[]) => {
    const [file] = files;
    if (file === undefined || isReading) return;
    setReading(true);
    setUploadError(undefined);
    try {
      const needsPhone = choices.some((choice) => choice.attribute.type === 'phone');
      const [read, library] = await Promise.all([
        readCsvFile(file),
        needsPhone ? loadPhoneLibrary().catch(() => undefined) : Promise.resolve(undefined),
      ]);
      if (!read.ok) {
        setUploadError(read.reason === 'type' ? (excelRefusal(file.name) ?? refusalText(read)) : refusalText(read));
        return;
      }
      const parser = library === undefined ? undefined : createPhoneParser(library);
      const reader = contextFor(parser);
      const { table } = read;
      const samples = table.headers.map((_, column) => samplesOf(table, column, SAMPLE_READ));
      const proposed = autoMatch(table.headers, samples, choices, (choice, text) => {
        if (choice.target.part !== undefined || choice.attribute.type === 'record_reference') return true;
        const field = fields.get(choice.attribute.id) ?? toFieldAttribute(choice.attribute);
        if (readCell(text, field, reader).ok) return true;
        // A date reads either way round here; its order is chosen in Match columns.
        return (
          choice.attribute.type === 'date' &&
          (['day-first', 'month-first'] as const).some(
            (order) => readCell(text, field, contextFor(parser, new Map([[field.id, orderLocale(order)]]))).ok,
          )
        );
      });
      setPhone(parser);
      setLoaded({ name: file.name, table, samples: samples.map((each) => each.slice(0, SAMPLES_SHOWN)) });
      setTargets(proposed);
      setDateOrders(new Map());
      setLabelChoices(new Map());
      setKeptColumns(new Set());
      checkLinks(table.rows, proposed, new Map());
      setMatchId(undefined);
      resetRead();
      setStep('columns');
    } catch {
      setUploadError(strings.refusals.failed);
    } finally {
      setReading(false);
    }
  };

  /**
   * Looks up each relation column's names (decision 7), so the columns step
   * says how many link to nothing before anything is sent. A column whose
   * target changed meanwhile drops its answer.
   */
  const checkLinks = (
    rows: readonly (readonly string[])[],
    next: readonly (ImportTarget | undefined)[],
    known: ReadonlyMap<number, LinkCheck>,
  ) => {
    // Answers still on their way for checks dropped here (another file, another target) are ignored when they land.
    for (const [column, run] of linkRuns.current) {
      if (known.get(column)?.attributeId !== next[column]?.attributeId) linkRuns.current.set(column, run + 1);
    }
    const kept = new Map<number, LinkCheck>();
    for (const [column, check] of known) {
      if (next[column]?.attributeId === check.attributeId) kept.set(column, check);
    }
    setLinks(kept);
    next.forEach((target, column) => {
      const attribute = target === undefined ? undefined : byId.get(target.attributeId);
      if (attribute?.type !== 'record_reference' || kept.has(column)) return;
      const names = columnNames(rows, column, attribute.isMulti);
      if (names.length === 0) return;
      const run = (linkRuns.current.get(column) ?? 0) + 1;
      linkRuns.current.set(column, run);
      const settle = (check: LinkCheck) => {
        if (linkRuns.current.get(column) === run) setLinks((current) => new Map(current).set(column, check));
      };
      settle({ status: 'checking', attributeId: attribute.id });
      data.imports.links(slug, object.id, attribute.id, names).then(
        (answer) => settle({ status: 'done', attributeId: attribute.id, total: names.length, ...answer }),
        () => settle({ status: 'failed', attributeId: attribute.id }),
      );
    });
  };

  /** Reads the object's attributes again, after the page made one or added options. */
  const reread = async () => {
    const next = await data.attributes.list(slug, object.id);
    setAttributes(next);
    return [...listFields, ...next];
  };

  /** Points a column at a target, forgetting what the rows read as before. */
  const setTarget = (column: number, target: ImportTarget | undefined) => {
    if (loaded === undefined) return;
    const next = targets.map((each, index) => (index === column ? target : each));
    setTargets(next);
    resetRead();
    checkLinks(loaded.table.rows, next, links);
  };

  // Records are found by one of their own fields, never a list's.
  const candidates = matchAttributes(objectAttributes, targets);
  const matchAttributeId =
    matchId === undefined
      ? (defaultMatch(object, candidates) ?? candidates[0]?.id)
      : candidates.some((attribute) => attribute.id === matchId)
        ? matchId
        : undefined;
  const matched = targets.filter((target) => target !== undefined).length;

  /** Every row read, a slice at a time, in the browser's language and time zone (AC-1120). */
  const readAll = (
    withAttributes: readonly AttributeDefinition[],
    readChoicesNow: ReadChoices,
  ): Promise<ReadRows | undefined> => {
    if (loaded === undefined) return Promise.resolve(undefined);
    const run = (checking.current += 1);
    setChecked(0);
    return readRowsInSlices(
      loaded.table.rows,
      loaded.table.headers,
      targets,
      fieldsOf(withAttributes),
      context,
      (read) => {
        if (checking.current === run) setChecked(read);
      },
      () => checking.current !== run,
      readChoicesNow,
    ).then((read) => {
      if (checking.current !== run) return undefined;
      setChecked(undefined);
      return read;
    });
  };

  /**
   * Asks which ready rows' match values name a record (one lookup a 1,000
   * values), so the preview says how many rows are new, update or skip
   * before anything is sent. A newer ask drops an older answer.
   */
  const lookUpMatches = (read: ReadRows, attributeId: string | undefined) => {
    const run = (matchRun.current += 1);
    if (attributeId === undefined) {
      setMatches(undefined);
      return;
    }
    const withValue = read.ready.flatMap((row, index) =>
      Object.hasOwn(row.values, attributeId) ? [{ index, value: row.values[attributeId] }] : [],
    );
    if (withValue.length === 0) {
      setMatches({ status: 'done', answers: [] });
      return;
    }
    setMatches({ status: 'checking' });
    data.imports
      .matches(
        slug,
        object.id,
        attributeId,
        withValue.map((each) => each.value),
      )
      .then(
        (rows) => {
          if (matchRun.current !== run) return;
          const answers: RowMatch[] = read.ready.map(() => ({ keys: [], matched: false }));
          withValue.forEach((each, at) => {
            const answer = rows[at];
            if (answer !== undefined) answers[each.index] = answer;
          });
          setMatches({ status: 'done', answers });
        },
        () => {
          if (matchRun.current === run) setMatches({ status: 'failed' });
        },
      );
  };

  /** Shows the preview of rows read, with the match lookup on its way. */
  const showPreview = (read: ReadRows) => {
    setResult(read);
    setPage(1);
    setFilter('all');
    setNotice(undefined);
    lookUpMatches(read, matchAttributeId);
    setStep('preview');
  };

  // Columns' Continue: every row read once with the label choices' defaults. Nothing to settle goes straight to the
  // preview; a label that names no option, or a column with cells that don't read, opens Review values first.
  // Kept until the file, a column's target or a choice changes, so Back and Continue never read it again.
  const fromColumns = () => {
    if (loaded === undefined) return;
    if (result !== undefined) {
      setStep(needsReview ? 'review' : 'preview');
      return;
    }
    void readAll(attributes, { ...readChoices(byId), emptyColumns: new Set() }).then((read) => {
      if (read === undefined) return;
      const found = cellGroups(read.errors, new Set(labelNotes.map((note) => note.column)));
      if (labelNotes.length === 0 && found.length === 0) {
        setNeedsReview(false);
        showPreview(read);
        return;
      }
      setGroups(found);
      setNeedsReview(true);
      setReviewError(undefined);
      setStep('review');
    });
  };

  // Review's Continue: the labels chosen to be created become options, then every row is read with the choices.
  const fromReview = async () => {
    setReviewError(undefined);
    let current = attributes;
    const toCreate = labelNotes.flatMap((note) =>
      note.labels
        .filter((label) => choiceOf(note.column, label).kind === 'create')
        .map((label) => ({ attributeId: note.attribute.id, label })),
    );
    if (toCreate.length > 0) {
      setCreatingOptions(true);
      try {
        for (const each of toCreate) {
          await data.options.create(slug, object.id, each.attributeId, {
            id: data.attributes.newId(),
            label: each.label,
          });
        }
        current = await reread();
      } catch (error) {
        setReviewError(isDataError(error) ? error.message : sharedStrings.couldntDoThat);
        await reread().catch(() => undefined);
        return;
      } finally {
        setCreatingOptions(false);
      }
    }
    const withAttributes = new Map(current.map((attribute) => [attribute.id, attribute]));
    const read = await readAll(current, readChoices(withAttributes));
    if (read !== undefined) showPreview(read);
  };

  const steps = [
    { id: 'upload', label: strings.steps.upload },
    { id: 'columns', label: strings.steps.columns },
    ...(needsReview ? [{ id: 'review', label: strings.steps.review }] : []),
    { id: 'preview', label: strings.steps.preview },
  ];

  const start = async () => {
    if (loaded === undefined || result === undefined) return;
    // A fresh id each start: an earlier one that failed or was stopped stays unstarted (the daily cleanup removes
    // it), and a retry inside one start reuses its own id.
    const id = data.imports.newId();
    setNotice(undefined);
    stopped.current = false;
    setStopAsked(false);
    setSending({ sent: 0, total: result.ready.length });
    try {
      await data.imports.create(slug, {
        id,
        objectId: object.id,
        ...(into === undefined ? {} : { listId: into.list.id }),
        fileName: loaded.name,
        rowCount: loaded.table.rows.length,
        errorRows: result.errors.length,
        settings: {
          columns: loaded.table.headers.map((header, column) => {
            const target = targets[column];
            return { header: header.slice(0, 200), ...(target === undefined ? {} : { target }) };
          }),
          ...(matchAttributeId === undefined ? {} : { matchAttributeId }),
          onMatch,
          onNoMatch,
        },
      });
      await data.imports.stage(slug, id, result.ready, (sent) => {
        if (isStopped()) throw new Error('stopped');
        setSending({ sent, total: result.ready.length });
      });
      if (isStopped()) throw new Error('stopped');
      await data.imports.start(slug, id);
      leaving.current = true;
      void navigate({ href: importSummaryHref(slug, object, id) });
    } catch (error) {
      setSending(undefined);
      setStopAsked(false);
      focusTitle();
      if (isStopped()) {
        setNotice({ tone: 'info', message: strings.stopped });
        return;
      }
      setNotice({ tone: 'danger', message: isDataError(error) ? error.message : sharedStrings.couldntDoThat });
    }
  };

  const topBar = (
    <TopBar
      title={strings.title(into?.list.name ?? object.pluralName)}
      icon={into?.list.icon ?? object.icon}
      hue={into?.list.hue ?? object.hue}
      crumbs={[
        into === undefined
          ? { id: 'object', label: object.pluralName, href: objectHref(slug, object) }
          : { id: 'list', label: into.list.name, href: listHref(slug, into.list) },
      ]}
    />
  );

  const errors = result?.errors.length ?? 0;
  const readyCount = result?.ready.length ?? 0;
  const plan =
    result === undefined || (matchAttributeId !== undefined && matches?.status !== 'done')
      ? undefined
      : rowPlan(
          result.ready,
          matchAttributeId === undefined || matches?.status !== 'done' ? undefined : matches.answers,
          onMatch,
          matchAttributeId === undefined ? 'create' : onNoMatch,
        );
  const newColumn = newFor === undefined || loaded === undefined ? undefined : newFor;
  const suggested =
    newColumn === undefined || loaded === undefined
      ? undefined
      : suggestAttribute(loaded.table.rows.map((row) => cellText(row[newColumn])));

  const body = (
    <PageColumn>
      <Steps
        label={strings.stepsLabel}
        steps={steps}
        current={step}
        orientation="horizontal"
        // A done step goes back to it; never while rows are on their way.
        {...(sending === undefined && checked === undefined
          ? { onStepPress: (id: string) => setStep(id as Step) }
          : {})}
      />
      {step === 'upload' && (
        <>
          <Card>
            <FileDrop
              label={strings.dropLabel}
              acceptedTypes={FILE_TYPES}
              maxSize={TRANSFER_LIMITS.importBytes}
              onFiles={(files) => void choose(files)}
              isDisabled={isReading}
              wrongTypeText={excelRefusal}
            />
            {isReading && <ProgressBar label={strings.reading} isIndeterminate />}
            {/* The file's shape as a picture: row 1 is the column names. */}
            <SampleTable label={strings.sampleLabel} rows={strings.sampleRows} caption={strings.sampleCaption} />
            {/* A file's first row, as this object takes it: written here, nothing asked of the server. */}
            <Button
              variant="link"
              icon="download"
              onPress={() => {
                const titles = choices.filter((choice) => choice.target.part === undefined).map(choiceLabel);
                saveCsv(strings.sampleFile(object.pluralName), `${CSV_BOM}${csvLine(titles)}`);
              }}
            >
              {strings.sampleCsv}
            </Button>
            {uploadError !== undefined && (
              <Callout tone="danger" isAnnounced>
                {uploadError}
              </Callout>
            )}
          </Card>
          <RecentImports data={data} slug={slug} object={object} members={members} now={now} />
        </>
      )}
      {step === 'columns' && loaded !== undefined && (
        <ColumnsStep
          loaded={loaded}
          choices={choices}
          targets={targets}
          matched={matched}
          attributes={byId}
          objects={objects}
          links={links}
          canManage={canManage}
          error={columnsError}
          onTarget={setTarget}
          onNewAttribute={(column) => {
            setColumnsError(undefined);
            setNewFor(column);
          }}
          onCreateMissing={(column, isSelected) => {
            setTargets((current) =>
              current.map((each, index) =>
                index !== column || each === undefined
                  ? each
                  : isSelected
                    ? { ...each, createMissing: true }
                    : { attributeId: each.attributeId },
              ),
            );
          }}
          dates={dateColumns}
          onDateOrder={(column, order) => {
            setDateOrders((current) => new Map(current).set(column, order));
            resetRead();
          }}
          required={required}
          isCreating={onNoMatch === 'create'}
          onUpdateOnly={(isOnly) => {
            setOnNoMatch(isOnly ? 'skip' : 'create');
          }}
          checked={checked}
          onBack={() => {
            setLoaded(undefined);
            resetRead();
            setStep('upload');
          }}
          onContinue={fromColumns}
        />
      )}
      {step === 'review' && loaded !== undefined && (
        <ReviewStep
          headers={loaded.table.headers}
          labelNotes={labelNotes}
          choiceOf={choiceOf}
          onLabelChoice={(column, label, choice) => {
            setLabelChoices((current) =>
              new Map(current).set(column, new Map(current.get(column) ?? []).set(labelKey(label), choice)),
            );
          }}
          groups={groups}
          isEmptied={(column) => !keptColumns.has(column)}
          onEmptied={(column, isEmptied) => {
            setKeptColumns((current) => {
              const next = new Set(current);
              if (isEmptied) next.delete(column);
              else next.add(column);
              return next;
            });
          }}
          progress={
            isCreatingOptions
              ? { label: strings.review.creating }
              : checked !== undefined
                ? { label: strings.checking, value: checked, max: loaded.table.rows.length }
                : undefined
          }
          error={reviewError}
          onBack={() => setStep('columns')}
          onContinue={() => void fromReview()}
        />
      )}
      {step === 'preview' && loaded !== undefined && result !== undefined && (
        <Card
          title={strings.fileSummary(loaded.name, loaded.table.rows.length)}
          description={strings.totals(readyCount, errors)}
          footerNote={
            readyCount === 0
              ? undefined
              : plan === undefined
                ? matches?.status === 'failed'
                  ? strings.undoNote
                  : strings.planChecking
                : `${strings.plan(plan.created, plan.updated, plan.skipped)}. ${strings.undoNote}`
          }
          footer={
            sending === undefined ? (
              <>
                <Button onPress={() => setStep(needsReview ? 'review' : 'columns')}>{strings.back}</Button>
                <Button variant="primary" isDisabled={readyCount === 0} onPress={() => void start()}>
                  {strings.start}
                </Button>
              </>
            ) : (
              <Button isPending={isStopAsked} onPress={() => setStopping(true)}>
                {strings.stopSending}
              </Button>
            )
          }
        >
          {sending !== undefined && (
            <ProgressBar
              label={strings.sent(sending.sent, sending.total)}
              value={sending.sent}
              maxValue={Math.max(sending.total, 1)}
            />
          )}
          {notice !== undefined && (
            <Callout tone={notice.tone} isAnnounced>
              {notice.message}
            </Callout>
          )}
          {readyCount === 0 && <Callout tone="warning">{strings.nothingReady}</Callout>}
          {/* How rows find their records: one line, the object's usual key chosen already (AC-1117). */}
          <Select
            label={strings.findBy}
            items={[
              ...candidates.map((attribute) => ({ id: attribute.id, label: attribute.title })),
              { id: NONE, label: strings.alwaysCreate },
            ]}
            value={matchAttributeId ?? NONE}
            isDisabled={sending !== undefined}
            onChange={(id) => {
              const next = id ?? NONE;
              setMatchId(next);
              // The lookup follows the key: a new one asks again, always add drops it.
              lookUpMatches(result, candidates.some((attribute) => attribute.id === next) ? next : undefined);
            }}
          />
          {matchAttributeId === undefined && hasRecords === true && (
            <Callout tone="warning">{strings.duplicates}</Callout>
          )}
          {matchAttributeId !== undefined && (
            <Disclosure title={strings.moreSettings} variant="quiet">
              <RadioGroup
                label={strings.onMatch}
                value={onMatch}
                onChange={(value) => setOnMatch(value as ImportOnMatch)}
              >
                {(['fill', 'overwrite', 'skip'] as const).map((choice) => (
                  <Radio key={choice} value={choice}>
                    {strings.onMatchChoices[choice]}
                  </Radio>
                ))}
              </RadioGroup>
              <RadioGroup
                label={strings.onNoMatch}
                value={onNoMatch}
                onChange={(value) => setOnNoMatch(value as ImportOnNoMatch)}
                orientation="horizontal"
              >
                {(['create', 'skip'] as const).map((choice) => (
                  <Radio key={choice} value={choice}>
                    {strings.onNoMatchChoices[choice]}
                  </Radio>
                ))}
              </RadioGroup>
            </Disclosure>
          )}
          {/* The filter leads, the download of the rows to fix sits at the end of the same row. */}
          <SectionBar
            start={
              <SegmentedControl
                label={strings.filterLabel}
                segments={[
                  { value: 'all', label: strings.filters.all },
                  { value: 'ready', label: strings.filters.ready(readyCount) },
                  { value: 'errors', label: strings.filters.errors(errors) },
                ]}
                value={filter}
                onChange={(value) => {
                  setFilter(value as Filter);
                  setPage(1);
                }}
              />
            }
            {...(errors > 0
              ? {
                  end: (
                    <Button
                      variant="ghost"
                      icon="download"
                      onPress={() => {
                        saveCsv(
                          strings.errorsFile(loaded.name),
                          errorRowsCsv(loaded.table.headers, result.errors, strings.errorHeader),
                        );
                      }}
                    >
                      {strings.downloadErrors}
                    </Button>
                  ),
                }
              : {})}
          />
          <PreviewTable
            loaded={loaded}
            targets={targets}
            fields={fields}
            context={context}
            choices={readChoices(byId)}
            errors={result.errors}
            filter={filter}
            page={page}
            pageSize={pageSize}
          />
          <Pagination
            label={strings.rowsLabel}
            page={page}
            pageSize={pageSize}
            total={filter === 'errors' ? errors : filter === 'ready' ? readyCount : loaded.table.rows.length}
            pageSizes={PAGE_SIZES}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </Card>
      )}
      <AttributeDialog
        slug={slug}
        objectId={object.id}
        isOpen={newColumn !== undefined}
        members={members}
        canManage={canManage}
        objectAttributes={attributes}
        initialTypeKey={suggested === undefined ? undefined : (PICKER_KEYS[suggested.type] ?? suggested.type)}
        initialDraft={
          newColumn === undefined || loaded === undefined
            ? undefined
            : {
                title:
                  (loaded.table.headers[newColumn] ?? '').trim().slice(0, 100) || strings.newAttributeTitle(newColumn),
                ...(suggested === undefined || suggested.options.length === 0
                  ? {}
                  : { optionLabels: suggested.options }),
              }
        }
        onClose={() => setNewFor(undefined)}
        onSaved={(made) => {
          const column = newFor;
          setNewFor(undefined);
          void reread().then(
            () => {
              if (column !== undefined) setTarget(column, { attributeId: made.id });
            },
            () => setColumnsError(sharedStrings.couldntDoThat),
          );
        }}
      />
      <Modal
        title={strings.stopTitle}
        variant="confirm"
        tone="danger"
        isOpen={isStopping && sending !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setStopping(false);
        }}
        actions={
          <>
            <Button slot="close">{strings.keepGoing}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                stopped.current = true;
                setStopping(false);
                setStopAsked(true);
              }}
            >
              {strings.stopSending}
            </Button>
          </>
        }
      >
        {strings.nothingImported}
      </Modal>
      <Modal
        title={strings.leaveTitle}
        variant="confirm"
        tone="danger"
        isOpen={blocker.status === 'blocked'}
        onOpenChange={(isOpen) => {
          if (!isOpen && blocker.status === 'blocked') blocker.reset();
        }}
        actions={
          <>
            <Button slot="close">{strings.stay}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                stopped.current = true;
                leaving.current = true;
                if (blocker.status === 'blocked') blocker.proceed();
              }}
            >
              {strings.leave}
            </Button>
          </>
        }
      >
        {strings.nothingImported}
      </Modal>
    </PageColumn>
  );

  return <WorkspacePage currentObject={object.apiSlug} page={{ topBar, body }} />;
}

/** Props for the match columns step. */
interface ColumnsStepProps {
  readonly loaded: Loaded;
  readonly choices: readonly ImportChoice[];
  readonly targets: readonly (ImportTarget | undefined)[];
  readonly matched: number;
  readonly attributes: ReadonlyMap<string, AttributeDefinition>;
  readonly objects: readonly ObjectSummary[];
  readonly links: ReadonlyMap<number, LinkCheck>;
  /** May make attributes (`schema.manage`): New attribute shows only then. */
  readonly canManage: boolean;
  readonly error: string | undefined;
  readonly onTarget: (column: number, target: ImportTarget | undefined) => void;
  readonly onNewAttribute: (column: number) => void;
  readonly onCreateMissing: (column: number, isSelected: boolean) => void;
  /** The date columns whose values read either way round, each with its order and one value read by it. */
  readonly dates: readonly DateColumn[];
  readonly onDateOrder: (column: number, order: DateOrder) => void;
  /** Required attributes no column fills and no default fills: each a danger row, and Continue waits. */
  readonly required: readonly AttributeDefinition[];
  /** Rows matching no record make one (the default), so the required attributes need a column. */
  readonly isCreating: boolean;
  /** Only update records already there: nothing is made, so nothing required is missing. */
  readonly onUpdateOnly: (isOnly: boolean) => void;
  /** Rows read so far on the way on, while Continue reads them. */
  readonly checked: number | undefined;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

const COLUMN_COLUMNS: readonly TableColumn[] = [
  { id: 'header', label: strings.columns.header, isRowHeader: true },
  { id: 'sample', label: strings.columns.sample },
  { id: 'target', label: strings.columns.target },
];

/** A choice's label in the Select: the attribute's name, or "Name: First name". */
const choiceLabel = (choice: ImportChoice): string =>
  choice.target.part === undefined
    ? choice.attribute.title
    : strings.namePart(choice.attribute.title, choice.target.part);

/** Match columns (AC-1115, AC-1116): every column, its first values, where it goes, and its relation's names. */
function ColumnsStep({
  loaded,
  choices,
  targets,
  matched,
  attributes,
  objects,
  links,
  canManage,
  error,
  onTarget,
  onNewAttribute,
  onCreateMissing,
  dates,
  onDateOrder,
  required,
  isCreating,
  onUpdateOnly,
  checked,
  onBack,
  onContinue,
}: ColumnsStepProps) {
  const isMissingRequired = isCreating && required.length > 0;
  const freeColumns: readonly SelectItem[] = loaded.table.headers.flatMap((header, column) =>
    targets[column] === undefined
      ? [{ id: String(column), label: header === '' ? strings.newAttributeTitle(column) : header }]
      : [],
  );
  const { headers } = loaded.table;
  // Row ids never clash with the column ids, which share React Aria's one collection.
  const rows = headers.map((header, column) => ({ id: `column-${String(column)}`, header, column }));
  const itemsFor = (column: number): readonly SelectItem[] => {
    const others = targets.map((target, index) => (index === column ? undefined : target));
    return [
      { id: NONE, label: strings.dontImport },
      ...choices.map((choice) => {
        const holder = others.findIndex((target) => target !== undefined && choiceId(target) === choice.id);
        return {
          id: choice.id,
          label: choiceLabel(choice),
          ...(isFree(choice.target, others) ? {} : { isDisabled: true }),
          ...(holder >= 0 ? { description: strings.matchedTo(headers[holder] ?? '') } : {}),
        };
      }),
      ...(canManage ? [{ id: NEW, label: strings.newAttribute }] : []),
    ];
  };
  // A relation column's names that link nothing (looked up once per column and target).
  const notes = targets.flatMap((target, column) => {
    const attribute = target === undefined ? undefined : attributes.get(target.attributeId);
    const check = links.get(column);
    if (attribute?.type !== 'record_reference' || check?.attributeId !== attribute.id) return [];
    return [{ column, attribute, check }];
  });
  return (
    <Card
      title={strings.fileSummary(loaded.name, loaded.table.rows.length)}
      description={strings.columnsCount(matched, headers.length)}
      footer={
        <>
          <Button onPress={onBack}>{strings.chooseAnother}</Button>
          {matched === 0 || isMissingRequired ? (
            // Off until a column has somewhere to go and every required field has one, and says so on hover and focus.
            <Tooltip content={matched === 0 ? strings.matchOneFirst : strings.matchRequiredFirst}>
              <Button variant="primary" isDisabled>
                {strings.continue}
              </Button>
            </Tooltip>
          ) : (
            <Button variant="primary" isPending={checked !== undefined} onPress={onContinue}>
              {strings.continue}
            </Button>
          )}
        </>
      }
    >
      {error !== undefined && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      {/* Guarded here, not at Start: a required field no column fills would refuse every new row. */}
      {isCreating &&
        required.map((attribute) => (
          <Callout
            key={`required-${attribute.id}`}
            tone="danger"
            isPolite
            {...(choices.some((choice) => choice.attribute.id === attribute.id) && freeColumns.length > 0
              ? {
                  actions: (
                    <Select
                      label={strings.matchAColumn(attribute.title)}
                      isLabelHidden
                      placeholder={strings.matchAColumnShort}
                      size="sm"
                      items={freeColumns}
                      value={null}
                      onChange={(id) => {
                        if (id !== null) onTarget(Number(id), { attributeId: attribute.id });
                      }}
                    />
                  ),
                }
              : {})}
          >
            {strings.requiredMissing(attribute.title)}
          </Callout>
        ))}
      {required.length > 0 && <Checkbox label={strings.updateOnly} isSelected={!isCreating} onChange={onUpdateOnly} />}
      {checked !== undefined && (
        <ProgressBar label={strings.checking} value={checked} maxValue={Math.max(loaded.table.rows.length, 1)} />
      )}
      <Table
        label={strings.columnsLabel}
        columns={COLUMN_COLUMNS}
        rows={rows}
        getRowId={(row) => row.id}
        renderCell={(row, columnId) => {
          if (columnId === 'header') return row.header;
          if (columnId === 'sample') {
            const samples = loaded.samples[row.column] ?? [];
            return samples.length === 0 ? strings.noSample : samples.join(', ');
          }
          const target = targets[row.column];
          return (
            <Select
              label={strings.targetLabel(row.header)}
              isLabelHidden
              size="sm"
              items={itemsFor(row.column)}
              value={target === undefined ? NONE : choiceId(target)}
              showsDescription
              isSearchable={choices.length > 10}
              isDisabled={checked !== undefined}
              onChange={(id) => {
                if (id === NEW) {
                  onNewAttribute(row.column);
                  return;
                }
                onTarget(row.column, choices.find((choice) => choice.id === id)?.target);
              }}
            />
          );
        }}
      />
      {dates.map((date) => (
        <Callout
          key={`dates-${String(date.column)}`}
          tone="info"
          title={strings.datesTitle(headers[date.column] ?? '')}
          actions={
            <Select
              label={strings.dateOrderLabel(headers[date.column] ?? '')}
              isLabelHidden
              size="sm"
              items={[
                { id: 'day-first', label: strings.dayFirst },
                { id: 'month-first', label: strings.monthFirst },
              ]}
              value={date.order}
              onChange={(id) => {
                if (id === 'day-first' || id === 'month-first') onDateOrder(date.column, id);
              }}
            />
          }
        >
          {date.reads === undefined ? strings.dateUnread(date.sample) : strings.dateReads(date.sample, date.reads)}
        </Callout>
      ))}
      {notes.map((note) => {
        const header = headers[note.column] ?? '';
        const { check } = note;
        if (check.status === 'checking') {
          return (
            <ProgressBar key={`links-${String(note.column)}`} label={strings.checkingLinks(header)} isIndeterminate />
          );
        }
        if (check.status === 'failed') {
          return (
            <Callout key={`links-${String(note.column)}`} tone="info" isAnnounced>
              {strings.linksFailed(header)}
            </Callout>
          );
        }
        const farIds = note.attribute.relationship?.targetObjectIds ?? [];
        const far = farIds.length === 1 ? objects.find((each) => each.id === farIds[0]) : undefined;
        const canMake = far !== undefined && far.access === 'write' && !far.isArchived;
        if (check.missing.length === 0 && check.ambiguous.length === 0) {
          return (
            <Callout key={`links-${String(note.column)}`} tone="success" isAnnounced>
              {strings.linksAllFound(header, far?.singularName ?? note.attribute.title)}
            </Callout>
          );
        }
        const target = targets[note.column];
        const making = canMake && target?.createMissing === true;
        return (
          <Callout
            key={`links-${String(note.column)}`}
            tone={making && check.ambiguous.length === 0 ? 'info' : 'warning'}
            isAnnounced
            title={
              check.missing.length > 0
                ? strings.linksMissing(check.missing.length, check.total, header)
                : strings.linksAmbiguous(check.ambiguous.length)
            }
            {...(canMake && check.missing.length > 0
              ? {
                  // One choice per column, made already: Leave empty, or make them (31 October 2026).
                  actions: (
                    <SegmentedControl
                      label={strings.linksChoice(header)}
                      size="compact"
                      segments={[
                        { value: 'create', label: strings.createThem },
                        { value: 'leave', label: strings.leaveEmpty },
                      ]}
                      value={making ? 'create' : 'leave'}
                      onChange={(value) => onCreateMissing(note.column, value === 'create')}
                    />
                  ),
                }
              : {})}
          >
            {[
              check.missing.length === 0 ? '' : strings.linksMissingText(check.missing),
              check.ambiguous.length === 0 || check.missing.length === 0
                ? ''
                : strings.linksAmbiguous(check.ambiguous.length),
              canMake || check.missing.length === 0 || far === undefined ? '' : strings.linksCantMake(far.pluralName),
            ]
              .filter((part) => part !== '')
              .join(' ')}
          </Callout>
        );
      })}
    </Card>
  );
}

/** Props for the preview's table. */
interface PreviewTableProps {
  readonly loaded: Loaded;
  readonly targets: readonly (ImportTarget | undefined)[];
  readonly fields: ReadonlyMap<string, FieldAttribute>;
  readonly context: (attribute: FieldAttribute) => TextContext;
  /** Review's choices, so a cell shows as it will import (a label mapped, a cell left empty). */
  readonly choices: ReadChoices;
  readonly errors: readonly ErrorRow[];
  readonly filter: Filter;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * The preview's rows, a page at a time (AC-1121): the row number, an error
 * row's reasons (in the row's accessible text), then each matched column's
 * value drawn by its one field design.
 */
function PreviewTable({
  loaded,
  targets,
  fields,
  context,
  choices,
  errors,
  filter,
  page,
  pageSize,
}: PreviewTableProps) {
  const { headers, rows: all } = loaded.table;
  const byRow = useMemo(() => new Map(errors.map((row) => [row.rowNumber, row])), [errors]);
  const shown = useMemo((): readonly PreviewRow[] => {
    const start = (page - 1) * pageSize;
    if (filter === 'errors') {
      return errors
        .slice(start, start + pageSize)
        .map((error) => ({ rowNumber: error.rowNumber, cells: error.cells, error }));
    }
    const picked: PreviewRow[] = [];
    let skipped = 0;
    for (let index = 0; index < all.length && picked.length < pageSize; index += 1) {
      const rowNumber = index + 2;
      const error = byRow.get(rowNumber);
      if (filter === 'ready' && error !== undefined) continue;
      if (skipped < start) {
        skipped += 1;
        continue;
      }
      picked.push({ rowNumber, cells: all[index] ?? [], ...(error === undefined ? {} : { error }) });
    }
    return picked;
  }, [all, byRow, errors, filter, page, pageSize]);
  const matchedColumns = targets.flatMap((target, column) => (target === undefined ? [] : [column]));
  const columns: readonly TableColumn[] = [
    { id: 'row', label: strings.rowColumn, isRowHeader: true, align: 'end' },
    ...(errors.length > 0 ? [{ id: 'problems', label: strings.statusColumn }] : []),
    ...matchedColumns.map((column) => ({ id: `cell-${String(column)}`, label: headers[column] ?? '' })),
  ];
  return (
    <Table
      label={strings.rowsLabel}
      columns={columns}
      rows={shown}
      getRowId={(row) => `row-${String(row.rowNumber)}`}
      emptyState={<EmptyState title={strings.noRows} />}
      renderCell={(row, columnId) => {
        if (columnId === 'row') return n(row.rowNumber);
        // A ready row says so, so the column never reads as missing values beside the errors.
        if (columnId === 'problems') {
          if (row.error === undefined) return strings.readyRow;
          // A row that can't go in is marked, so it stands out from the ready ones beside it.
          return (
            <>
              <Icon name="circle-alert" size="xs" tone="danger" /> {problemText(row.error)}
            </>
          );
        }
        const column = Number(columnId.slice('cell-'.length));
        const target = targets[column];
        const written = cellText(row.cells[column]);
        const text = written === '' || choices.rewrite === undefined ? written : choices.rewrite(column, written);
        const attribute = target === undefined ? undefined : fields.get(target.attributeId);
        if (text === '' || target === undefined || attribute === undefined) return text;
        // A name's part draws as the name it fills.
        if (target.part !== undefined) {
          const name =
            target.part === 'first' ? { firstName: text, fullName: text } : { lastName: text, fullName: text };
          return <AttributeDisplay attribute={attribute} value={name} surface="preview" />;
        }
        const read = readCell(text, attribute, context);
        if (read.ok) return <AttributeDisplay attribute={attribute} value={read.value as never} surface="preview" />;
        // A cell review chose to leave empty shows empty, as it will import.
        return choices.emptyColumns?.has(column) === true ? '' : text;
      }}
    />
  );
}
