// Brief
// Purpose: bring a spreadsheet of records into one object, seeing what each row will do before anything changes.
// Main task: choose a CSV, check where its columns go and how rows find records, read the preview, then start.
// Leaves out: relation columns, creating options or attributes from the file (milestone 5), and other file types.
import {
  isDataError,
  toActorDisplays,
  toFieldAttribute,
  type AttributeDefinition,
  type DataLayer,
  type ImportOnMatch,
  type ImportOnNoMatch,
  type ImportTarget,
  type MemberSummary,
  type ObjectSummary,
} from '@crm/data';
import { readCsvFile, TRANSFER_LIMITS, type CsvResult, type CsvTable } from '@crm/data/imports';
import {
  AttributeDisplay,
  Button,
  Callout,
  Card,
  createPhoneParser,
  EmptyState,
  FileDrop,
  loadPhoneLibrary,
  Modal,
  PageColumn,
  Pagination,
  ProgressBar,
  Radio,
  RadioGroup,
  SegmentedControl,
  Select,
  Steps,
  Table,
  TopBar,
  type FieldAttribute,
  type PhoneParser,
  type SelectItem,
  type TableColumn,
  type TextContext,
} from '@crm/ui';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { objectHref } from '../workspace/objects.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
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
import { cellText, errorRowsCsv, problemText, readCell, readRows, type ErrorRow } from './rows.ts';
import { importSummaryHref } from './paths.ts';
import { n, strings } from './strings.ts';

/** Props for the import page: what its route loaded through the data layer. */
export interface ImportScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
}

type Step = 'upload' | 'columns' | 'records' | 'preview';
type Filter = 'all' | 'ready' | 'errors';

/** The Select id for "Don't import", and the match Select's "Always create new records". */
const NONE = 'none';
const SAMPLES_SHOWN = 3;
const PAGE_SIZES = [25, 50, 100] as const;

/** A file read and ready to match. */
interface Loaded {
  readonly name: string;
  readonly table: CsvTable;
}

/** Sending the rows: how many went, and whether the member stopped it. */
interface Sending {
  readonly sent: number;
  readonly total: number;
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

/** A column's first few values that aren't empty. */
const samplesOf = (table: CsvTable, column: number, size: number): readonly string[] => {
  const found: string[] = [];
  for (const row of table.rows) {
    const text = cellText(row[column]);
    if (text !== '') found.push(text);
    if (found.length >= size) break;
  }
  return found;
};

/** One row of the preview: a ready row, or one with errors. */
interface PreviewRow {
  readonly rowNumber: number;
  readonly cells: readonly string[];
  readonly error?: ErrorRow;
}

/** The import page (AC-1111 to AC-1123): four steps, then the rows sent and the import started. */
export function ImportScreen({ data, slug, object, attributes, members }: ImportScreenProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('upload');
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [isReading, setReading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const [phone, setPhone] = useState<PhoneParser | undefined>(undefined);
  const [targets, setTargets] = useState<readonly (ImportTarget | undefined)[]>([]);
  const [matchId, setMatchId] = useState<string>(NONE);
  const [onMatch, setOnMatch] = useState<ImportOnMatch>('fill');
  const [onNoMatch, setOnNoMatch] = useState<ImportOnNoMatch>('create');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [isConfirming, setConfirming] = useState(false);
  const [sending, setSending] = useState<Sending | undefined>(undefined);
  const [isStopping, setStopping] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const stopped = useRef(false);
  // Read through a call: the member may stop the sending while it awaits.
  const isStopped = () => stopped.current;
  const leaving = useRef(false);
  // One id per file: a retried create answers the same import.
  const importId = useRef<string | undefined>(undefined);

  const choices = useMemo(() => importChoices(attributes), [attributes]);
  const fields = useMemo(
    () => new Map(attributes.map((attribute) => [attribute.id, toFieldAttribute(attribute) as FieldAttribute])),
    [attributes],
  );
  const actors = useMemo(() => toActorDisplays(members), [members]);
  const locale = globalThis.navigator.languages[0] ?? 'en-US';
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const contextFor =
    (parser: PhoneParser | undefined) =>
    (attribute: FieldAttribute): TextContext => ({
      locale,
      timeZone,
      attribute,
      members: actors,
      ...(parser === undefined ? {} : { phone: parser }),
    });
  const context = contextFor(phone);

  // Leaving before the start asks first and drops the file (AC-1113); once rows are sent the summary takes over.
  const isDirty = loaded !== undefined && sending === undefined;
  useBlocker({
    shouldBlockFn: () => isDirty && !leaving.current && !globalThis.confirm(strings.leaveConfirm),
    enableBeforeUnload: () => isDirty && !leaving.current,
  });

  const choose = async (files: readonly File[]) => {
    const [file] = files;
    if (file === undefined || isReading) return;
    setReading(true);
    setUploadError(undefined);
    try {
      const needsPhone = choices.some((choice) => choice.attribute.type === 'phone');
      const [result, library] = await Promise.all([
        readCsvFile(file),
        needsPhone ? loadPhoneLibrary().catch(() => undefined) : Promise.resolve(undefined),
      ]);
      if (!result.ok) {
        setUploadError(refusalText(result));
        return;
      }
      const parser = library === undefined ? undefined : createPhoneParser(library);
      const read = contextFor(parser);
      const { table } = result;
      const proposed = autoMatch(
        table.headers,
        table.headers.map((_, column) => samplesOf(table, column, 50)),
        choices,
        (choice, text) =>
          choice.target.part !== undefined ||
          readCell(text, fields.get(choice.attribute.id) ?? toFieldAttribute(choice.attribute), read).ok,
      );
      const preferred = defaultMatch(object, matchAttributes(attributes, proposed));
      setPhone(parser);
      setLoaded({ name: file.name, table });
      setTargets(proposed);
      setMatchId(preferred ?? NONE);
      importId.current = data.imports.newId();
      setStep('columns');
    } catch {
      setUploadError(strings.refusals.failed);
    } finally {
      setReading(false);
    }
  };

  const candidates = matchAttributes(attributes, targets);
  const matchAttributeId = candidates.some((attribute) => attribute.id === matchId) ? matchId : undefined;
  const matched = targets.filter((target) => target !== undefined).length;

  // Every row read once on reaching the preview, in the browser's language and time zone (AC-1120).
  const result = useMemo(
    () =>
      step === 'preview' && loaded !== undefined
        ? readRows(loaded.table.rows, loaded.table.headers, targets, fields, context)
        : undefined,
    // The context only changes with the phone library, which `phone` names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, loaded, targets, fields, phone],
  );

  const steps = [
    { id: 'upload', label: strings.steps.upload },
    { id: 'columns', label: strings.steps.columns },
    { id: 'records', label: strings.steps.records },
    { id: 'preview', label: strings.steps.preview },
  ];

  const start = async () => {
    if (loaded === undefined || result === undefined || importId.current === undefined) return;
    const id = importId.current;
    setConfirming(false);
    setFailure(undefined);
    stopped.current = false;
    setSending({ sent: 0, total: result.ready.length });
    try {
      await data.imports.create(slug, {
        id,
        objectId: object.id,
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
      setStopping(false);
      if (isStopped()) {
        // A fresh id: the stopped import stays unstarted, and the daily cleanup removes it.
        importId.current = data.imports.newId();
        setFailure(strings.stopped);
        return;
      }
      setFailure(isDataError(error) ? error.message : strings.somethingWrong);
    }
  };

  const topBar = (
    <TopBar
      title={strings.title(object.pluralName)}
      icon={object.icon}
      hue={object.hue}
      crumbs={[{ id: 'object', label: object.pluralName, href: objectHref(slug, object) }]}
    />
  );

  const body = (
    <PageColumn>
      <Steps label={strings.stepsLabel} steps={steps} current={step} />
      {step === 'upload' && (
        <Card title={strings.uploadTitle} description={strings.uploadText}>
          <FileDrop
            label={strings.dropLabel}
            acceptedTypes={['text/csv', 'text/tab-separated-values', 'text/plain', '.csv', '.tsv', '.txt']}
            maxSize={TRANSFER_LIMITS.importBytes}
            onFiles={(files) => void choose(files)}
            isDisabled={isReading}
          />
          {isReading && <ProgressBar label={strings.reading} isIndeterminate />}
          {uploadError !== undefined && (
            <Callout tone="danger" isAnnounced>
              {uploadError}
            </Callout>
          )}
        </Card>
      )}
      {step === 'columns' && loaded !== undefined && (
        <ColumnsStep
          loaded={loaded}
          choices={choices}
          targets={targets}
          matched={matched}
          onTarget={(column, target) => {
            setTargets((current) => current.map((each, index) => (index === column ? target : each)));
          }}
          onBack={() => {
            setLoaded(undefined);
            setStep('upload');
          }}
          onContinue={() => setStep('records')}
        />
      )}
      {step === 'records' && (
        <Card
          title={strings.recordsTitle}
          description={strings.recordsText}
          footer={
            <>
              <Button onPress={() => setStep('columns')}>{strings.back}</Button>
              <Button
                variant="primary"
                onPress={() => {
                  setPage(1);
                  setFilter('all');
                  setStep('preview');
                }}
              >
                {strings.continue}
              </Button>
            </>
          }
        >
          <Select
            label={strings.findBy}
            items={[
              ...candidates.map((attribute) => ({ id: attribute.id, label: attribute.title })),
              { id: NONE, label: strings.alwaysCreate },
            ]}
            value={matchAttributeId ?? NONE}
            onChange={(id) => setMatchId(id ?? NONE)}
            {...(candidates.length === 0 ? { hint: strings.noKeyHint } : {})}
          />
          <RadioGroup
            label={strings.onMatch}
            value={onMatch}
            onChange={(value) => setOnMatch(value as ImportOnMatch)}
            isDisabled={matchAttributeId === undefined}
          >
            {(['fill', 'overwrite', 'skip'] as const).map((choice) => (
              <Radio key={choice} value={choice} description={strings.onMatchHints[choice]}>
                {strings.onMatchChoices[choice]}
              </Radio>
            ))}
          </RadioGroup>
          <RadioGroup
            label={strings.onNoMatch}
            value={onNoMatch}
            onChange={(value) => setOnNoMatch(value as ImportOnNoMatch)}
            isDisabled={matchAttributeId === undefined}
          >
            {(['create', 'skip'] as const).map((choice) => (
              <Radio key={choice} value={choice}>
                {strings.onNoMatchChoices[choice]}
              </Radio>
            ))}
          </RadioGroup>
        </Card>
      )}
      {step === 'preview' && loaded !== undefined && result !== undefined && (
        <Card
          title={strings.previewTitle}
          description={strings.totals(result.ready.length, result.errors.length)}
          actions={
            result.errors.length > 0 ? (
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
            ) : undefined
          }
          footer={
            sending === undefined ? (
              <>
                <Button onPress={() => setStep('records')}>{strings.back}</Button>
                <Button variant="primary" isDisabled={result.ready.length === 0} onPress={() => setConfirming(true)}>
                  {strings.start}
                </Button>
              </>
            ) : (
              <Button onPress={() => setStopping(true)}>{strings.stopSending}</Button>
            )
          }
        >
          {sending !== undefined && (
            <ProgressBar label={strings.sending} value={sending.sent} maxValue={Math.max(sending.total, 1)} showValue />
          )}
          {failure !== undefined && (
            <Callout tone={failure === strings.stopped ? 'info' : 'danger'} isAnnounced>
              {failure}
            </Callout>
          )}
          {result.ready.length === 0 && <Callout tone="warning">{strings.nothingReady}</Callout>}
          <SegmentedControl
            label={strings.filterLabel}
            segments={[
              { value: 'all', label: strings.filters.all },
              { value: 'ready', label: strings.filters.ready },
              { value: 'errors', label: strings.filters.errors },
            ]}
            value={filter}
            onChange={(value) => {
              setFilter(value as Filter);
              setPage(1);
            }}
          />
          <PreviewTable
            loaded={loaded}
            targets={targets}
            fields={fields}
            context={context}
            errors={result.errors}
            filter={filter}
            page={page}
            pageSize={pageSize}
          />
          <Pagination
            label={strings.rowsLabel}
            page={page}
            pageSize={pageSize}
            total={filteredCount(loaded.table.rows.length, result.errors.length, filter)}
            pageSizes={PAGE_SIZES}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </Card>
      )}
      <Modal
        title={strings.confirmTitle(result?.ready.length ?? 0, object.pluralName)}
        isOpen={isConfirming}
        onOpenChange={setConfirming}
        actions={
          <>
            <Button slot="close">{strings.notYet}</Button>
            <Button variant="primary" onPress={() => void start()}>
              {strings.start}
            </Button>
          </>
        }
      >
        {strings.confirmText(result?.errors.length ?? 0)}
      </Modal>
      <Modal
        title={strings.stopTitle}
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
              }}
            >
              {strings.stopSending}
            </Button>
          </>
        }
      >
        {strings.stopText}
      </Modal>
    </PageColumn>
  );

  return <WorkspacePage currentObject={object.apiSlug} page={{ topBar, body }} />;
}

/** How many rows a filter shows. */
function filteredCount(rows: number, errors: number, filter: Filter): number {
  if (filter === 'errors') return errors;
  if (filter === 'ready') return rows - errors;
  return rows;
}

/** Props for the match columns step. */
interface ColumnsStepProps {
  readonly loaded: Loaded;
  readonly choices: readonly ImportChoice[];
  readonly targets: readonly (ImportTarget | undefined)[];
  readonly matched: number;
  readonly onTarget: (column: number, target: ImportTarget | undefined) => void;
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

/** Match columns (AC-1115): every column, its first values, and where it goes. */
function ColumnsStep({ loaded, choices, targets, matched, onTarget, onBack, onContinue }: ColumnsStepProps) {
  const { headers } = loaded.table;
  // Row ids never clash with the column ids, which share React Aria's one collection.
  const rows = headers.map((header, column) => ({ id: `column-${String(column)}`, header, column }));
  const itemsFor = (column: number): readonly SelectItem[] => {
    const others = targets.map((target, index) => (index === column ? undefined : target));
    return [
      { id: NONE, label: strings.dontImport },
      ...choices.map((choice) => {
        const free = isFree(choice.target, others);
        const holder = others.findIndex((target) => target !== undefined && choiceId(target) === choice.id);
        return {
          id: choice.id,
          label: choiceLabel(choice),
          ...(free ? {} : { isDisabled: true }),
          ...(holder >= 0 ? { description: strings.matchedTo(headers[holder] ?? '') } : {}),
        };
      }),
    ];
  };
  return (
    <Card
      title={strings.columnsTitle}
      description={strings.columnsCount(matched, headers.length)}
      footer={
        <>
          <Button onPress={onBack}>{strings.chooseAnother}</Button>
          <Button variant="primary" isDisabled={matched === 0} onPress={onContinue}>
            {strings.continue}
          </Button>
        </>
      }
    >
      {matched === 0 && <Callout tone="info">{strings.needOneColumn}</Callout>}
      <Table
        label={strings.columnsTitle}
        columns={COLUMN_COLUMNS}
        rows={rows}
        getRowId={(row) => row.id}
        renderCell={(row, columnId) => {
          if (columnId === 'header') return row.header;
          if (columnId === 'sample') {
            const samples = samplesOf(loaded.table, row.column, SAMPLES_SHOWN);
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
              onChange={(id) => {
                onTarget(row.column, choices.find((choice) => choice.id === id)?.target);
              }}
            />
          );
        }}
      />
    </Card>
  );
}

/** Props for the preview's table. */
interface PreviewTableProps {
  readonly loaded: Loaded;
  readonly targets: readonly (ImportTarget | undefined)[];
  readonly fields: ReadonlyMap<string, FieldAttribute>;
  readonly context: (attribute: FieldAttribute) => TextContext;
  readonly errors: readonly ErrorRow[];
  readonly filter: Filter;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * The preview's rows, a page at a time (AC-1121): the row number, each
 * matched column's value drawn by its one field design, and an error row's
 * reasons in its own column, so they are in the row's accessible text.
 */
function PreviewTable({ loaded, targets, fields, context, errors, filter, page, pageSize }: PreviewTableProps) {
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
  const matchedColumns = targets.flatMap((target, column) => (target === undefined ? [] : [{ target, column }]));
  const columns: readonly TableColumn[] = [
    { id: 'row', label: strings.rowColumn, isRowHeader: true, align: 'end' },
    ...matchedColumns.map(({ column }) => ({
      id: `cell-${String(column)}`,
      label: headers[column] ?? '',
    })),
    ...(errors.length > 0 ? [{ id: 'problems', label: strings.problemsColumn }] : []),
  ];
  return (
    <Table
      label={strings.rowsLabel}
      columns={columns}
      rows={shown}
      getRowId={(row) => `row-${String(row.rowNumber)}`}
      emptyState={<EmptyState title={strings.noRows}>{strings.noRowsText}</EmptyState>}
      renderCell={(row, columnId) => {
        if (columnId === 'row') return n(row.rowNumber);
        if (columnId === 'problems') return row.error === undefined ? '' : problemText(row.error);
        const column = Number(columnId.slice('cell-'.length));
        const target = targets[column];
        const text = cellText(row.cells[column]);
        const attribute = target === undefined ? undefined : fields.get(target.attributeId);
        if (text === '' || target === undefined || attribute === undefined || target.part !== undefined) return text;
        const read = readCell(text, attribute, context);
        return read.ok ? (
          <AttributeDisplay attribute={attribute} value={read.value as never} surface="preview" />
        ) : (
          text
        );
      }}
    />
  );
}
