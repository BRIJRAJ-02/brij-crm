// Brief
// Purpose: one form (spec 0023): its builder and its submissions, its link, its status and its publish.
// Main task: shape the draft, preview it, publish it live, share its link, and read what comes in.
// Leaves out: analytics, embeds and sites, steps and routing (later milestones).
import {
  isDataError,
  type FormAttributeChoice,
  type FormDocument,
  type FormView,
  type MemberSummary,
  type ObjectSummary,
  type PublicForm,
  type SubmissionPage,
  type SubmissionState,
  type SubmissionView,
} from '@crm/data';
import { browserPattern, checkAnswers } from '@crm/data/public-form';
import {
  Badge,
  Button,
  Callout,
  CopyButton,
  Field,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  TabPanel,
  Tabs,
  type FormRefusal,
} from '@crm/ui';
import { useNavigate, useRouter, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { FormFields } from '../../public/FormFields.tsx';
import { formHref, formsHref, type FormTab } from '../settings/nav.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { strings as settings } from '../settings/strings.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { FormBuilder } from './FormBuilder.tsx';
import { strings } from './strings.ts';
import { SubmissionsTab } from './SubmissionsTab.tsx';

/** Props for a form's page: what its route loaded through the data layer. */
export interface FormScreenProps {
  readonly slug: string;
  readonly form: FormView;
  readonly attributes: readonly FormAttributeChoice[];
  readonly members: readonly MemberSummary[];
  readonly objects: readonly ObjectSummary[];
  readonly tab: FormTab;
  /** The Submissions tab's first page, for its state filter. */
  readonly submissions: SubmissionPage | undefined;
  readonly state: SubmissionState | undefined;
  readonly openSubmission: SubmissionView | undefined;
}

/** The server's words for a failure: every refusal's message, or the plain fallback. */
function problemsOf(error: unknown): readonly string[] {
  if (!isDataError(error)) return [strings.somethingWrong];
  const refusals = (error.data as { readonly refusals?: readonly { readonly message: string }[] } | undefined)
    ?.refusals;
  return refusals !== undefined && refusals.length > 0 ? refusals.map((refusal) => refusal.message) : [error.message];
}

/** A form's page: the settings frame, the link and actions, then Build and Submissions. */
export function FormScreen(props: FormScreenProps) {
  const { slug, form, tab } = props;
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const router = useRouter();
  const canManage = useCan('forms.manage');
  // The draft as edited here; the route remounts this screen whenever the form's revision moves.
  const [draft, setDraft] = useState<FormDocument>(form.draft);
  const [name, setName] = useState(form.name);
  const [busy, setBusy] = useState<'save' | 'publish' | 'status' | 'rotate' | undefined>(undefined);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<PublicForm | undefined>(undefined);
  const [isRotating, setRotating] = useState(false);
  const isDirty = name !== form.name || JSON.stringify(draft) !== JSON.stringify(form.draft);
  const link = data.forms.hostedUrl(form.publicKey);

  const failed = (error: unknown) => {
    setBusy(undefined);
    if (isDataError(error) && error.code === 'FORM_CHANGED') {
      toasts.toast({ tone: 'danger', message: strings.changedElsewhere });
      void router.invalidate();
      return;
    }
    setProblems(problemsOf(error));
  };

  /** Saves the draft when it changed; answers the revision to go on from. */
  const save = async (): Promise<number> => {
    if (!isDirty) return form.revision;
    const saved = await data.forms.saveDraft(slug, form.id, {
      document: draft,
      expectedRevision: form.revision,
      ...(name === form.name ? {} : { name }),
    });
    return saved.revision;
  };

  const onSave = () => {
    setBusy('save');
    setProblems([]);
    save().then(() => {
      setBusy(undefined);
      toasts.toast({ tone: 'success', message: strings.saved });
      void router.invalidate();
    }, failed);
  };

  const onPublish = () => {
    setBusy('publish');
    setProblems([]);
    save()
      .then((revision) => data.forms.publish(slug, form.id, revision))
      .then((published) => {
        setBusy(undefined);
        toasts.toast({ tone: 'success', message: strings.published(published.liveVersionNumber ?? 1) });
        void router.invalidate();
      }, failed);
  };

  const onStatus = (status: FormView['status']) => {
    setBusy('status');
    data.forms.setStatus(slug, form.id, status).then((moved) => {
      setBusy(undefined);
      toasts.toast({ tone: 'success', message: strings.statusChanged(strings.status[moved.status]) });
      void router.invalidate();
    }, failed);
  };

  const onRotate = () => {
    setBusy('rotate');
    data.forms.rotateKey(slug, form.id).then(() => {
      setBusy(undefined);
      setRotating(false);
      toasts.toast({ tone: 'success', message: strings.rotated });
      void router.invalidate();
    }, failed);
  };

  const onPreview = () => {
    // The preview draws the saved draft: save first, so what is shown is what would go live.
    setProblems([]);
    save()
      .then(() => data.forms.preview(slug, form.id))
      .then(setPreview, failed);
  };

  const isArchived = form.status === 'archived';
  const actions = (
    <>
      {isDirty && <Badge text={strings.unpublished} />}
      <Button icon="eye" onPress={onPreview}>
        {strings.preview}
      </Button>
      {canManage && !isArchived && (
        <>
          <Button onPress={onSave} isPending={busy === 'save'} isDisabled={!isDirty || busy !== undefined}>
            {busy === 'save' ? strings.saving : strings.saveDraft}
          </Button>
          <Button
            variant="primary"
            onPress={onPublish}
            isPending={busy === 'publish'}
            isDisabled={busy !== undefined || (!isDirty && !form.hasUnpublished)}
          >
            {busy === 'publish' ? strings.publishing : strings.publish}
          </Button>
        </>
      )}
      {canManage && (
        <MenuTrigger>
          <Button variant="ghost" icon="ellipsis" label={strings.moreActions} />
          <Menu
            label={strings.moreActions}
            onAction={(key) => {
              if (key === 'pause') onStatus('paused');
              if (key === 'resume') onStatus('live');
              if (key === 'archive') onStatus('archived');
              if (key === 'restore') onStatus('paused');
              if (key === 'rotate') setRotating(true);
            }}
          >
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
            <MenuItem id="rotate" icon="refresh-cw" isDisabled={isArchived}>
              {strings.rotateKey}
            </MenuItem>
            <MenuSeparator />
            {isArchived ? (
              <MenuItem id="restore" icon="archive-restore">
                {strings.restore}
              </MenuItem>
            ) : (
              <MenuItem id="archive" icon="archive" isDanger>
                {strings.archive}
              </MenuItem>
            )}
          </Menu>
        </MenuTrigger>
      )}
    </>
  );

  return (
    <SettingsPage
      title={form.name}
      crumbs={[
        { id: 'settings', label: settings.settings, href: `/w/${slug}/settings/objects` },
        { id: 'forms', label: strings.forms, href: formsHref(slug) },
      ]}
      meta={<Badge text={strings.status[form.status]} tone={form.status === 'live' ? 'accent' : 'neutral'} />}
      current="forms"
      actions={actions}
    >
      {problems.length > 0 && (
        <Callout tone="danger" isAnnounced>
          {problems.join(' ')}
        </Callout>
      )}
      <Field
        label={strings.link}
        hint={strings.linkHint}
        value={link}
        isReadOnly
        suffix={<CopyButton value={link} label={strings.copyLink} isIconOnly />}
      />
      <Tabs
        label={strings.tabsLabel}
        tabs={[
          { id: 'build', label: strings.build },
          { id: 'submissions', label: strings.submissions, count: form.submissionCount },
        ]}
        selectedKey={tab}
        onSelectionChange={(id) => {
          void navigate({ href: formHref(slug, form.id, id === 'submissions' ? 'submissions' : 'build') });
        }}
      >
        <TabPanel id="build">
          <Field label={strings.formName} value={name} onChange={setName} isReadOnly={!canManage} maxLength={200} />
          <FormBuilder
            draft={draft}
            onChange={setDraft}
            attributes={props.attributes}
            members={props.members}
            isReadOnly={!canManage || isArchived}
          />
        </TabPanel>
        <TabPanel id="submissions">
          {props.submissions !== undefined && (
            <SubmissionsTab
              slug={slug}
              formId={form.id}
              objects={props.objects}
              page={props.submissions}
              state={props.state}
              open={props.openSubmission}
              canManage={canManage}
            />
          )}
        </TabPanel>
      </Tabs>
      {preview !== undefined && <PreviewDialog form={preview} onClose={() => setPreview(undefined)} />}
      <Modal
        title={strings.rotateTitle}
        tone="danger"
        isOpen={isRotating}
        onOpenChange={setRotating}
        actions={
          <>
            <Button slot="close" isDisabled={busy === 'rotate'}>
              {strings.cancel}
            </Button>
            <Button variant="danger-solid" isPending={busy === 'rotate'} onPress={onRotate}>
              {strings.rotateConfirm}
            </Button>
          </>
        }
      >
        <p>{strings.rotateText}</p>
      </Modal>
    </SettingsPage>
  );
}

/** The draft as visitors see it (AC-550), drawn by the hosted page's own fields; Submit checks and sends nothing. */
function PreviewDialog({ form, onClose }: { readonly form: PublicForm; readonly onClose: () => void }) {
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  return (
    <Modal
      title={strings.previewTitle(form.title)}
      variant="window"
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={<Button slot="close">{strings.closePreview}</Button>}
    >
      <Callout>{strings.previewNote}</Callout>
      {form.description !== undefined && <p>{form.description}</p>}
      <FormFields
        form={form}
        isBusy={false}
        refusals={refusals}
        fieldErrors={fieldErrors}
        onAnswered={(questionId) => {
          if (fieldErrors[questionId] !== undefined) {
            setFieldErrors(({ [questionId]: _dropped, ...rest }) => rest);
          }
        }}
        onSubmit={(answers) => {
          const checked = checkAnswers(form, answers, { pattern: browserPattern });
          if (checked.ok) {
            setFieldErrors({});
            setRefusals([{ code: 'PREVIEW', message: strings.previewChecked }]);
          } else {
            setRefusals([]);
            setFieldErrors(checked.fields);
          }
        }}
      />
    </Modal>
  );
}
