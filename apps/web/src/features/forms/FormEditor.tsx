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
  Field,
  FormEditorLayout,
  FormEditorStatus,
  HostedFormPreview,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  Popover,
  Select,
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
import { SettingsTab } from './SettingsTab.tsx';
import { strings } from './strings.ts';
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
  const [renaming, setRenaming] = useState<string | undefined>(undefined);
  const renameRef = useRef<HTMLButtonElement>(null);

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
          apply(view);
          toasts.toast({ tone: 'success', message: strings.published(view.liveVersionNumber ?? 1) });
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

  const rename = (name: string) => {
    setRenaming(undefined);
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === form.name) return;
    data.forms.updateSettings(slug, form.id, { name: trimmed }).then((view) => {
      setForm((before) => ({ ...before, name: view.name, revision: before.revision }));
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
      {...(canManage
        ? {
            meta: (
              <>
                <Button
                  ref={renameRef}
                  variant="ghost"
                  icon="pencil"
                  label={strings.rename}
                  onPress={() => {
                    setRenaming(form.name);
                  }}
                />
                <Popover
                  triggerRef={renameRef}
                  isOpen={renaming !== undefined}
                  onOpenChange={(isOpen) => {
                    if (!isOpen) setRenaming(undefined);
                  }}
                  label={strings.rename}
                >
                  <Field
                    label={strings.renameLabel}
                    value={renaming ?? ''}
                    maxLength={80}
                    // The popover opens to rename: its one field is what the press asked for.
                    // eslint-disable-next-line jsx-a11y-x/no-autofocus
                    autoFocus
                    onChange={setRenaming}
                    onSubmit={() => {
                      rename(renaming ?? '');
                    }}
                  />
                </Popover>
                <FormEditorStatus tone={status.tone} text={status.text} />
              </>
            ),
          }
        : { meta: <FormEditorStatus tone={status.tone} text={status.text} /> })}
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
      {canManage && (
        <Button
          variant="primary"
          onPress={publish}
          isPending={isPublishing}
          isDisabled={isPublished && !isChanged && !form.hasUnpublished}
        >
          {isPublishing ? strings.publishing : strings.publish}
        </Button>
      )}
      {canManage && (
        <MenuTrigger>
          <Button variant="ghost" icon="ellipsis" label={strings.moreActions} />
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
            members={members}
            isReadOnly={!canManage}
            onDraftChange={setDraft}
            onFormChange={(view) => {
              setForm((before) => ({ ...view, revision: before.revision }));
            }}
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
          />
        );
      default:
        return (
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
        );
    }
  })();

  return (
    <WorkspacePage
      currentPage="captures"
      page={{
        topBar,
        body: (
          <FormEditorLayout
            notices={notices}
            {...(isPublished
              ? {
                  tabs: (
                    <Tabs
                      label={strings.tabs}
                      selectedKey={current}
                      onSelectionChange={(value) => {
                        if ((FORM_TABS as readonly string[]).includes(value)) goTab(value as FormTab);
                      }}
                      tabs={[
                        { id: 'form', label: strings.tabForm },
                        { id: 'settings', label: strings.tabSettings },
                        { id: 'install', label: strings.tabInstall },
                        { id: 'submissions', label: strings.tabSubmissions },
                      ]}
                    />
                  ),
                }
              : {})}
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
          </FormEditorLayout>
        ),
      }}
    />
  );
}
