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
  InfoTip,
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
import { focusTitle } from '../navigation/focus-title.ts';
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
import { importSummaryHref } from './paths.ts';
import {
  cellText,
  errorRowsCsv,
  problemText,
  readCell,
  readRowsInSlices,
  type ErrorRow,
  type ReadRows,
} from './rows.ts';
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
const SAMPLE_READ = 50;
const PAGE_SIZES = [25, 50, 100] as const;
/** The file types the upload takes, by extension (FileDrop matches on it, and says them plainly). */
const FILE_TYPES = ['.csv', '.tsv', '.txt'] as const;

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

/** One row of the preview: a ready row, or one with errors. */
interface PreviewRow {
  readonly rowNumber: number;
  readonly cells: readonly string[];
  readonly error?: ErrorRow;
}

/** The import page (AC-1111 to AC-1123): four steps, then the rows sent and the import started. */
export function ImportScreen({ data, slug, object, attributes, members }: ImportScreenProps) {
  const navigate = useNavigate();
  const [step, setStepNow] = useState<Step>('upload');
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [isReading, setReading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const [phone, setPhone] = useState<PhoneParser | undefined>(undefined);
  const [targets, setTargets] = useState<readonly (ImportTarget | undefined)[]>([]);
  const [matchId, setMatchId] = useState<string>(NONE);
  const [onMatch, setOnMatch] = useState<ImportOnMatch>('fill');
  const [onNoMatch, setOnNoMatch] = useState<ImportOnNoMatch>('create');
  const [result, setResult] = useState<ReadRows | undefined>(undefined);
  const [checked, setChecked] = useState<number | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [isConfirming, setConfirming] = useState(false);
  const [sending, setSending] = useState<{ readonly sent: number; readonly total: number } | undefined>(undefined);
  const [isStopping, setStopping] = useState(false);
  const [isStopAsked, setStopAsked] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const stopped = useRef(false);
  const leaving = useRef(false);
  const checking = useRef(0);
  // Read through a call: the member may stop the sending while it awaits.
  const isStopped = () => stopped.current;

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
        setUploadError(refusalText(read));
        return;
      }
      const parser = library === undefined ? undefined : createPhoneParser(library);
      const reader = contextFor(parser);
      const { table } = read;
      const samples = table.headers.map((_, column) => samplesOf(table, column, SAMPLE_READ));
      const proposed = autoMatch(
        table.headers,
        samples,
        choices,
        (choice, text) =>
          choice.target.part !== undefined ||
          readCell(text, fields.get(choice.attribute.id) ?? toFieldAttribute(choice.attribute), reader).ok,
      );
      setPhone(parser);
      setLoaded({ name: file.name, table, samples: samples.map((each) => each.slice(0, SAMPLES_SHOWN)) });
      setTargets(proposed);
      setMatchId(defaultMatch(object, matchAttributes(attributes, proposed)) ?? NONE);
      setResult(undefined);
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

  // Every row read on the way to the preview, a slice at a time, in the browser's language and time zone (AC-1120).
  // Kept until the file or a column's target changes, so Back and Continue never read it again.
  const toPreview = () => {
    if (loaded === undefined) return;
    setPage(1);
    setFilter('all');
    setNotice(undefined);
    if (result !== undefined) {
      setStep('preview');
      return;
    }
    const run = (checking.current += 1);
    setChecked(0);
    void readRowsInSlices(
      loaded.table.rows,
      loaded.table.headers,
      targets,
      fields,
      context,
      (read) => {
        if (checking.current === run) setChecked(read);
      },
      () => checking.current !== run,
    ).then((read) => {
      if (read === undefined || checking.current !== run) return;
      setResult(read);
      setChecked(undefined);
      setStep('preview');
    });
  };

  const steps = [
    { id: 'upload', label: strings.steps.upload },
    { id: 'columns', label: strings.steps.columns },
    { id: 'records', label: strings.steps.records },
    { id: 'preview', label: strings.steps.preview },
  ];

  const start = async () => {
    if (loaded === undefined || result === undefined) return;
    // A fresh id each start: an earlier one that failed or was stopped stays unstarted (the daily cleanup removes
    // it), and a retry inside one start reuses its own id.
    const id = data.imports.newId();
    setConfirming(false);
    setNotice(undefined);
    stopped.current = false;
    setStopAsked(false);
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
      setStopAsked(false);
      focusTitle();
      if (isStopped()) {
        setNotice({ tone: 'info', message: strings.stopped });
        return;
      }
      setNotice({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
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

  const errors = result?.errors.length ?? 0;
  const readyCount = result?.ready.length ?? 0;

  const body = (
    <PageColumn>
      <Steps label={strings.stepsLabel} steps={steps} current={step} />
      {step === 'upload' && (
        <Card description={strings.uploadText}>
          <FileDrop
            label={strings.dropLabel}
            acceptedTypes={FILE_TYPES}
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
            setResult(undefined);
          }}
          onBack={() => {
            setLoaded(undefined);
            setResult(undefined);
            setStep('upload');
          }}
          onContinue={() => setStep('records')}
        />
      )}
      {step === 'records' && (
        <Card
          title={strings.steps.records}
          actions={
            <InfoTip label={strings.steps.records} example={strings.findByExample}>
              {strings.findByInfo}
            </InfoTip>
          }
          footer={
            <>
              <Button onPress={() => setStep('columns')}>{strings.back}</Button>
              <Button variant="primary" isPending={checked !== undefined} onPress={toPreview}>
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
          {matchAttributeId !== undefined && (
            <>
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
            </>
          )}
          {checked !== undefined && loaded !== undefined && (
            <ProgressBar label={strings.checking} value={checked} maxValue={Math.max(loaded.table.rows.length, 1)} />
          )}
        </Card>
      )}
      {step === 'preview' && loaded !== undefined && result !== undefined && (
        <Card
          description={strings.totals(readyCount, errors)}
          actions={<InfoTip label={strings.rowColumn}>{strings.rowInfo}</InfoTip>}
          footer={
            sending === undefined ? (
              <>
                <Button onPress={() => setStep('records')}>{strings.back}</Button>
                <Button variant="primary" isDisabled={readyCount === 0} onPress={() => setConfirming(true)}>
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
          {errors > 0 && (
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
          )}
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
      <Modal
        title={strings.confirmTitle(readyCount, object.pluralName)}
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
        {strings.confirmText(errors)}
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
                setStopAsked(true);
              }}
            >
              {strings.stopSending}
            </Button>
          </>
        }
      >
        {strings.stopText}
      </Modal>
      <Modal
        title={strings.leaveTitle}
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
        {sending === undefined ? strings.leaveText : strings.leaveSendingText}
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
        const holder = others.findIndex((target) => target !== undefined && choiceId(target) === choice.id);
        return {
          id: choice.id,
          label: choiceLabel(choice),
          ...(isFree(choice.target, others) ? {} : { isDisabled: true }),
          ...(holder >= 0 ? { description: strings.matchedTo(headers[holder] ?? '') } : {}),
        };
      }),
    ];
  };
  return (
    <Card
      title={strings.fileSummary(loaded.name, loaded.table.rows.length)}
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
 * The preview's rows, a page at a time (AC-1121): the row number, an error
 * row's reasons (in the row's accessible text), then each matched column's
 * value drawn by its one field design.
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
  const matchedColumns = targets.flatMap((target, column) => (target === undefined ? [] : [column]));
  const columns: readonly TableColumn[] = [
    { id: 'row', label: strings.rowColumn, isRowHeader: true, align: 'end' },
    ...(errors.length > 0 ? [{ id: 'problems', label: strings.reasonColumn }] : []),
    ...matchedColumns.map((column) => ({ id: `cell-${String(column)}`, label: headers[column] ?? '' })),
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
        if (text === '' || target === undefined || attribute === undefined) return text;
        // A name's part draws as the name it fills.
        if (target.part !== undefined) {
          const name =
            target.part === 'first' ? { firstName: text, fullName: text } : { lastName: text, fullName: text };
          return <AttributeDisplay attribute={attribute} value={name} surface="preview" />;
        }
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
