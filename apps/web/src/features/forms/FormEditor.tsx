// Brief
// Purpose: one form's editor (spec 0023, 0023-experience.md, Builder): its questions beside a live preview, then Settings, Install and Submissions once published.
// Main task: shape the draft (saved quietly as you go), publish it, and share it.
// Leaves out: steps and routing, round robin (#58), booking (#59), file questions (#32), analytics.
import {
  isDataError,
  type FormDocument,
  type FormTargetChoices,
  type FormView,
  type MemberSummary,
  type ObjectSummary,
  type SubmissionPage,
  type SubmissionState,
  type SubmissionView,
} from '@crm/data';
import { previewOf, publishProblem, type PublishProblem } from '@crm/data/forms';
import {
  Button,
  Callout,
  Card,
  EditorStatus,
  Field,
  focusLater,
  HostedFormPreview,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  PreviewLayout,
  Select,
  TabPanel,
  Tabs,
  TopBar,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { publishAttributesOf, sameDocument, statusOf } from './draft.ts';
import { InstallTab } from './InstallTab.tsx';
import { formHref, formPreviewHref, formsHref, FORM_TABS, type FormTab } from './paths.ts';
import { PublishDialog } from './PublishDialog.tsx';
import { QuestionsSection } from './QuestionsSection.tsx';
import { firstRefusal } from './refusals.ts';
import { SettingsTab, useFormSettings } from './SettingsTab.tsx';
import { useJobFollower } from './followJobs.ts';
import { strings } from './strings.ts';
import { SyncDialog } from './SyncDialog.tsx';
import { FormToolbarSlot } from './toolbarSlot.ts';
import { SubmissionsTab } from './SubmissionsTab.tsx';

/** Props for the editor: what its route loaded through the data layer. */
export interface FormEditorProps {
  readonly slug: string;
  readonly form: FormView;
  readonly target: FormTargetChoices;
  readonly members: readonly MemberSummary[];
  readonly objects: readonly ObjectSummary[];
  readonly tab: FormTab;
  readonly submissions: SubmissionPage | undefined;
  readonly state: SubmissionState | undefined;
  readonly openSubmission: SubmissionView | undefined;
}

/** A document's mapping, as one comparable string: the target, its match, and where each question files. */
function filingOf(document: FormDocument | undefined): string {
  if (document === undefined) return '';
  return JSON.stringify([
    document.targets.main,
    document.questions.map((question) => [question.id, question.filedOn?.attributeId ?? null]),
  ]);
}

/** How long after the last change the draft saves. */
const SAVE_AFTER_MS = 1_000;

/** The editor: the TopBar (name, Preview, Publish, menu), then the status line, tabs and the tab. */
export function FormEditor(props: FormEditorProps) {
  const { slug, members, objects, tab } = props;
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const canManage = useCan('forms.manage') && props.form.canManage;
  const canBuild = useCan('schema.manage');

  const [form, setForm] = useState(props.form);
  const [target, setTarget] = useState(props.target);
  const [draft, setDraft] = useState<FormDocument>(props.form.draft);
  const [conflict, setConflict] = useState(false);
  // A refused publish: the check's problem, or the server's (kept with the draft it refused).
  const [problem, setProblem] = useState<(PublishProblem & { readonly atDraft?: FormDocument }) | undefined>(undefined);
  const [isDeletingNow, setDeletingNow] = useState(false);
  const [isPublishing, setPublishing] = useState(false);
  const [isFirstPublish, setFirstPublish] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  // Publish leaves once there is nothing more to publish; focus then moves to the menu beside it.
  const moreRef = useRef<HTMLButtonElement>(null);
  const [isOfferingSync, setOfferingSync] = useState(false);
  const jobs = useJobFollower(data.jobs.view(slug, 'mine'));
  // The end of the tab strip, where a tab draws its own tools (Submissions' filter and search).
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  // The name, address and owner, saved together from the SaveBar on the Settings tab.
  const settings = useFormSettings({
    slug,
    form,
    onFormChange: (view) => {
      setForm((before) => ({ ...view, revision: before.revision }));
    },
  });

  // What the server holds: the draft last saved, and the revision a save names.
  const saved = useRef<{ document: FormDocument; revision: number }>({
    document: props.form.draft,
    revision: props.form.revision,
  });
  const latest = useRef(draft);
  const inFlight = useRef<Promise<number> | undefined>(undefined);
  const failedOnce = useRef(false);

  /** Saves the draft when it differs from the server's; answers the revision to go on from. */
  const flush = async (): Promise<number> => {
    if (inFlight.current !== undefined) await inFlight.current.catch(() => undefined);
    const document = latest.current;
    if (sameDocument(document, saved.current.document)) return saved.current.revision;
    const sending = data.forms.saveDraft(slug, form.id, document, saved.current.revision).then((view) => {
      saved.current = { document, revision: view.revision };
      failedOnce.current = false;
      setForm(view);
      return view.revision;
    });
    inFlight.current = sending;
    try {
      return await sending;
    } finally {
      if (inFlight.current === sending) inFlight.current = undefined;
    }
  };

  // Saved quietly a second after the last change; the screen never says Saving or Saved.
  useEffect(() => {
    latest.current = draft;
    if (!canManage || conflict || sameDocument(draft, saved.current.document)) return;
    const timer = setTimeout(() => {
      flush().catch((error: unknown) => {
        if (isDataError(error) && error.code === 'FORM_CHANGED') {
          setConflict(true);
          return;
        }
        if (!failedOnce.current) toasts.toast({ tone: 'danger', message: strings.saveFailed });
        failedOnce.current = true;
      });
    }, SAVE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
    // flush reads refs only; the draft is what schedules a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, canManage, conflict]);

  // A fixed problem lets go of its refusal: the check's own shows while the check still finds it, the server's
  // until the draft changes.
  const shown = useMemo(() => {
    if (problem === undefined) return undefined;
    if (problem.atDraft !== undefined) return problem.atDraft === draft ? problem : undefined;
    const still = publishProblem({
      name: form.name,
      slug: form.publicKey,
      document: draft,
      attributes: publishAttributesOf(target),
    });
    return still?.code === problem.code && still.questionId === problem.questionId ? problem : undefined;
  }, [draft, problem, form.name, form.publicKey, target]);

  const apply = (view: FormView) => {
    setForm(view);
    saved.current = { document: view.draft, revision: view.revision };
  };

  const loadTheirs = () => {
    data.forms.get(slug, form.id).then((view) => {
      apply(view);
      setDraft(view.draft);
      latest.current = view.draft;
      setConflict(false);
    }, failed);
  };

  function failed(error: unknown) {
    setPublishing(false);
    toasts.toast({ tone: 'danger', message: firstRefusal(error).message });
  }

  const isPublished = form.liveVersionNumber !== undefined;
  const isChanged = isPublished && !sameDocument(draft, form.live);
  const status = statusOf(form, isChanged);
  const liveIds = useMemo(() => new Set(form.live?.questions.map((question) => question.id) ?? []), [form.live]);
  const preview = useMemo(() => previewOf(draft, { key: form.publicKey }), [draft, form.publicKey]);

  const publish = () => {
    setProblem(undefined);
    const attributes = publishAttributesOf(target);
    // The first publish names the form and its address in its dialog; the questions are checked first.
    const found = publishProblem({
      name: isPublished ? form.name : form.name === '' ? 'x' : form.name,
      slug: form.publicKey,
      document: draft,
      attributes,
    });
    if (found !== undefined && (isPublished || (found.code !== 'NAME_MISSING' && found.code !== 'ADDRESS_INVALID'))) {
      setProblem(found);
      if (tab !== 'form') void navigate({ href: formHref(slug, form.id) });
      return;
    }
    if (!isPublished) {
      setFirstPublish(true);
      return;
    }
    setPublishing(true);
    flush()
      .then((revision) => data.forms.publish(slug, form.id, { expectedRevision: revision }))
      .then(
        (view) => {
          setPublishing(false);
          const mappingChanged = filingOf(form.live) !== filingOf(view.live);
          apply(view);
          toasts.toast({ tone: 'success', message: strings.published(view.liveVersionNumber ?? 1) });
          focusLater(() => moreRef.current);
          // A new mapping went live: offer to apply it to the enquiries that came before.
          if (mappingChanged && view.submissionCount > 0) setOfferingSync(true);
        },
        (error: unknown) => {
          setPublishing(false);
          if (isDataError(error) && error.code === 'FORM_CHANGED') {
            setConflict(true);
            return;
          }
          const refusal = firstRefusal(error);
          const questionId = draft.questions.some((question) => question.id === refusal.field)
            ? refusal.field
            : undefined;
          // The server's refusal, shown until the draft changes; its code is the server's own.
          setProblem({
            code: 'LABEL_MISSING',
            message: refusal.message,
            atDraft: draft,
            ...(questionId === undefined ? {} : { questionId }),
          });
        },
      );
  };

  const setStatus = (next: 'live' | 'paused') => {
    data.forms.setStatus(slug, form.id, next).then((view) => {
      apply(view);
      toasts.toast({
        tone: 'success',
        message: next === 'live' ? strings.resumed(view.name) : strings.paused(view.name),
      });
    }, failed);
  };

  const copyAddress = () => {
    void navigator.clipboard.writeText(data.forms.hostedUrl(form.publicKey)).then(() => {
      toasts.toast({ tone: 'success', message: strings.addressCopied });
    });
  };

  const goTab = (next: FormTab) => {
    void navigate({ href: formHref(slug, form.id, next) });
  };

  const changedBy = members.find((member) => member.id === form.draftSavedByMemberId)?.name;

  const topBar = (
    <TopBar
      title={form.name}
      icon="clipboard-list"
      crumbs={[{ id: 'forms', label: strings.forms, href: formsHref(slug) }]}
      meta={<EditorStatus tone={status.tone} text={status.text} />}
    >
      <Button
        icon="eye"
        onPress={() => {
          // The tab opens at once (a popup must come from the press), and loads once the draft is saved.
          const opened = window.open('', '_blank');
          if (opened !== null) opened.opener = null;
          const go = () => {
            if (opened !== null) opened.location.href = formPreviewHref(slug, form.id);
          };
          flush().then(go, go);
        }}
      >
        {strings.previewOpen}
      </Button>
      {/* Publish shows while there is something to publish; the status says when the live form is up to date. */}
      {canManage && (!isPublished || isChanged || form.hasUnpublished) && (
        <Button variant="primary" onPress={publish} isPending={isPublishing}>
          {isPublishing ? strings.publishing : strings.publish}
        </Button>
      )}
      {canManage && (
        <MenuTrigger>
          <Button ref={moreRef} variant="ghost" icon="ellipsis" label={strings.moreActions} />
          <Menu
            label={strings.moreActions}
            onAction={(key) => {
              if (key === 'copy') copyAddress();
              if (key === 'pause') setStatus('paused');
              if (key === 'resume') setStatus('live');
              if (key === 'duplicate') {
                data.forms.duplicate(slug, form.id).then((copy) => {
                  toasts.toast({ tone: 'success', message: strings.duplicated(copy.name) });
                  void navigate({ href: formHref(slug, copy.id) });
                }, failed);
              }
              if (key === 'delete') setDeleting(true);
            }}
          >
            <MenuItem id="copy" icon="copy" isDisabled={!isPublished}>
              {strings.copyAddress}
            </MenuItem>
            {form.status === 'live' && (
              <MenuItem id="pause" icon="pause">
                {strings.pause}
              </MenuItem>
            )}
            {form.status === 'paused' && (
              <MenuItem id="resume" icon="play">
                {strings.resume}
              </MenuItem>
            )}
            <MenuItem id="duplicate" icon="layers">
              {strings.duplicate}
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="delete" icon="trash" isDanger>
              {strings.deleteForm}
            </MenuItem>
          </Menu>
        </MenuTrigger>
      )}
    </TopBar>
  );

  const notices = (
    <>
      {form.status === 'paused' && (
        <Callout
          tone="warning"
          title={strings.pausedTitle}
          {...(canManage ? { actions: <Button onPress={() => setStatus('live')}>{strings.resume}</Button> } : {})}
        >
          {strings.pausedText}
        </Callout>
      )}
      {!canManage && (
        <Callout tone="info" title={strings.readOnlyTitle}>
          {strings.readOnlyText}
        </Callout>
      )}
      {conflict && (
        <Callout tone="warning" isAnnounced actions={<Button onPress={loadTheirs}>{strings.loadTheirs}</Button>}>
          {changedBy === undefined ? strings.someoneChanged : strings.changedBy(changedBy)}
        </Callout>
      )}
      {shown !== undefined && (
        <Callout tone="danger" isAnnounced>
          {shown.message}
        </Callout>
      )}
    </>
  );

  const current: FormTab = isPublished ? tab : 'form';
  const body = (() => {
    switch (current) {
      case 'settings':
        return (
          <SettingsTab
            slug={slug}
            form={form}
            draft={draft}
            target={target}
            members={members}
            isReadOnly={!canManage}
            settings={settings}
            onDraftChange={setDraft}
          />
        );
      case 'install':
        return <InstallTab slug={slug} form={form} isReadOnly={!canManage} onFormChange={setForm} />;
      case 'submissions':
        return props.submissions === undefined ? null : (
          <SubmissionsTab
            slug={slug}
            formId={form.id}
            objects={objects}
            page={props.submissions}
            state={props.state}
            open={props.openSubmission}
            canManage={canManage}
            questions={(form.live ?? form.draft).questions}
            link={data.forms.hostedUrl(form.publicKey)}
          />
        );
      default:
        return (
          <>
            {/* Before the first publish there is no Settings tab: the name is changed here, as a field. */}
            {!isPublished && canManage && (
              <DraftName
                name={form.name}
                onRename={(name) => {
                  data.forms.updateSettings(slug, form.id, { name }).then((view) => {
                    setForm((before) => ({ ...before, name: view.name, revision: before.revision }));
                  }, failed);
                }}
              />
            )}
            <QuestionsSection
              draft={draft}
              onChange={setDraft}
              attributes={target.items}
              objectName={target.objectName}
              liveIds={liveIds}
              newId={() => data.forms.newId()}
              toasts={toasts}
              isReadOnly={!canManage}
              {...(shown?.questionId === undefined
                ? {}
                : { problem: { questionId: shown.questionId, message: shown.message } })}
            />
          </>
        );
    }
  })();

  const layout = (
    <PreviewLayout
      notices={notices}
      // Settings and Install are groups of fields: side by side where there is room.
      bodyLayout={current === 'settings' || current === 'install' ? 'grid' : 'stack'}
      // On every tab, so a name, link or owner left unsaved still says so after a tab change.
      footer={settings.footer}
      {...(current === 'form' || current === 'settings'
        ? {
            preview: <HostedFormPreview form={preview} />,
            previewControls: (
              <>
                <Select
                  label={strings.colour}
                  isLabelHidden
                  size="sm"
                  isReadOnly={!canManage}
                  items={[
                    { id: 'light', label: strings.light, icon: 'sun' },
                    { id: 'dark', label: strings.dark, icon: 'moon' },
                  ]}
                  value={draft.look.colour}
                  onChange={(colour) => {
                    if (colour === 'light' || colour === 'dark') {
                      setDraft((before) => ({ ...before, look: { ...before.look, colour } }));
                    }
                  }}
                />
                <Select
                  label={strings.corners}
                  isLabelHidden
                  size="sm"
                  isReadOnly={!canManage}
                  items={[
                    { id: 'rounded', label: strings.rounded },
                    { id: 'square', label: strings.square },
                  ]}
                  value={draft.look.corners}
                  onChange={(corners) => {
                    if (corners === 'rounded' || corners === 'square') {
                      setDraft((before) => ({ ...before, look: { ...before.look, corners } }));
                    }
                  }}
                />
              </>
            ),
          }
        : {})}
    >
      {body}
    </PreviewLayout>
  );

  // The dialogs sit apart from the layout, so the body changing shape on the first publish never resets them.
  const dialogs = (
    <>
      <SyncDialog
        slug={slug}
        formId={form.id}
        isOpen={isOfferingSync}
        onClose={() => {
          setOfferingSync(false);
        }}
        onStarted={(jobId) => {
          setOfferingSync(false);
          toasts.toast({ tone: 'info', message: strings.syncStarted });
          jobs.follow(jobId, (job) => {
            toasts.toast({
              tone: job.status === 'succeeded' ? 'success' : 'danger',
              message:
                job.status === 'succeeded' ? strings.syncDone(job.done, job.refused) : strings.jobFailed(job.label),
            });
          });
        }}
      />
      {isFirstPublish && (
        <PublishDialog
          slug={slug}
          form={form}
          draft={draft}
          target={target}
          objects={objects}
          canBuild={canBuild}
          flush={flush}
          onDraftChange={(next) => {
            setDraft(next);
            latest.current = next;
          }}
          onTargetChange={(view, choices) => {
            apply(view);
            setDraft(view.draft);
            latest.current = view.draft;
            setTarget(choices);
          }}
          onPublished={(view) => {
            apply(view);
            setDraft(view.draft);
            latest.current = view.draft;
          }}
          onClose={() => {
            setFirstPublish(false);
            // Publish left once the form went live; focus goes to the menu beside where it was.
            focusLater(() => moreRef.current);
          }}
        />
      )}
      <Modal
        title={strings.deleteTitle(form.name)}
        tone="danger"
        isOpen={isDeleting}
        onOpenChange={setDeleting}
        actions={
          <>
            <Button slot="close" isDisabled={isDeletingNow}>
              {strings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              isPending={isDeletingNow}
              onPress={() => {
                if (isDeletingNow) return;
                setDeletingNow(true);
                data.forms.delete(slug, form.id).then(
                  () => {
                    toasts.toast({ tone: 'success', message: strings.deleted(form.name) });
                    void navigate({ href: formsHref(slug) });
                  },
                  (error: unknown) => {
                    setDeletingNow(false);
                    failed(error);
                  },
                );
              }}
            >
              {strings.delete}
            </Button>
          </>
        }
      >
        <p>{strings.deleteText(form.submissionCount)}</p>
      </Modal>
    </>
  );

  return (
    <WorkspacePage
      currentPage="captures"
      page={{
        topBar,
        body: (
          <FormToolbarSlot.Provider value={toolbarSlot}>
            {isPublished ? (
              // The Captures strip's way: the tabs edge to edge under the TopBar, the chosen tab's panel holding the layout.
              <Tabs
                end={<div ref={setToolbarSlot} />}
                label={strings.tabs}
                selectedKey={current}
                onSelectionChange={(value) => {
                  if ((FORM_TABS as readonly string[]).includes(value)) goTab(value as FormTab);
                }}
                tabs={[
                  { id: 'form', label: strings.tabForm, href: formHref(slug, form.id) },
                  { id: 'settings', label: strings.tabSettings, href: formHref(slug, form.id, 'settings') },
                  { id: 'install', label: strings.tabInstall, href: formHref(slug, form.id, 'install') },
                  { id: 'submissions', label: strings.tabSubmissions, href: formHref(slug, form.id, 'submissions') },
                ]}
              >
                {FORM_TABS.map((id) => (
                  <TabPanel key={id} id={id}>
                    {id === current && layout}
                  </TabPanel>
                ))}
              </Tabs>
            ) : (
              layout
            )}
            {dialogs}
          </FormToolbarSlot.Provider>
        ),
      }}
    />
  );
}

/** A draft's name, as a field: blur saves it, an empty one says so. */
function DraftName({ name, onRename }: { readonly name: string; readonly onRename: (name: string) => void }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <Card title={strings.name} description={strings.draftNameText}>
      <Field
        label={strings.name}
        isLabelHidden
        value={value}
        maxLength={80}
        isRequired
        onChange={(text) => {
          setValue(text);
          setError(undefined);
        }}
        onBlur={() => {
          const trimmed = value.trim();
          if (trimmed === '') setError(strings.nameRequired);
          else if (trimmed !== name) onRename(trimmed);
        }}
        {...(error === undefined ? {} : { error })}
      />
    </Card>
  );
}
