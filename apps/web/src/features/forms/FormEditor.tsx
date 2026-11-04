// Brief
// Purpose: one form's editor (spec 0023, 0023-experience.md, Builder): its questions beside a live preview, and Settings (what happens after sending, routing, the owner) from the start; Install and Submissions once published.
// Main task: shape the draft (saved quietly as you go), publish it in one click, and share it.
// Leaves out: round robin (#58), booking (#59), analytics. Jumps, endings, points and the Flow view arrived with spec 0063 slice 5: the jumps on a step divider (Form tab), the endings and the score's filing in Settings.
import {
  isDataError,
  type BrandStore,
  type FormDocument,
  type FormTargetChoices,
  type FormView,
  type LiveSettingsChange,
  type MemberSummary,
  type ObjectSummary,
  type SubmissionPage,
  type SubmissionState,
  type SubmissionView,
} from '@crm/data';
import {
  FORM_ENDINGS_MAX,
  FORM_QUESTIONS_MAX,
  pathOf,
  previewOf,
  publishProblem,
  type PublishProblem,
} from '@crm/data/forms';
import { useCaptureList } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  Callout,
  Badge,
  EditorStatus,
  EmptyState,
  Field,
  focusLater,
  HostedFormPreview,
  PreviewLayout,
  Select,
  type PreviewTextChange,
  TabPanel,
  Tabs,
  TopBar,
} from '@crm/ui';
import { useNavigate, useRouteContext, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { DeleteFormDialog, DiscardChangesDialog, RetargetFormDialog, type RetargetAsk } from './FormConfirms.tsx';
import { retargetStep } from './retarget.ts';
import { EditorActions } from '../captures/EditorActions.tsx';
import { strings as capturesStrings } from '../captures/strings.ts';
import {
  changeQuestion,
  draftGap,
  fileByLabel,
  isMatchQuestion,
  planNewAttributes,
  publishAttributesOf,
  firstPublish,
  canDiscard,
  sameDocument,
  savableDraft,
  statusOf,
  withFlow,
  mintEndingId,
  withQuestions,
  uploadsOffFor,
} from './draft.ts';
import { BrandedFormPreview, BrandThemeSelect, BrandThemeSelectWithKit } from './FormBrand.tsx';
import { FlowView } from './FlowView.tsx';
import { LayoutCard } from './LayoutCard.tsx';
import { AnalyticsTab, FORM_CHIP_RANGE, useQuestionStats } from './AnalyticsTab.tsx';
import { ShareTab } from './ShareTab.tsx';
import { formHref, formPreviewHref, formsHref, FORM_TABS, type FormTab } from './paths.ts';
import { ReadyDialog, type LiveFiling } from './PublishDialog.tsx';
import { AFTER_ROW, AfterSendSection } from './AfterSendSection.tsx';
import { QuestionsSection } from '../questions/QuestionsSection.tsx';
import { splitIntoSteps } from '../questions/steps.ts';
import { archiveMadeAttributes, createPlannedAttributes } from '../questions/attributes.ts';
import { afterPageProblem } from './after-page.ts';
import { emailToMakeUnique, readyMatch } from './match.ts';
import { objectSettingsHref } from '../settings/nav.ts';
import { firstRefusal, saveFailureMessage } from './refusals.ts';
import { SettingsTab, useFormSettings } from './SettingsTab.tsx';
import { useJobFollower } from './followJobs.ts';
import { strings } from './strings.ts';
import { strings as questionStrings } from '../questions/strings.ts';
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
  /** How many months the workspace keeps answers; null keeps them; absent when it couldn't be read (critique b S2). */
  readonly keepMonths?: number | null;
  /** Why the Submissions tab's page didn't load (forms fix a6): said in the tab, with Try again, the form still here. */
  readonly submissionsFailed?: string;
  readonly state: SubmissionState | undefined;
  readonly openSubmission: SubmissionView | undefined;
  /** On the Form tab, the question to open and bring into view. */
  readonly question?: string;
  /**
   * The brand store (spec 0063, AC-6327), loaded with the route: the kit the preview wears while the look is
   * Brand, and what Colours says of an empty one. Undefined when its chunk or its read failed, which costs the
   * preview its accent and the picker its hint, and nothing else.
   */
  readonly brand?: BrandStore;
}

/** A document's mapping, as one comparable string: the target, its match, and where each question files. */
function filingOf(document: FormDocument | undefined): string {
  if (document === undefined) return '';
  // Only the filed questions, by id: reordering, or an unfiled question coming or going, changes nothing filed.
  return JSON.stringify([
    document.targets.main,
    document.questions
      .flatMap((question) => (question.filedOn === undefined ? [] : [[question.id, question.filedOn.attributeId]]))
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  ]);
}

/** The Steps header that stands for the first page while it has no break of its own (`QuestionsSection`). */
const LEAD_STEP = '~lead';

/** How long after the last change the draft saves. */
const SAVE_AFTER_MS = 1_000;

/** The editor: the TopBar (name, Preview, Publish, menu), then the status line, tabs and the tab. */
export function FormEditor(props: FormEditorProps) {
  const { slug, members, objects, tab } = props;
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const router = useRouter();
  const canManage = useCan('forms.manage') && props.form.canManage;
  const canBuild = useCan('schema.manage');

  const [form, setForm] = useState(props.form);
  const [target, setTarget] = useState(props.target);
  const [draft, setDraft] = useState<FormDocument>(props.form.draft);
  const [conflict, setConflict] = useState(false);
  // A refused publish: the check's problem, or the server's (kept with the draft it refused).
  const [problem, setProblem] = useState<(PublishProblem & { readonly atDraft?: FormDocument }) | undefined>(undefined);
  const [isPublishing, setPublishing] = useState(false);
  // The form the first publish just put live: the Ready dialog shows its link (one click, no fields first).
  const [justLive, setJustLive] = useState<FormView | undefined>(undefined);
  // What the first publish set up in the CRM, said once in the live dialog rather than in a toast (5 November 2026).
  const [liveFiling, setLiveFiling] = useState<LiveFiling | undefined>(undefined);
  // Discard changes asks first: it loses every edit since the last publish.
  const [isDiscarding, setDiscarding] = useState(false);
  // Delete asks first; Pause and Resume act at once with Undo (the owner, 22 October 2026).
  const [isDeleting, setDeleting] = useState(false);
  // Publish leaves once there is nothing more to publish; focus then moves to the menu beside it.
  const moreRef = useRef<HTMLButtonElement>(null);
  // After a publish that changed where answers go: offer to file the submissions before it the same way.
  const [syncOffer, setSyncOffer] = useState<'published' | 'connected' | 'menu' | undefined>(undefined);
  const [isRetargeting, setRetargeting] = useState(false);
  // A blocked Publish shows every incomplete Settings field's message at once, wherever it was pressed from.
  const [showGaps, setShowGaps] = useState(false);
  const heldJobs = useMemo(
    () => ({ get: (jobId: string) => data.jobs.get(slug, jobId), follow: data.jobs.follow }),
    [data, slug],
  );
  const jobs = useJobFollower(data.jobs.view(slug, 'mine'), heldJobs);
  // The end of the tab strip, where a tab draws its own tools (Submissions' filter and search).
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  // The Flow view (spec 0063, AC-6325): the steps, their jumps and the endings, read only, from the Form tab.
  const [isFlowOpen, setFlowOpen] = useState(false);
  // The name, link, owner and who is emailed: each saves on its own on the Settings tab, with no Save.
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
  // The last failed save's toast, so a run of failures for one reason says it once.
  const lastFailure = useRef<string | undefined>(undefined);

  /** Saves the draft when it differs from the server's; answers the revision to go on from. */
  const flush = async (): Promise<number> => {
    if (inFlight.current !== undefined) await inFlight.current.catch(() => undefined);
    // A field still being typed (a partial web address) keeps the server's value, so the rest still saves.
    const document = savableDraft(latest.current, saved.current.document);
    if (sameDocument(document, saved.current.document)) return saved.current.revision;
    const sending = data.forms.saveDraft(slug, form.id, document, saved.current.revision).then((view) => {
      saved.current = { document, revision: view.revision };
      lastFailure.current = undefined;
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
        const message = saveFailureMessage(error);
        if (lastFailure.current !== message) toasts.toast({ tone: 'danger', message });
        lastFailure.current = message;
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
      ...(target.deal === undefined ? {} : { dealAttributes: publishAttributesOf(target.deal) }),
    });
    return still?.code === problem.code &&
      still.questionId === problem.questionId &&
      still.stepId === problem.stepId &&
      still.endingId === problem.endingId
      ? problem
      : undefined;
  }, [draft, problem, form.name, form.publicKey, target]);

  const apply = (view: FormView) => {
    setForm(view);
    saved.current = { document: view.draft, revision: view.revision };
  };

  /**
   * A setting Settings changes that the version holds (forms fixes 2, one save model): shown at once, then live at
   * once on the server, edits waiting on the Form tab left waiting. The saved copy takes the change too, so the
   * draft's own save never sends it as an edit.
   */
  const applySettings = (settings: LiveSettingsChange, change: (before: FormDocument) => FormDocument) => {
    const shownBefore = latest.current;
    const savedBefore = saved.current;
    const next = change(latest.current);
    setDraft(next);
    latest.current = next;
    saved.current = { ...saved.current, document: change(saved.current.document) };
    // One after another, as the draft's saves are: each goes on from the revision the one before answered, so two
    // quick changes never read as someone else's (the review's false conflict).
    const sending = flush().then(async (revision) => {
      const view = await data.forms.applySettings(slug, form.id, settings, revision);
      apply(view);
      // Words typed while it was out stay: the server's draft replaces the shown one only when nothing changed since.
      if (latest.current === next) {
        setDraft(view.draft);
        latest.current = view.draft;
      }
      return view.revision;
    });
    inFlight.current = sending;
    sending
      .catch((error: unknown) => {
        if (isDataError(error) && error.code === 'FORM_CHANGED') {
          setConflict(true);
          return;
        }
        saved.current = savedBefore;
        setDraft(shownBefore);
        latest.current = shownBefore;
        toasts.toast({ tone: 'danger', message: firstRefusal(error).message });
        loadTheirs();
      })
      .finally(() => {
        if (inFlight.current === sending) inFlight.current = undefined;
      });
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
  const viewOnly = !canManage && isPublished;

  // The question cards' reached and answered chips (spec 0063, AC-6322), so a weak question is visible where it is
  // edited. Only a published form has any, and the read is the Analytics tab's own 30 day one, so opening that tab
  // reuses what this already holds rather than asking again.
  const analyticsView = useMemo(
    () => (isPublished ? data.forms.analytics(slug, form.id, FORM_CHIP_RANGE) : undefined),
    [isPublished, data, slug, form.id],
  );
  const questionStats = useQuestionStats(analyticsView);
  const isChanged = isPublished && !sameDocument(draft, form.live);
  const status = statusOf(form, isChanged);
  const liveIds = useMemo(() => new Set(form.live?.questions.map((question) => question.id) ?? []), [form.live]);
  const preview = useMemo(() => previewOf(draft, { key: form.publicKey }), [draft, form.publicKey]);
  // The question or divider last opened: Steps and One at a time preview the step it is in (spec 0063).
  const [previewRow, setPreviewRow] = useState<string | undefined>(undefined);
  // The edited question's or divider's step, shown even when its Show when hides it from a visitor who has answered
  // nothing yet: its conditions (the step's, and its questions') are lifted in the preview only.
  const shownPreview = useMemo(() => {
    if (previewRow === undefined || preview.layout === undefined) return { form: preview, step: undefined };
    const stepId = previewRow.startsWith('step:') ? previewRow.slice('step:'.length) : undefined;
    const key = draft.questions.find((question) => question.id === previewRow)?.key;
    const steps = preview.steps ?? [];
    const target =
      preview.layout === 'steps'
        ? stepId === LEAD_STEP
          ? steps[0]
          : steps.find((step) =>
              stepId === undefined ? key !== undefined && step.keys.includes(key) : step.id === stepId,
            )
        : undefined;
    const lifted = new Set(target?.keys ?? (key === undefined ? [] : [key]));
    const form = {
      ...preview,
      questions: preview.questions.map((question) => {
        if (!lifted.has(question.key)) return question;
        const { showWhen: _lifted, ...rest } = question;
        return rest;
      }),
      ...(preview.steps === undefined
        ? {}
        : {
            steps: preview.steps.map((step) => {
              if (step !== target) return step;
              const { showWhen: _lifted, ...rest } = step;
              return rest;
            }),
          }),
    };
    const path = pathOf(form, {}).steps;
    const at = path.findIndex((step) =>
      target !== undefined
        ? step.keys.some((each) => target.keys.includes(each))
        : key !== undefined && step.keys.includes(key),
    );
    return { form, step: at === -1 ? undefined : at };
  }, [previewRow, preview, draft.questions]);

  // Gives each unfiled, labelled question an attribute on the target object, with no prompt: files the question
  // onto it, and offers Undo (unfile, archive). Answers the draft to publish; a failure leaves the question unfiled.
  const createMissingAttributes = async (
    draft: FormDocument,
  ): Promise<{
    readonly document: FormDocument;
    readonly choices: FormTargetChoices;
  }> => {
    const objectId = target.objectId;
    const plans = planNewAttributes(draft, target.items, canBuild && canManage && objectId !== undefined);
    if (objectId === undefined || plans.length === 0) {
      if (draft !== latest.current) {
        setDraft(draft);
        latest.current = draft;
      }
      return { document: draft, choices: target };
    }
    const made = await createPlannedAttributes(data, slug, objectId, plans);
    // A field that couldn't be made leaves its question unfiled: said, never published quietly (late trap #37).
    const missed = plans.filter((plan) => !made.some((each) => each.questionId === plan.questionId));
    if (missed.length > 0) {
      toasts.toast({
        tone: 'danger',
        message: questionStrings.notCreated(
          missed.map((plan) => plan.title),
          target.objectName ?? '',
          'submission',
        ),
      });
    }
    if (made.length === 0) return { document: draft, choices: target };
    const next = made.reduce(
      (document, each) => changeQuestion(document, each.questionId, { filedOn: each.attributeId }),
      draft,
    );
    setDraft(next);
    latest.current = next;
    const choices = await data.forms.attributes(slug, form.id);
    setTarget(choices);
    // The first publish says it in its live dialog, with Change; a later one in a toast with Undo.
    if (!isPublished) {
      setLiveFiling({
        objectName: target.objectName ?? '',
        made: made.flatMap((each) => plans.find((plan) => plan.questionId === each.questionId)?.title ?? []),
      });
      return { document: next, choices };
    }
    toasts.toast({
      tone: 'success',
      message: strings.createdAttributes(made.length, target.objectName ?? ''),
      action: {
        label: strings.undo,
        onAction: () => {
          setDraft((before) =>
            // Undo says the field wasn't wanted: kept off the CRM, so the next Save doesn't make it again.
            made.reduce(
              (document, each) => changeQuestion(document, each.questionId, { filedOn: null, kept: true }),
              before,
            ),
          );
          archiveMadeAttributes(data, slug, made).then(
            () => data.forms.attributes(slug, form.id).then(setTarget, failed),
            failed,
          );
        },
      },
    });
    return { document: next, choices };
  };

  const publish = () => {
    setProblem(undefined);
    // A Settings field still being typed never goes live half done: Settings shows what it needs beside the field.
    const gap = draftGap(draft);
    if (gap !== undefined) {
      toasts.toast({
        tone: 'danger',
        message:
          gap === 'redirect'
            ? strings.publishGap(strings.redirectIncomplete)
            : gap === 'route'
              ? strings.routeIncomplete
              : strings.publishGapButton(strings.buttonTextMissing),
      });
      setShowGaps(true);
      // Everything a visitor meets is on the Form tab now (T20, T21): After they send, and the preview's words.
      void navigate({ href: `${formHref(slug, form.id)}?question=${AFTER_ROW}` });
      return;
    }
    // The first publish is one click (the owner, 5 November 2026, after Tally): each answer meets a field with its
    // label first (`fileByLabel`, what the old dialog prefilled), then questions with no field to save to get one,
    // with no prompt; then the email the form matches on is made ready (`readyMatch`); the check and publish read
    // both. Where answers go is changed later in Settings › CRM.
    // An email field the object already had becomes unique on the way (late trap #36): it changes how imports and
    // every other form match there too, so it is never done unsaid: a toast says so as soon as it is done, whatever
    // the publish then does. One made just now for this form needs no word.
    const start = isPublished ? draft : firstPublish(draft, form, target.items).document;
    const mayMakeUnique = canBuild && canManage;
    const making = mayMakeUnique ? emailToMakeUnique(start, target) : undefined;
    const uniqueTitle = target.items.find((item) => item.attributeId === making)?.title;
    setPublishing(true);
    createMissingAttributes(start)
      .then(({ document, choices }) =>
        readyMatch({ data, slug, formId: form.id, canChangeAttributes: mayMakeUnique, flush }, document, choices),
      )
      .then((ready) => {
        setPublishing(false);
        if ('refused' in ready) {
          toasts.toast({ tone: 'danger', message: ready.refused });
          return;
        }
        const object = objects.find((each) => each.id === ready.choices.objectId);
        if (uniqueTitle !== undefined && ready.choices.objectName !== undefined && object !== undefined) {
          toasts.toast({
            tone: 'info',
            message: strings.madeUnique(uniqueTitle, ready.choices.objectName),
            action: {
              label: strings.viewField,
              onAction: () => void navigate({ href: objectSettingsHref(slug, object) }),
            },
          });
        }
        if (ready.view !== undefined) {
          apply(ready.view);
          setDraft(ready.document);
          latest.current = ready.document;
          setTarget(ready.choices);
        }
        publishChecked(ready.document, ready.choices);
      }, failed);
  };

  /**
   * The first publish's name and link, with nothing asked: the form's own name, and a link made from it when that is
   * free, else the form's own key (which is always its own).
   */
  const firstAddress = async (): Promise<{ readonly name: string; readonly slug: string }> => {
    const { name, address } = firstPublish(draft, form, target.items);
    if (address === form.publicKey) return { name, slug: form.publicKey };
    const isFree = await data.forms.slugAvailable(slug, form.id, address).catch(() => false);
    return { name, slug: isFree ? address : form.publicKey };
  };

  /** Publishes the saved draft; the first time with its name and link, its own key if the link was just taken. */
  const goLive = async (): Promise<FormView> => {
    const first = isPublished ? undefined : await firstAddress();
    const revision = await flush();
    if (first === undefined) return data.forms.publish(slug, form.id, { expectedRevision: revision });
    try {
      return await data.forms.publish(slug, form.id, { expectedRevision: revision, ...first });
    } catch (error) {
      const isTaken = isDataError(error) && error.code === 'SLUG_TAKEN';
      if (!isTaken || first.slug === form.publicKey) throw error;
      return data.forms.publish(slug, form.id, { expectedRevision: revision, name: first.name, slug: form.publicKey });
    }
  };

  const publishChecked = (draft: FormDocument, target: FormTargetChoices) => {
    const found = publishProblem({
      name: form.name,
      slug: form.publicKey,
      document: draft,
      attributes: publishAttributesOf(target),
      ...(target.deal === undefined ? {} : { dealAttributes: publishAttributesOf(target.deal) }),
      ...(target.objectName === undefined ? {} : { objectName: target.objectName }),
      canChangeAttributes: canBuild && canManage,
    });
    if (found !== undefined) {
      setProblem(found);
      // Each refusal opens where it is fixed (spec 0063, AC-6326): everything a visitor meets, the endings and the
      // score included, is on the Form tab now (T20).
      if (tab !== 'form') void navigate({ href: formHref(slug, form.id) });
      return;
    }
    const wasPublished = isPublished;
    setPublishing(true);
    goLive().then(
      (view) => {
        setPublishing(false);
        const filingChanged = form.live !== undefined && filingOf(form.live) !== filingOf(view.live);
        const wasKeptOnly = form.live?.targets.main === undefined;
        apply(view);
        setDraft(view.draft);
        latest.current = view.draft;
        // The first time, the Ready dialog says it is live and hands over the link.
        if (!wasPublished) {
          if (target.objectName !== undefined && view.live?.targets.main !== undefined) {
            const objectName = target.objectName;
            setLiveFiling((before) => before ?? { objectName, made: [] });
          } else setLiveFiling(undefined);
          setJustLive(view);
          return;
        }
        toasts.toast(
          view.live !== undefined && uploadsOffFor(target, view.live)
            ? { tone: 'info', message: strings.publishedUploadsOff }
            : { tone: 'success', message: strings.published },
        );
        // Where answers are saved changed, and the form saves now: offer to save the earlier submissions the same way.
        if (filingChanged && view.live?.targets.main !== undefined && view.submissionCount > 0) {
          setSyncOffer(wasKeptOnly ? 'connected' : 'published');
        } else focusLater(() => moreRef.current);
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

  /**
   * Discard changes (the ⋯ menu, after a confirm): the draft goes back to the live form and is saved, which the server
   * reads as the live version again, so the status is Live and Publish goes. A field still being typed goes with it.
   * A draft the server holds apart from live with the same words (edits undone by hand) is saved back all the same,
   * so Discard never says it worked while nothing changed. A refused save puts the edits back on screen: the confirm
   * says why, and Cancel then really keeps them.
   */
  const discard = async (): Promise<void> => {
    const live = form.live;
    if (live === undefined) return;
    if (inFlight.current !== undefined) await inFlight.current.catch(() => undefined);
    const before = latest.current;
    setDraft(live);
    latest.current = live;
    try {
      if (sameDocument(live, saved.current.document)) {
        const view = await data.forms.saveDraft(slug, form.id, live, saved.current.revision);
        saved.current = { document: live, revision: view.revision };
        setForm(view);
      } else await flush();
    } catch (error) {
      setDraft(before);
      latest.current = before;
      throw error;
    }
    setProblem(undefined);
    setShowGaps(false);
  };

  // Settings' Add each submission to the CRM: the draft points at an object (its starting questions filed by the
  // server, the rest by label) or at none. Saved first, so the change names the revision it starts from.
  // Asked first when questions are saved onto the object now: the change clears where every one of them is saved,
  // and nothing takes it back. With nothing saved anywhere it stays one click.
  const [retargetAsk, setRetargetAsk] = useState<RetargetAsk | undefined>(undefined);
  const askRetarget = (objectId: string | null, withDeal?: boolean) => {
    if (isRetargeting) return;
    // Moving a Deals form to People with a deal keeps every answer where it was saved (on the deal), so it asks nothing.
    if (withDeal === true) {
      retarget(objectId, false, true);
      return;
    }
    const step = retargetStep(draft, objects, objectId, strings.thisObject);
    if (step.kind === 'go') retarget(objectId);
    else if (step.kind === 'ask') setRetargetAsk(step.ask);
  };

  const retarget = (objectId: string | null, isUndo = false, withDeal = false) => {
    if (isRetargeting) return;
    setRetargeting(true);
    const settled = () => {
      setRetargeting(false);
    };
    // Where it saved before, for Undo (forms fix a2): the server remembered the mapping, so going back restores it.
    const before = draft.targets.main?.objectId ?? null;
    // One save model (forms fixes 2): a live form with nothing else waiting takes the change live at once, as every
    // other setting does; with edits waiting on the Form tab, it goes live with them on Publish.
    const goesLiveNow = isPublished && !form.hasUnpublished && sameDocument(latest.current, saved.current.document);
    flush()
      .then((revision) => data.forms.setTarget(slug, form.id, objectId, revision, withDeal || undefined))
      .then(async (moved) => {
        const choices = await data.forms.attributes(slug, form.id);
        const filed = objectId === null ? moved.draft : fileByLabel(moved.draft, choices.items);
        const view = !goesLiveNow
          ? moved
          : await (
              sameDocument(filed, moved.draft)
                ? Promise.resolve(moved.revision)
                : data.forms.saveDraft(slug, form.id, filed, moved.revision).then((saved) => saved.revision)
            )
              .then((revision) => data.forms.publish(slug, form.id, { expectedRevision: revision }))
              .catch((error: unknown) => {
                // Refused live (a field the object insists on): it waits in the draft, and the refusal says why.
                toasts.toast({ tone: 'danger', message: firstRefusal(error).message });
                return data.forms.get(slug, form.id);
              });
        apply(view);
        const next = objectId === null ? view.draft : fileByLabel(view.draft, choices.items);
        setDraft(next);
        latest.current = next;
        setTarget(choices);
        settled();
        if (isUndo) return;
        const toName = objects.find((object) => object.id === objectId)?.pluralName ?? strings.thisObject;
        toasts.toast({
          tone: 'success',
          // With edits waiting on the Form tab, the change waits with them: the toast says so (review).
          message:
            isPublished && !goesLiveNow
              ? objectId === null
                ? strings.savingOffToast
                : strings.savingChangedToast(toName)
              : objectId === null
                ? strings.retargetOffDone
                : withDeal
                  ? strings.retargetDealDone
                  : strings.retargetDone(toName),
          action: {
            label: strings.undo,
            onAction: () => {
              retarget(before, true);
            },
          },
        });
      })
      .catch((error: unknown) => {
        settled();
        if (isDataError(error) && error.code === 'FORM_CHANGED') {
          setConflict(true);
          return;
        }
        toasts.toast({ tone: 'danger', message: `${strings.retargetFailed} ${firstRefusal(error).message}` });
      });
  };

  // Pause and Resume act at once, as a booking page's do, and their toast offers Undo (the owner, 22 Oct 2026).
  const setStatus = (next: 'live' | 'paused') => {
    data.forms.setStatus(slug, form.id, next).then((view) => {
      apply(view);
      toasts.toast({
        tone: 'success',
        message: next === 'live' ? capturesStrings.resumedToast(view.name) : capturesStrings.pausedToast(view.name),
        action: { label: capturesStrings.undo, onAction: () => setStatus(next === 'live' ? 'paused' : 'live') },
      });
    }, failed);
  };

  // The headline, the line under it and the button, typed on the preview itself (T21: the Text card went). The
  // preview shows the draft as a visitor gets it, so an empty headline shows the default until words are typed.
  const changeText = (change: PreviewTextChange) => {
    setDraft((before) => ({ ...before, ...change }));
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
      // A member who may only view a live form sees its answers, and says so in the bar (forms fix a10).
      meta={
        viewOnly ? <Badge text={strings.viewOnly} isWhole /> : <EditorStatus tone={status.tone} text={status.text} />
      }
    >
      <EditorActions
        // A draft has no link yet: Copy link shows from the first publish, as the forms list shows it.
        {...(isPublished ? { link: data.forms.hostedUrl(form.publicKey) } : {})}
        // No Insights here (T22): the Analytics tab is the form's one door to how it does.
        preview={
          <Button
            icon="eye"
            // On a phone the words go, so the form's name keeps its room in the header.
            label={strings.previewOpen}
            isLabelCollapsible
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
        }
        // Forms keep a draft: Publish, the page's one primary, shows while there is something to publish.
        {...(canManage && (!isPublished || isChanged || form.hasUnpublished)
          ? {
              publish: (
                <Button variant="primary" onPress={publish} isPending={isPublishing}>
                  {isPublishing ? strings.publishing : strings.publish}
                </Button>
              ),
            }
          : {})}
        {...(canManage
          ? {
              menu: {
                ...(isPublished ? { status: form.status === 'paused' ? ('paused' as const) : ('live' as const) } : {}),
                onPause: () => setStatus('paused'),
                onResume: () => setStatus('live'),
                onDuplicate: () => {
                  data.forms.duplicate(slug, form.id).then((copy) => {
                    toasts.toast({ tone: 'success', message: strings.duplicated(copy.name) });
                    void navigate({ href: formHref(slug, copy.id) });
                  }, failed);
                },
                onDelete: () => setDeleting(true),
                deleteLabel: strings.deleteForm,
                triggerRef: moreRef,
                extra: [
                  // Back to what is live, once there is something unpublished to lose (it asks first).
                  ...(canDiscard(form, isChanged)
                    ? [
                        {
                          id: 'discard',
                          label: strings.discardChanges,
                          icon: 'undo-2' as const,
                          isDanger: true,
                          onAction: () => setDiscarding(true),
                        },
                      ]
                    : []),
                  // Earlier submissions saved again the way the form saves now: once it saves to the CRM and has some.
                  ...(form.live?.targets.main !== undefined && form.submissionCount > 0
                    ? [
                        {
                          id: 'sync',
                          label: strings.syncOld,
                          icon: 'refresh-cw' as const,
                          description: strings.syncOldText,
                          onAction: () => setSyncOffer('menu'),
                        },
                      ]
                    : []),
                ],
              },
            }
          : {})}
      />
    </TopBar>
  );

  // Before the first publish, Form and Settings: what happens after sending, routing and the owner are set before
  // anyone fills it in (late trap #47); Install and Submissions wait for a live form.
  // A member who may only view a live form gets its Submissions and Analytics, not a locked builder (forms fix a10).
  const current: FormTab = viewOnly
    ? tab === 'analytics'
      ? 'analytics'
      : 'submissions'
    : isPublished || tab === 'settings'
      ? tab
      : 'form';
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
      {/* On every tab but Settings, which says it beside the choice: visitors quietly get the message (late trap #53). */}
      {current !== 'settings' && form.live?.after.kind === 'booking' && (
        <AfterPageNotice slug={slug} formId={form.id} live={form.live} />
      )}
      {/* A form asking for a file where visitors can't upload one (forms fixes 2): said before it goes live. */}
      {current === 'form' && canManage && uploadsOffFor(target, draft) && (
        <Callout tone="warning" title={strings.uploadsOffTitle}>
          {strings.uploadsOffText}
        </Callout>
      )}
      {!canManage && !viewOnly && (
        <Callout tone="info" title={strings.readOnlyTitle}>
          {strings.readOnlyText}
        </Callout>
      )}
      <RetargetFormDialog
        ask={retargetAsk}
        onClose={() => {
          setRetargetAsk(undefined);
        }}
        onConfirm={(objectId) => {
          retarget(objectId);
          // The Switch or Select that opened it is disabled while the change runs, so the dialog's own return of
          // focus would land on the page: it goes to the page's More as it closes, as the other ends here do.
          focusLater(() => moreRef.current);
        }}
      />
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

  const body = (() => {
    switch (current) {
      case 'settings':
        return (
          <SettingsTab
            slug={slug}
            form={form}
            draft={draft}
            target={target}
            objects={objects}
            members={members}
            isReadOnly={!canManage}
            settings={settings}
            onRetarget={askRetarget}
            isRetargeting={isRetargeting}
            onStatusChange={setStatus}
            onSettingsChange={applySettings}
            {...(props.keepMonths === undefined ? {} : { keepMonths: props.keepMonths })}
          />
        );
      case 'share':
        return <ShareTab slug={slug} form={form} isReadOnly={!canManage} onFormChange={setForm} />;
      case 'analytics':
        // Only a live form has analytics, and the tab is offered only once it is published (see the tab list).
        return <AnalyticsTab data={data} slug={slug} form={form} />;
      case 'submissions':
        if (props.submissionsFailed !== undefined) {
          return (
            <EmptyState
              tone="error"
              title={strings.submissionsFailedTitle}
              onRetry={() => {
                void router.invalidate();
              }}
            >
              {props.submissionsFailed}
            </EmptyState>
          );
        }
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
            formName={form.name}
            followJob={jobs.follow}
            isFiling={form.live?.targets.main !== undefined}
            hasSubmissions={form.submissionCount > 0}
            // Spam is for those who manage forms: a member's count would name rows they can't open.
            spamCount={canManage ? form.spamCount : 0}
          />
        );
      default:
        return (
          <>
            {/* Before the first publish the name is changed here too, as a field, beside the questions. */}
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
            <LayoutCard
              layout={draft.layout}
              isReadOnly={!canManage}
              onChange={(layout) => {
                // Steps splits the form into pages at once (T20, Tally's page breaks): a header on every page, after
                // the contact details or in the middle, breaks it already has kept.
                setDraft((before) =>
                  layout === 'steps'
                    ? withFlow(
                        { ...before, layout },
                        splitIntoSteps({ questions: before.questions, steps: before.steps }, () => data.forms.newId(), {
                          details: questionStrings.yourDetails,
                          rest: questionStrings.aboutYou,
                        }),
                      )
                    : { ...before, layout },
                );
              }}
            />
            <FlowView
              draft={draft}
              isOpen={isFlowOpen}
              questionHref={(questionId) => `${formHref(slug, form.id)}?question=${encodeURIComponent(questionId)}`}
              stepHref={(stepId) => `${formHref(slug, form.id)}?question=${encodeURIComponent(`step:${stepId}`)}`}
              endingsHref={`${formHref(slug, form.id)}?question=${AFTER_ROW}`}
              onOpenChange={setFlowOpen}
            />
            <QuestionsSection
              {...(props.question === undefined ? {} : { focusQuestionId: props.question })}
              {...(questionStats === undefined ? {} : { stats: questionStats })}
              onOpened={setPreviewRow}
              // The Flow sits beside Add a question once a step jumps (T20): before that, the list is the flow.
              {...(draft.layout === 'steps' && draft.steps.some((step) => (step.jumps?.length ?? 0) > 0)
                ? {
                    actionsStart: (
                      <Button
                        variant="ghost"
                        icon="git-branch"
                        onPress={() => {
                          setFlowOpen(true);
                        }}
                      >
                        {strings.flowOpen}
                      </Button>
                    ),
                  }
                : {})}
              steps={{
                steps: draft.steps,
                layout: draft.layout,
                ...(draft.endings === undefined ? {} : { endings: draft.endings }),
                onChange: (update) => {
                  setDraft((before) => withFlow(before, update({ questions: before.questions, steps: before.steps })));
                },
                ...(shown?.stepId === undefined ? {} : { problem: { stepId: shown.stepId, message: shown.message } }),
                onAddEnding: () => {
                  const id = mintEndingId(draft.endings ?? []);
                  if ((draft.endings ?? []).length >= FORM_ENDINGS_MAX) return undefined;
                  setDraft((before) => ({
                    ...before,
                    endings: [...(before.endings ?? []), { id, heading: questionStrings.newEndingHeading }],
                  }));
                  return id;
                },
              }}
              questions={draft.questions}
              onChange={(update) => {
                setDraft((before) => withQuestions(before, update(before.questions)));
              }}
              max={FORM_QUESTIONS_MAX}
              holder={questionStrings.formHolder}
              keptWith="submission"
              locked={{
                ids: new Set(
                  draft.questions.filter((question) => isMatchQuestion(draft, question)).map((question) => question.id),
                ),
                reason: strings.emailStays,
              }}
              attributes={target.items}
              objectName={target.objectName}
              {...(draft.targets.deal === undefined || target.deal === undefined ? {} : { deal: target.deal })}
              liveIds={liveIds}
              newId={() => data.forms.newId()}
              toasts={toasts}
              canCreate={canBuild}
              isReadOnly={!canManage}
              {...(shown?.questionId === undefined
                ? {}
                : { problem: { questionId: shown.questionId, message: shown.message } })}
            />
            <AfterSendSection
              slug={slug}
              draft={draft}
              target={target}
              isReadOnly={!canManage}
              toasts={toasts}
              newId={() => data.forms.newId()}
              onDraftChange={setDraft}
              showGaps={showGaps}
              {...(props.question === AFTER_ROW ? { focusRow: AFTER_ROW } : {})}
              {...(shown?.endingId === undefined
                ? {}
                : { problem: { endingId: shown.endingId, message: shown.message } })}
            />
          </>
        );
    }
  })();

  const layout = (
    <PreviewLayout
      notices={notices}
      // Every tab reads top to bottom, full width; only the Form tab keeps the preview (the owner, 22 October 2026).
      bodyLayout="stack"
      {...(current === 'form'
        ? {
            preview:
              draft.look.theme === 'brand' && props.brand !== undefined ? (
                <BrandedFormPreview
                  brand={props.brand}
                  slug={slug}
                  form={shownPreview.form}
                  {...(shownPreview.step === undefined ? {} : { step: shownPreview.step })}
                  {...(canManage ? { onTextChange: changeText } : {})}
                />
              ) : (
                <HostedFormPreview
                  form={shownPreview.form}
                  {...(shownPreview.step === undefined ? {} : { step: shownPreview.step })}
                  {...(canManage ? { onTextChange: changeText } : {})}
                />
              ),
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
                {/* Colours (spec 0063, AC-6327): the workspace's brand kit, or the product's own. */}
                {props.brand === undefined ? (
                  <BrandThemeSelect
                    value={draft.look.theme ?? 'plain'}
                    isReadOnly={!canManage}
                    onChange={(theme) => {
                      setDraft((before) => ({ ...before, look: { ...before.look, theme } }));
                    }}
                  />
                ) : (
                  <BrandThemeSelectWithKit
                    brand={props.brand}
                    slug={slug}
                    value={draft.look.theme ?? 'plain'}
                    isReadOnly={!canManage}
                    onChange={(theme) => {
                      setDraft((before) => ({ ...before, look: { ...before.look, theme } }));
                    }}
                  />
                )}
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
        reason={syncOffer ?? 'published'}
        isOpen={syncOffer !== undefined}
        onClose={() => {
          setSyncOffer(undefined);
          focusLater(() => moreRef.current);
        }}
        onStarted={(jobId) => {
          setSyncOffer(undefined);
          focusLater(() => moreRef.current);
          toasts.toast({ tone: 'info', message: strings.syncStarted });
          jobs.follow(jobId, (job) => {
            toasts.toast({
              tone: job.status === 'succeeded' ? 'success' : 'danger',
              message:
                job.status === 'succeeded' ? strings.syncDone(job.done, job.refused) : strings.jobFailed(job.label),
            });
            void router.invalidate();
          });
        }}
      />
      <ReadyDialog
        slug={slug}
        form={justLive}
        {...(liveFiling === undefined ? {} : { filing: liveFiling })}
        onClose={() => {
          setJustLive(undefined);
          // Publish left once the form went live; focus goes to the menu beside where it was.
          focusLater(() => moreRef.current);
        }}
      />
      <DiscardChangesDialog
        isOpen={isDiscarding}
        onDiscard={discard}
        onClose={() => {
          setDiscarding(false);
        }}
        onDone={() => {
          setDiscarding(false);
          toasts.toast({ tone: 'success', message: strings.discarded });
          focusLater(() => moreRef.current);
        }}
      />
      <DeleteFormDialog
        data={data}
        slug={slug}
        form={isDeleting ? form : undefined}
        onClose={() => setDeleting(false)}
        onDone={(deleted) => {
          toasts.toast({ tone: 'success', message: strings.deleted(deleted.name) });
          void navigate({ href: formsHref(slug) });
        }}
      />
    </>
  );

  return (
    <WorkspacePage
      currentPage="forms"
      page={{
        topBar,
        body: (
          <FormToolbarSlot.Provider value={toolbarSlot}>
            {
              // The Captures strip's way: the tabs edge to edge under the TopBar, the chosen tab's panel holding the layout.
              <Tabs
                variant="bar"
                end={<div ref={setToolbarSlot} />}
                label={strings.tabs}
                selectedKey={current}
                onSelectionChange={(value) => {
                  if ((FORM_TABS as readonly string[]).includes(value)) goTab(value as FormTab);
                }}
                tabs={[
                  ...(viewOnly
                    ? []
                    : [
                        { id: 'form', label: strings.tabForm, href: formHref(slug, form.id) },
                        { id: 'settings', label: strings.tabSettings, href: formHref(slug, form.id, 'settings') },
                      ]),
                  ...(isPublished && !viewOnly
                    ? [{ id: 'share', label: strings.tabShare, href: formHref(slug, form.id, 'share') }]
                    : []),
                  ...(isPublished
                    ? [
                        {
                          id: 'submissions',
                          label: strings.tabSubmissions,
                          href: formHref(slug, form.id, 'submissions'),
                        },
                        {
                          id: 'analytics',
                          label: strings.tabAnalytics,
                          href: formHref(slug, form.id, 'analytics'),
                        },
                      ]
                    : []),
                ]}
              >
                {(viewOnly
                  ? (['submissions', 'analytics'] as const)
                  : isPublished
                    ? FORM_TABS
                    : (['form', 'settings'] as const)
                ).map((id) => (
                  <TabPanel key={id} id={id} variant="fill">
                    {id === current && layout}
                  </TabPanel>
                ))}
              </Tabs>
            }
            {dialogs}
          </FormToolbarSlot.Provider>
        ),
      }}
    />
  );
}

/**
 * The live form's After page can't take visitors (late trap #53): paused, or deleted. Its own component, so the
 * booking pages are read only for a form that sends visitors to one.
 */
function AfterPageNotice({
  slug,
  formId,
  live,
}: {
  readonly slug: string;
  readonly formId: string;
  readonly live: FormDocument;
}) {
  const { data } = useRouteContext({ from: '__root__' });
  const pages = useCaptureList(data.bookingPages.view(slug));
  const problem = afterPageProblem(live, pages.status === 'ready' ? pages.items : undefined, useCan('booking.admin'));
  if (problem === undefined) return null;
  return (
    <Callout
      tone="warning"
      title={problem.kind === 'paused' ? strings.afterPagePausedTitle(problem.page.title) : strings.afterPageGoneTitle}
      actions={
        <ButtonLink href={formHref(slug, formId, 'settings')} variant="secondary">
          {strings.afterPageFix}
        </ButtonLink>
      }
    >
      {strings.afterPageText}
    </Callout>
  );
}

/**
 * A draft's name, as the page's own title (T17, 4 November 2026: no card round one field): the borderless title
 * field, typed in place. Blur saves it; an empty one says so.
 */
function DraftName({ name, onRename }: { readonly name: string; readonly onRename: (name: string) => void }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <Field
      label={strings.name}
      isLabelHidden
      variant="title"
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
  );
}
