// Brief
// Purpose: bring a spreadsheet of records into one object, seeing what each row will do before anything changes.
// Main task: choose a CSV, check where its columns go and how rows find records, read the preview, then start.
// Leaves out: making far records of more than one object for a relation column, and file types other than CSV.
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
  Checkbox,
  createPhoneParser,
  EmptyState,
  Icon,
  FileDrop,
  InfoTip,
  loadPhoneLibrary,
  Modal,
  PageColumn,
  Pagination,
  ProgressBar,
  Radio,
  RadioGroup,
  SectionBar,
  SegmentedControl,
  Select,
  Steps,
  Table,
  Tooltip,
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
import { columnNames, missingOptions, suggestType } from './missing.ts';
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
  /** The workspace's objects, for a relation column's far object (its name, and whether the member may make its records). */
  readonly objects: readonly ObjectSummary[];
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

type Step = 'upload' | 'columns' | 'records' | 'preview';
type Filter = 'all' | 'ready' | 'errors';

/** The Select id for "Don't import", and the match Select's "Always create new records". */
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
export function ImportScreen({ data, slug, object, attributes: given, members, objects }: ImportScreenProps) {
  const navigate = useNavigate();
  const canManage = useCan('schema.manage');
  // Read again after the page makes an attribute or options, so the columns and the preview use them.
  const [attributes, setAttributes] = useState(given);
  const [links, setLinks] = useState<ReadonlyMap<number, LinkCheck>>(new Map());
  const [busyColumn, setBusyColumn] = useState<number | undefined>(undefined);
  const [columnsError, setColumnsError] = useState<string | undefined>(undefined);
  const linkRuns = useRef(new Map<number, number>());
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
  const byId = useMemo(() => new Map(attributes.map((attribute) => [attribute.id, attribute])), [attributes]);
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
          choice.attribute.type === 'record_reference' ||
          readCell(text, fields.get(choice.attribute.id) ?? toFieldAttribute(choice.attribute), reader).ok,
      );
      setPhone(parser);
      setLoaded({ name: file.name, table, samples: samples.map((each) => each.slice(0, SAMPLES_SHOWN)) });
      setTargets(proposed);
      checkLinks(table.rows, proposed, new Map());
      setMatchId(defaultMatch(object, matchAttributes(attributes, proposed)) ?? NONE);
      setResult(undefined);
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
    return next;
  };

  /** Makes an attribute from a column's header and values (AC-1116), and matches the column to it. */
  const makeAttribute = async (column: number) => {
    if (loaded === undefined || busyColumn !== undefined) return;
    const header = (loaded.table.headers[column] ?? '').trim().slice(0, 100);
    setBusyColumn(column);
    setColumnsError(undefined);
    try {
      const base = header === '' ? strings.newAttributeTitle(column) : header;
      const type = suggestType(samplesOf(loaded.table, column, SAMPLE_READ));
      // A header an attribute already holds ("Email") takes "Email 2", then "Email 3", as its name.
      const create = async (attempt: number): Promise<AttributeDefinition> => {
        try {
          return await data.attributes.create(slug, {
            id: data.attributes.newId(),
            objectId: object.id,
            title: attempt === 1 ? base : `${base.slice(0, 95)} ${String(attempt)}`,
            type,
          });
        } catch (error) {
          if (attempt < 5 && isDataError(error) && error.code === 'SLUG_TAKEN') return create(attempt + 1);
          throw error;
        }
      };
      const made = await create(1);
      await reread();
      setTargets((current) => current.map((each, index) => (index === column ? { attributeId: made.id } : each)));
      setResult(undefined);
    } catch (error) {
      setColumnsError(isDataError(error) ? error.message : strings.somethingWrong);
    } finally {
      setBusyColumn(undefined);
    }
  };

  /** Adds a select or status column's missing labels as options (AC-1122), then reads the column again. */
  const makeOptions = async (column: number, attributeId: string, labels: readonly string[]) => {
    if (busyColumn !== undefined) return;
    setBusyColumn(column);
    setColumnsError(undefined);
    try {
      for (const label of labels) {
        await data.options.create(slug, object.id, attributeId, { id: data.attributes.newId(), label });
      }
    } catch (error) {
      setColumnsError(isDataError(error) ? error.message : strings.somethingWrong);
    } finally {
      await reread().catch(() => undefined);
      setResult(undefined);
      setBusyColumn(undefined);
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
      <Steps label={strings.stepsLabel} steps={steps} current={step} orientation="horizontal" />
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
          attributes={byId}
          objects={objects}
          links={links}
          canManage={canManage}
          busyColumn={busyColumn}
          error={columnsError}
          onTarget={(column, target) => {
            const next = targets.map((each, index) => (index === column ? target : each));
            setTargets(next);
            setResult(undefined);
            checkLinks(loaded.table.rows, next, links);
          }}
          onNewAttribute={(column) => void makeAttribute(column)}
          onCreateOptions={(column, attributeId, labels) => void makeOptions(column, attributeId, labels)}
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
          title={strings.fileSummary(loaded.name, loaded.table.rows.length)}
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
  readonly attributes: ReadonlyMap<string, AttributeDefinition>;
  readonly objects: readonly ObjectSummary[];
  readonly links: ReadonlyMap<number, LinkCheck>;
  /** May make attributes and options (`schema.manage`): New attribute and Create options show only then. */
  readonly canManage: boolean;
  /** The column whose attribute or options are being made, its Select and buttons waiting. */
  readonly busyColumn: number | undefined;
  readonly error: string | undefined;
  readonly onTarget: (column: number, target: ImportTarget | undefined) => void;
  readonly onNewAttribute: (column: number) => void;
  readonly onCreateOptions: (column: number, attributeId: string, labels: readonly string[]) => void;
  readonly onCreateMissing: (column: number, isSelected: boolean) => void;
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

/** What a matched column lacks, said under the columns. */
type ColumnNote =
  | {
      readonly kind: 'options';
      readonly column: number;
      readonly attribute: AttributeDefinition;
      readonly labels: readonly string[];
    }
  | {
      readonly kind: 'links';
      readonly column: number;
      readonly attribute: AttributeDefinition;
      readonly check: LinkCheck;
    };

/** Match columns (AC-1115, AC-1116, AC-1122): every column, its first values, where it goes, and what it lacks. */
function ColumnsStep({
  loaded,
  choices,
  targets,
  matched,
  attributes,
  objects,
  links,
  canManage,
  busyColumn,
  error,
  onTarget,
  onNewAttribute,
  onCreateOptions,
  onCreateMissing,
  onBack,
  onContinue,
}: ColumnsStepProps) {
  const { headers } = loaded.table;
  // Row ids never clash with the column ids, which share React Aria's one collection.
  const rows = headers.map((header, column) => ({ id: `column-${String(column)}`, header, column }));
  const itemsFor = (column: number): readonly SelectItem[] => {
    const others = targets.map((target, index) => (index === column ? undefined : target));
    const type = suggestType(samplesOf(loaded.table, column, SAMPLE_READ));
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
      ...(canManage
        ? [
            {
              id: NEW,
              label: strings.newAttribute,
              description: strings.newAttributeHint(strings.suggestedTypes[type] ?? strings.suggestedTypes.text ?? ''),
            },
          ]
        : []),
    ];
  };
  // What each matched column lacks: a select's labels that name no option (a scan of every row, kept apart from
  // the link answers so those never scan again), and a relation's names that link nothing.
  const optionNotes = useMemo(
    () =>
      targets.flatMap((target, column): readonly ColumnNote[] => {
        const attribute =
          target === undefined || target.part !== undefined ? undefined : attributes.get(target.attributeId);
        if (attribute?.type !== 'select' && attribute?.type !== 'status') return [];
        const labels = missingOptions(loaded.table.rows, column, attribute);
        return labels.length === 0 ? [] : [{ kind: 'options', column, attribute, labels }];
      }),
    [attributes, loaded.table.rows, targets],
  );
  const notes = [
    ...optionNotes,
    ...targets.flatMap((target, column): readonly ColumnNote[] => {
      const attribute = target === undefined ? undefined : attributes.get(target.attributeId);
      const check = links.get(column);
      if (attribute?.type !== 'record_reference' || check?.attributeId !== attribute.id) return [];
      return [{ kind: 'links', column, attribute, check }];
    }),
  ];
  return (
    <Card
      title={strings.fileSummary(loaded.name, loaded.table.rows.length)}
      description={strings.columnsCount(matched, headers.length)}
      footer={
        <>
          <Button onPress={onBack}>{strings.chooseAnother}</Button>
          {matched === 0 ? (
            // Off until a column has somewhere to go, and says so on hover and focus.
            <Tooltip content={strings.matchOneFirst}>
              <Button variant="primary" isDisabled>
                {strings.continue}
              </Button>
            </Tooltip>
          ) : (
            <Button variant="primary" isDisabled={busyColumn !== undefined} onPress={onContinue}>
              {strings.continue}
            </Button>
          )}
        </>
      }
    >
      {matched === 0 && <Callout tone="info">{strings.needOneColumn}</Callout>}
      {error !== undefined && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      {busyColumn !== undefined && <ProgressBar label={strings.saving(headers[busyColumn] ?? '')} isIndeterminate />}
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
              isDisabled={busyColumn !== undefined && busyColumn !== row.column}
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
      {notes.map((note) => {
        const header = headers[note.column] ?? '';
        if (note.kind === 'options') {
          const held = (note.attribute.options ?? []).filter((option) => !option.isArchived).length;
          const fits = held + note.labels.length <= OPTION_LIMIT;
          return (
            <Callout
              key={`options-${String(note.column)}`}
              tone="warning"
              title={strings.missingOptions(note.labels.length, note.attribute.title)}
              {...(canManage && fits
                ? {
                    actions: (
                      <Button
                        size="sm"
                        isPending={busyColumn === note.column}
                        isDisabled={busyColumn !== undefined && busyColumn !== note.column}
                        onPress={() => onCreateOptions(note.column, note.attribute.id, note.labels)}
                      >
                        {strings.createOptions(note.labels.length)}
                      </Button>
                    ),
                  }
                : {})}
            >
              {`${strings.missingOptionsText(note.labels)} ${
                !canManage ? strings.missingOptionsNoManage : fits ? '' : strings.tooManyOptions(note.attribute.title)
              }`.trim()}
            </Callout>
          );
        }
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
                  actions: (
                    <Checkbox
                      label={strings.createMissing(check.missing.length, far.pluralName)}
                      description={strings.createMissingHint}
                      isSelected={making}
                      onChange={(isSelected) => onCreateMissing(note.column, isSelected)}
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
              making ? '' : strings.linksLeftOut,
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
    ...(errors.length > 0 ? [{ id: 'problems', label: strings.statusColumn }] : []),
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
