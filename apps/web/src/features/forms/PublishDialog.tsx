// Brief
// Purpose: a form's first publish in one step (spec 0058, AC-13): its name and link, where submissions are saved, and
// each question's field as an editable row, matched for you; then the Ready panel with the link, QR and embed tiles.
// Main task: check what is prefilled and press Publish once.
// Leaves out: later publishes (straight from the header), and the rest of the form's settings (the Settings tab).
import {
  isDataError,
  type AnswerType,
  type FormDocument,
  type FormQuestion,
  type FormTargetChoices,
  type FormView,
  type ObjectSummary,
} from '@crm/data';
import { FORM_SLUG, publishProblem, slugFromName } from '@crm/data/forms';
import { Button, Callout, Field, iconOf, Modal, ReadyPanel, Select, Table, TileGrid, type SelectItem } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  changeQuestion,
  fileByLabel,
  fittingAttributes,
  isMatchQuestion,
  publishAttributesOf,
  publishStart,
} from './draft.ts';
import { createPlannedAttributes } from '../questions/attributes.ts';
import { emailToMakeUnique, readyMatch, type ReadyMatch } from './match.ts';
import { plannedType, planNewAttributes } from '../questions/questions.ts';
import { EMBED_TILES } from './InstallTab.tsx';
import { firstRefusal } from './refusals.ts';
import { embedSnippet, type EmbedMode } from './snippets.ts';
import { strings } from './strings.ts';
import { strings as questionStrings } from '../questions/strings.ts';

/** Props for the first publish. */
export interface PublishDialogProps {
  readonly slug: string;
  readonly form: FormView;
  readonly draft: FormDocument;
  readonly target: FormTargetChoices;
  readonly objects: readonly ObjectSummary[];
  /** The member may make objects and fields (`schema.manage`): New object and New fields show. */
  readonly canBuild: boolean;
  /** Saves the draft now; answers the revision to name. */
  readonly flush: () => Promise<number>;
  readonly onDraftChange: (next: FormDocument) => void;
  readonly onTargetChange: (view: FormView, target: FormTargetChoices) => void;
  readonly onPublished: (view: FormView) => void;
  readonly onClose: () => void;
}

/**
 * The attribute type a question becomes when an object is built from the form: its planned type (`plannedType`), or
 * none for an answer no field we make can hold (a file, a date and time), which stays with the submission.
 */
const builtType = (answerType: AnswerType) => plannedType(answerType);

/** Save to's choice that builds an object out of the form as Publish starts, and its last: keep submissions only. */
const BUILD = 'build';
const NO_CRM = 'none';

/** A mapping row's two choices that are not a field: a new one made on Publish, and the answer kept off the CRM. */
const CREATE = 'create';
const KEPT = 'kept';

/**
 * One step: Name and Link, Save to, then the Question and Saved as table, each answer matched to a field by its label
 * and still changeable; Publish turns the dialog into the Ready panel.
 */
export function PublishDialog(props: PublishDialogProps) {
  const { slug, form, draft, target, objects, canBuild, flush, onDraftChange, onTargetChange, onPublished, onClose } =
    props;
  const { data, toasts } = useRouteContext({ from: '__root__' });
  // Until one is typed here, the name and address follow the form's own name, so a name given in the editor just
  // before Publish (saved as the field is left) lands in the dialog too.
  const start = publishStart(form.name, form.publicKey);
  const [typedName, setTypedName] = useState<string | undefined>(undefined);
  const [chosenAddress, setChosenAddress] = useState<string | undefined>(undefined);
  const [isAddressTyped, setAddressTyped] = useState(false);
  const name = typedName ?? start.name;
  const address = chosenAddress ?? start.address;
  const [taken, setTaken] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [live, setLive] = useState<FormView | undefined>(undefined);
  const [embed, setEmbed] = useState<EmbedMode | null>(null);
  // New object is a choice until Publish: nothing is made if the dialog is cancelled or another object is picked.
  const [isBuildChosen, setBuildChosen] = useState(false);

  // Each answer meets a field with its label as the dialog opens, so a normal form goes live with one press; the
  // table shows every match, and each stays changeable. Once: a choice made here is never matched over.
  useEffect(() => {
    onDraftChange(fileByLabel(draft, target.items));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The address follows the name until it is typed.
  const rename = (text: string) => {
    setTypedName(text);
    if (isAddressTyped || text.trim() === '') return;
    const suggested = slugFromName(text);
    if (FORM_SLUG.test(suggested)) setChosenAddress(suggested);
  };

  // The address is checked as it changes.
  useEffect(() => {
    if (!FORM_SLUG.test(address) || address === form.publicKey) return;
    let isCurrent = true;
    const timer = setTimeout(() => {
      data.forms.slugAvailable(slug, form.id, address).then(
        (isFree) => {
          if (!isCurrent) return;
          // An address made from the name that another form holds goes back to the form's own key, rather than
          // showing an error the person never typed; one they typed says it is taken.
          if (!isFree && !isAddressTyped) setChosenAddress(form.publicKey);
          else setTaken(isFree ? undefined : address);
        },
        () => undefined,
      );
    }, 300);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [address, data, slug, form.id, form.publicKey, isAddressTyped]);

  const addressError = !FORM_SLUG.test(address)
    ? strings.addressInvalid
    : taken === address
      ? strings.addressTaken
      : undefined;

  // An object, or none (keep submissions only): the server points the draft there and clears filing that no longer fits.
  const moveTo = (objectId: string | null) => {
    if (objectId === (draft.targets.main?.objectId ?? null)) return;
    setBusy('target');
    setError(undefined);
    flush()
      .then((revision) => data.forms.setTarget(slug, form.id, objectId, revision))
      .then(async (view) => {
        const choices = await data.forms.attributes(slug, form.id);
        setBusy(undefined);
        onTargetChange(view, choices);
        onDraftChange(fileByLabel(view.draft, choices.items));
      })
      .catch((failure: unknown) => {
        setBusy(undefined);
        setError(firstRefusal(failure).message);
      });
  };

  const isKeptOnly = draft.targets.main === undefined;
  const mayCreate = canBuild && !isKeptOnly;
  // What Publish will make for the questions with nowhere to go, so each row says it before it happens rather than
  // showing a bare "Not filed" for a question it is about to file (27 October 2026).
  const planned = new Map(
    planNewAttributes(draft.questions, target.items, mayCreate).map((plan) => [plan.questionId, plan.title]),
  );
  // The field a kept question would get if it asked for one: what its New choice is titled.
  const creatable = new Map(
    planNewAttributes(
      draft.questions.map((question) => {
        const { kept: _kept, ...rest } = question;
        return rest;
      }),
      target.items,
      mayCreate,
    ).map((plan) => [plan.questionId, plan.title]),
  );

  const makesUnique = canBuild ? emailToMakeUnique(draft, target) : undefined;
  const uniqueTitle = target.items.find((item) => item.attributeId === makesUnique)?.title;
  const formName = name.trim() === '' ? strings.untitledForm : name.trim();

  /**
   * New object, made as Publish starts: an object named after the form, one attribute per question (the email
   * unique), the form pointed at it and each question filed on its own field. Answers the draft and choices to publish.
   */
  const build = async (): Promise<{ readonly document: FormDocument; readonly choices: FormTargetChoices }> => {
    const object = await data.objects.create(slug, {
      id: data.objects.newId(),
      singularName: formName,
      pluralName: formName,
      icon: 'inbox',
      hue: 'blue',
    });
    const made = new Map<string, string>();
    for (const question of draft.questions) {
      const type = builtType(question.answerType);
      if (type === undefined) continue;
      const attribute = await data.attributes.create(slug, {
        id: data.attributes.newId(),
        objectId: object.id,
        title: question.label === '' ? question.key : question.label,
        type,
        ...(question.answerType === 'email' ? { isUnique: true } : {}),
        ...(question.answerType === 'multi_select' ? { isMulti: true } : {}),
        ...(type === 'select'
          ? {
              options: (question.choices ?? [])
                .filter((choice) => choice.trim() !== '')
                .map((label) => ({ id: data.attributes.newId(), label, hue: 'gray' as const })),
            }
          : {}),
      });
      made.set(question.id, attribute.id);
    }
    const revision = await flush();
    const view = await data.forms.setTarget(slug, form.id, object.id, revision);
    const choices = await data.forms.attributes(slug, form.id);
    onTargetChange(view, choices);
    let document = view.draft;
    for (const [questionId, attributeId] of made) {
      document = changeQuestion(document, questionId, { filedOn: attributeId });
    }
    onDraftChange(document);
    // Built: the object is now the form's own, so a refusal later never builds a second one.
    setBuildChosen(false);
    return { document, choices };
  };

  /**
   * Gives every unfiled, labelled question an attribute on the chosen object, as the editor's own Publish does, and
   * then asks for that object again so the match is worked out over the attributes that now exist.
   *
   * The editor creates them before this dialog opens, against whatever the form pointed at then. Save to lets the
   * object be changed, and changing it left those questions with nowhere to go and no way to make anywhere: a form
   * sent to an object with no email attribute could not be published at all, and said only "Keep an email question"
   * about a question that was already there (the owner, 27 October 2026).
   */
  const fileTheRest = async (start: FormDocument, startChoices: FormTargetChoices): Promise<ReadyMatch> => {
    const objectId = start.targets.main?.objectId;
    const plans = planNewAttributes(start.questions, startChoices.items, canBuild && objectId !== undefined);
    let document = start;
    let choices = startChoices;
    if (objectId !== undefined && plans.length > 0) {
      const made = await createPlannedAttributes(data, slug, objectId, plans);
      // A field that couldn't be made leaves its question unfiled: said, never published quietly (late trap #37).
      const missed = plans.filter((plan) => !made.some((each) => each.questionId === plan.questionId));
      if (missed.length > 0) {
        toasts.toast({
          tone: 'danger',
          message: questionStrings.notCreated(
            missed.map((plan) => plan.title),
            startChoices.objectName ?? '',
            'submission',
          ),
        });
      }
      if (made.length > 0) {
        document = made.reduce(
          (next, each) => changeQuestion(next, each.questionId, { filedOn: each.attributeId }),
          start,
        );
        onDraftChange(document);
        choices = await data.forms.attributes(slug, form.id);
      }
    }
    // The email it matches on, made unique where the object has none, and the match worked out again over the
    // attributes as they now are (`readyMatch`): an email attribute made by hand often isn't unique.
    const ready = await readyMatch(
      { data, slug, formId: form.id, canChangeAttributes: canBuild, flush },
      document,
      choices,
    );
    if (!('refused' in ready) && ready.view !== undefined) onTargetChange(ready.view, ready.choices);
    return ready;
  };

  const goLive = async () => {
    if (busy !== undefined || name.trim() === '' || addressError !== undefined) return;
    setBusy('publish');
    setError(undefined);
    let ready: ReadyMatch;
    try {
      const from = isBuildChosen ? await build() : { document: draft, choices: target };
      ready = await fileTheRest(from.document, from.choices);
    } catch (failure) {
      setBusy(undefined);
      setError(firstRefusal(failure).message);
      return;
    }
    if ('refused' in ready) {
      setBusy(undefined);
      setError(ready.refused);
      return;
    }
    const { document, choices } = ready;
    const problem = publishProblem({
      name: name.trim(),
      slug: address,
      document,
      attributes: publishAttributesOf(choices),
      ...(choices.objectName === undefined ? {} : { objectName: choices.objectName }),
      canChangeAttributes: canBuild,
    });
    if (problem !== undefined) {
      setBusy(undefined);
      setError(problem.message);
      return;
    }
    flush()
      .then((revision) =>
        data.forms.publish(slug, form.id, { expectedRevision: revision, name: name.trim(), slug: address }),
      )
      .then(
        (view) => {
          setBusy(undefined);
          setLive(view);
          onPublished(view);
        },
        (failure: unknown) => {
          setBusy(undefined);
          const refusal = firstRefusal(failure);
          // A link taken meanwhile says so under the Link field, which is right there.
          if (refusal.field === 'slug' || (isDataError(failure) && failure.code === 'SLUG_TAKEN')) {
            setTaken(address);
            return;
          }
          setError(refusal.message);
        },
      );
  };

  if (live !== undefined) {
    // The same dialog, its contents swapped, so nothing closes and opens again: the Ready panel eases in (AC-6, AC-21).
    const shown = live.live ?? live.draft;
    return (
      <Modal
        // Said as the dialog's name once Done takes focus: the success is heard, not only seen.
        title={strings.liveTitle}
        variant="form"
        isOpen
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
        actions={
          // Publish gave way to Done, so focus would fall out of the dialog (and Esc with it): it lands on Done.
          // eslint-disable-next-line jsx-a11y-x/no-autofocus
          <Button key="done" variant="primary" slot="close" autoFocus>
            {strings.done}
          </Button>
        }
      >
        <ReadyPanel
          title={live.name}
          message={strings.liveText}
          link={data.forms.hostedUrl(live.publicKey)}
          shareTitle={live.name}
          // Done is the dialog's one primary; Copy steps down beside the link.
          copyVariant="secondary"
        >
          <TileGrid
            variant="choice"
            label={strings.embedTiles}
            tiles={EMBED_TILES}
            value={embed}
            onChange={(id) => {
              const tile = EMBED_TILES.find((each) => each.id === id);
              if (tile !== undefined) setEmbed(tile.id);
            }}
          />
          {/* No code until a way is picked (AC-6): the tiles say how it shows, and the snippet follows the pick. */}
          {embed !== null && (
            <Field
              label={strings.embedSnippet}
              variant="copy"
              isMultiline
              copyLabel={strings.copyEmbed}
              {...(embed === 'floating' ? { hint: strings.embedFloatingWords } : {})}
              value={embedSnippet(
                data.forms.embedUrl(),
                {
                  kind: 'form',
                  publicKey: live.publicKey,
                  title: shown.headline,
                  theme: shown.look.colour,
                  // A button on a site's page reads as an invitation, not as the form's own Submit, as on Install.
                  buttonText: strings.embedButtonText,
                },
                embed,
              )}
            />
          )}
        </ReadyPanel>
      </Modal>
    );
  }

  const writable = objects.filter((object) => !object.isArchived && object.access === 'write');
  const targetId = draft.targets.main?.objectId;
  const objectItems: readonly SelectItem[] = [
    ...writable.map((object) => ({ id: object.id, label: object.pluralName, icon: object.icon })),
    // An object just built here isn't in the route's list yet: it shows by the name the form already holds.
    ...(targetId !== undefined && !writable.some((object) => object.id === targetId)
      ? [{ id: targetId, label: target.objectName ?? formName, icon: 'inbox' as const }]
      : []),
    ...(canBuild
      ? [
          {
            id: BUILD,
            label: strings.buildObjectItem(formName),
            icon: 'plus' as const,
            // What it will really make: a file question gets no attribute, so it is not counted.
            description: strings.buildObjectText(
              draft.questions.filter((question) => builtType(question.answerType) !== undefined).length,
            ),
          },
        ]
      : []),
    // Not adding to the CRM is a real choice, set apart from the objects (the owner, 21 October 2026).
    { id: NO_CRM, label: strings.noCrm, icon: 'inbox' as const, isApart: true },
  ];

  return (
    <Modal
      title={strings.publishTitle}
      variant="form"
      isOpen
      isBusy={busy !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen && busy === undefined) onClose();
      }}
      // An email field the object already has becomes unique on Publish (late trap #36): said before it happens,
      // beside the Publish it is about, in one line.
      {...(!isBuildChosen && uniqueTitle !== undefined && target.objectName !== undefined
        ? { hint: strings.willMakeUnique(uniqueTitle, target.objectName) }
        : {})}
      actions={
        <>
          <Button slot="close" isDisabled={busy !== undefined}>
            {strings.cancel}
          </Button>
          <Button
            variant="primary"
            onPress={() => void goLive()}
            isPending={busy === 'publish'}
            isDisabled={busy !== undefined || name.trim() === '' || addressError !== undefined}
          >
            {busy === 'publish' ? strings.publishing : strings.publish}
          </Button>
        </>
      }
    >
      {error !== undefined && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      <Field
        label={strings.name}
        placeholder={strings.untitledForm}
        value={name}
        maxLength={80}
        // The dialog opens on its first question.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
        onChange={rename}
        onSubmit={() => void goLive()}
      />
      <Field
        label={strings.address}
        prefix="/f/"
        value={address}
        maxLength={40}
        autoComplete="off"
        onChange={(text) => {
          setAddressTyped(true);
          setChosenAddress(text.toLowerCase());
        }}
        onSubmit={() => void goLive()}
        {...(addressError === undefined || address === '' ? {} : { error: addressError })}
      />
      <Select
        label={strings.whichObject}
        items={objectItems}
        value={isBuildChosen ? BUILD : (targetId ?? NO_CRM)}
        // New object says what it makes ("3 fields from its questions") once chosen.
        showsDescription
        isDisabled={busy !== undefined}
        onChange={(id) => {
          setBuildChosen(id === BUILD);
          if (id !== null && id !== BUILD) moveTo(id === NO_CRM ? null : id);
        }}
      />
      {/* New object gives every question its own field, so there is nothing to match until it exists. */}
      {!isKeptOnly && !isBuildChosen && draft.questions.length > 0 && (
        <Table
          label={strings.mappingLabel}
          columns={[
            { id: 'question', label: strings.mappingQuestion, isRowHeader: true },
            { id: 'savedAs', label: strings.mappingSavedAs },
          ]}
          rows={draft.questions}
          getRowId={(question) => question.id}
          renderCell={(question, column) =>
            column === 'question' ? (
              labelOf(question)
            ) : (
              <SavedAs
                question={question}
                target={target}
                plannedTitle={planned.get(question.id)}
                creatableTitle={creatable.get(question.id)}
                isLocked={isMatchQuestion(draft, question)}
                isDisabled={busy !== undefined}
                onChange={(change) => {
                  onDraftChange(changeQuestion(draft, question.id, change));
                }}
              />
            )
          }
        />
      )}
    </Modal>
  );
}

/** A question's name in its row. */
function labelOf(question: FormQuestion): string {
  return question.label.trim() === '' ? questionStrings.untitledQuestion : question.label;
}

/** A row's Saved as: the field it fills, a New one Publish makes, or the submission only, as one small Select. */
function SavedAs({
  question,
  target,
  plannedTitle,
  creatableTitle,
  isLocked,
  isDisabled,
  onChange,
}: {
  readonly question: FormQuestion;
  readonly target: FormTargetChoices;
  /** The field Publish will make for it, when it will. */
  readonly plannedTitle: string | undefined;
  /** The field it would get if it asked for one (a kept question too); none when no field can be made. */
  readonly creatableTitle: string | undefined;
  /** The email the form matches on: it stays where it is, as on its question card. */
  readonly isLocked: boolean;
  readonly isDisabled: boolean;
  readonly onChange: (change: { readonly filedOn: string | null; readonly kept?: boolean }) => void;
}) {
  const fitting = fittingAttributes(target.items, question.answerType);
  const filed = question.filedOn?.attributeId;
  const items: SelectItem[] = [
    ...(creatableTitle === undefined
      ? []
      : [
          {
            id: CREATE,
            label: plannedTitle ?? creatableTitle,
            icon: iconOf({ type: builtType(question.answerType) ?? 'text' }),
            badge: strings.newField,
          },
        ]),
    ...fitting.map((attribute) => ({
      id: attribute.attributeId,
      label: attribute.title,
      icon: iconOf({ type: attribute.type }),
      ...(attribute.canWrite ? {} : { description: strings.cantWrite, isArchived: true }),
    })),
    // A filing whose field is gone still shows, muted, as the question card names it.
    ...(filed === undefined || fitting.some((attribute) => attribute.attributeId === filed)
      ? []
      : [{ id: filed, label: strings.goneAttribute, isArchived: true }]),
    // Apart from the fields: not one more place an answer could go.
    {
      id: KEPT,
      label: strings.submissionOnly,
      icon: 'inbox',
      isApart: fitting.length > 0 || creatableTitle !== undefined,
    },
  ];
  return (
    <Select
      label={strings.savedAsOf(labelOf(question))}
      isLabelHidden
      size="sm"
      // In a row of the table, a stray letter on a closed trigger never remaps an answer.
      savesOnPick
      items={items}
      value={filed ?? (plannedTitle === undefined ? KEPT : CREATE)}
      isReadOnly={isLocked}
      {...(isLocked ? { readOnlyReason: strings.emailStays } : {})}
      isDisabled={isDisabled}
      onChange={(id) => {
        if (id === null || id === KEPT) onChange({ filedOn: null, kept: true });
        else if (id === CREATE) onChange({ filedOn: null, kept: false });
        else onChange({ filedOn: id });
      }}
    />
  );
}
