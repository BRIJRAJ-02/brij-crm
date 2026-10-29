// Brief
// Purpose: a form's first publish (spec 0023, 0023-experience.md, Publishing): its name and address, then where the answers go, then the link.
// Main task: name the form, take an address, file the questions on an object (or build one), and go live.
// Leaves out: later publishes (straight from the header), and the settings a form keeps after (Settings tab).
import {
  isDataError,
  type AnswerType,
  type FormDocument,
  type FormTargetChoices,
  type FormView,
  type ObjectSummary,
} from '@crm/data';
import { FORM_SLUG, publishProblem, slugFromName } from '@crm/data/forms';
import { Button, Callout, Field, Modal, Select } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { changeQuestion, fileByLabel, fittingAttributes, publishAttributesOf, publishStart } from './draft.ts';
import { createPlannedAttributes } from '../questions/attributes.ts';
import { emailToMakeUnique, readyMatch, type ReadyMatch } from './match.ts';
import { planNewAttributes } from '../questions/questions.ts';
import { firstRefusal } from './refusals.ts';
import { embedSnippet } from './snippets.ts';
import { strings } from './strings.ts';

/** Props for the first publish. */
export interface PublishDialogProps {
  readonly slug: string;
  readonly form: FormView;
  readonly draft: FormDocument;
  readonly target: FormTargetChoices;
  readonly objects: readonly ObjectSummary[];
  /** The member may make objects (`schema.manage`): "Build one out of this form" shows. */
  readonly canBuild: boolean;
  /** Saves the draft now; answers the revision to name. */
  readonly flush: () => Promise<number>;
  readonly onDraftChange: (next: FormDocument) => void;
  readonly onTargetChange: (view: FormView, target: FormTargetChoices) => void;
  readonly onPublished: (view: FormView) => void;
  readonly onClose: () => void;
}

/** The attribute type a question becomes when an object is built from the form. */
const BUILT_TYPE: Readonly<Record<AnswerType, 'text' | 'email' | 'phone' | 'url' | 'number' | 'select' | 'checkbox'>> =
  {
    short_text: 'text',
    long_text: 'text',
    email: 'email',
    phone: 'phone',
    website: 'url',
    number: 'number',
    dropdown: 'select',
    choice: 'select',
    checkbox: 'checkbox',
    yes_no: 'checkbox',
    country: 'text',
    // A file answer only files onto a file attribute, and the picker makes none, so a file question is left out of
    // a built object entirely rather than given a text attribute it can never be filed on (27 October 2026).
    file: 'text',
  };

const BUILD = 'build';

/** The object list's last choice: keep submissions only, adding nothing to the CRM. */
const NO_CRM = 'none';

/** Step 1, Set up your form; step 2, Where the answers go; then Your form is live. */
export function PublishDialog(props: PublishDialogProps) {
  const { slug, form, draft, target, objects, canBuild, flush, onDraftChange, onTargetChange, onPublished, onClose } =
    props;
  const { data } = useRouteContext({ from: '__root__' });
  const [step, setStep] = useState<1 | 2 | 'live'>(1);
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

  const goToAnswers = () => {
    if (name.trim() === '' || addressError !== undefined) return;
    onDraftChange(fileByLabel(draft, target.items));
    setError(undefined);
    setStep(2);
  };

  // An object, or none (keep submissions only): the server points the draft there and clears filing that no longer fits.
  const moveTo = (objectId: string | null) => {
    if (objectId === (draft.targets.main?.objectId ?? null)) return;
    setBusy('target');
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

  const unfiled = draft.questions.filter((question) => question.filedOn === undefined);
  const isKeptOnly = draft.targets.main === undefined;
  // What Publish will make for the questions with nowhere to go, so the dialog says it before it happens rather
  // than showing a bare "Not filed" for a question it is about to file (27 October 2026).
  const planned = new Map(
    planNewAttributes(draft.questions, target.items, canBuild && !isKeptOnly).map((plan) => [
      plan.questionId,
      plan.title,
    ]),
  );

  const makesUnique = canBuild ? emailToMakeUnique(draft, target) : undefined;
  const uniqueTitle = target.items.find((item) => item.attributeId === makesUnique)?.title;

  // Build one out of this form: an object named after it, one attribute per unfiled question (the email unique).
  const build = async () => {
    setBusy(BUILD);
    setError(undefined);
    try {
      const formName = name.trim() === '' ? strings.untitledForm : name.trim();
      const object = await data.objects.create(slug, {
        id: data.objects.newId(),
        singularName: formName,
        pluralName: formName,
        icon: 'inbox',
        hue: 'blue',
      });
      const made = new Map<string, string>();
      for (const question of draft.questions) {
        if (question.answerType === 'file') continue;
        const attribute = await data.attributes.create(slug, {
          id: data.attributes.newId(),
          objectId: object.id,
          title: question.label === '' ? question.key : question.label,
          type: BUILT_TYPE[question.answerType],
          ...(question.answerType === 'email' ? { isUnique: true } : {}),
          ...(BUILT_TYPE[question.answerType] === 'select'
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
      let next = view.draft;
      for (const [questionId, attributeId] of made) next = changeQuestion(next, questionId, { filedOn: attributeId });
      onDraftChange(next);
      setBusy(undefined);
    } catch (failure) {
      setBusy(undefined);
      setError(firstRefusal(failure).message);
    }
  };

  /**
   * Gives every unfiled, labelled question an attribute on the chosen object, as the editor's own Publish does, and
   * then asks for that object again so the match is worked out over the attributes that now exist.
   *
   * The editor creates them before this dialog opens, against whatever the form pointed at then. Step 2 lets the
   * object be changed, and changing it left those questions with nowhere to go and no way to make anywhere: a form
   * sent to an object with no email attribute could not be published at all, and said only "Keep an email question"
   * about a question that was already there (the owner, 27 October 2026).
   */
  const fileTheRest = async (): Promise<ReadyMatch> => {
    const objectId = draft.targets.main?.objectId;
    const plans = planNewAttributes(draft.questions, target.items, canBuild && objectId !== undefined);
    let document = draft;
    let choices = target;
    if (objectId !== undefined && plans.length > 0) {
      const made = await createPlannedAttributes(data, slug, objectId, plans);
      if (made.length > 0) {
        document = made.reduce(
          (next, each) => changeQuestion(next, each.questionId, { filedOn: each.attributeId }),
          draft,
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
    setBusy('publish');
    setError(undefined);
    let ready: ReadyMatch;
    try {
      ready = await fileTheRest();
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
          setStep('live');
          onPublished(view);
        },
        (failure: unknown) => {
          setBusy(undefined);
          const refusal = firstRefusal(failure);
          if (refusal.field === 'slug' || (isDataError(failure) && failure.code === 'SLUG_TAKEN')) {
            setTaken(address);
            setStep(1);
            return;
          }
          setError(refusal.message);
        },
      );
  };

  const link = data.forms.hostedUrl(live?.publicKey ?? address);
  const title = step === 1 ? strings.setUpTitle : step === 2 ? strings.answersTitle : strings.liveTitle;

  return (
    <Modal
      title={title}
      isOpen
      {...(step === 'live' ? {} : { context: strings.stepOf(step, 2) })}
      onOpenChange={(isOpen) => {
        if (!isOpen && busy === undefined) onClose();
      }}
      actions={
        step === 1 ? (
          <>
            <Button slot="close" kbd="ESC">
              {strings.cancel}
            </Button>
            <Button
              key="next"
              variant="primary"
              onPress={goToAnswers}
              isDisabled={name.trim() === '' || addressError !== undefined}
            >
              {strings.next}
            </Button>
          </>
        ) : step === 2 ? (
          <>
            <Button
              onPress={() => {
                setStep(1);
              }}
              isDisabled={busy !== undefined}
            >
              {strings.back}
            </Button>
            <Button
              key="publish"
              variant="primary"
              onPress={() => void goLive()}
              isPending={busy === 'publish'}
              isDisabled={busy !== undefined}
            >
              {busy === 'publish' ? strings.publishing : strings.publish}
            </Button>
          </>
        ) : (
          // The step's buttons replace the one just pressed, so focus would fall out of the dialog (and Esc with
          // it): it lands on Close, inside the dialog, which is then said with its new name, Your form is live.
          // eslint-disable-next-line jsx-a11y-x/no-autofocus
          <Button key="close" variant="primary" slot="close" autoFocus>
            {strings.close}
          </Button>
        )
      }
    >
      {error !== undefined && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      {step === 1 && (
        <>
          <Field
            label={strings.name}
            placeholder={strings.untitledForm}
            value={name}
            maxLength={80}
            // The dialog opens on its first question.
            // eslint-disable-next-line jsx-a11y-x/no-autofocus
            autoFocus
            onChange={rename}
            onSubmit={goToAnswers}
          />
          <Field
            label={strings.address}
            prefix="/f/"
            hint={strings.addressHint}
            value={address}
            maxLength={40}
            autoComplete="off"
            onChange={(text) => {
              setAddressTyped(true);
              setChosenAddress(text.toLowerCase());
            }}
            onSubmit={goToAnswers}
            {...(addressError === undefined || address === '' ? {} : { error: addressError })}
          />
        </>
      )}
      {step === 2 && (
        <>
          <Select
            label={strings.fileOnto}
            hint={isKeptOnly ? strings.keptOnlyHint : strings.fileOntoHint}
            // Step 2 opens on its first choice, so a second press of Next never lands on Publish.
            // eslint-disable-next-line jsx-a11y-x/no-autofocus
            autoFocus
            items={[
              ...objects
                .filter((object) => !object.isArchived && object.access === 'write')
                .map((object) => ({ id: object.id, label: object.pluralName, icon: object.icon })),
              // Not adding to the CRM is a real choice, set apart from the objects (the owner, 21 October 2026).
              { id: NO_CRM, label: strings.noCrm, icon: 'inbox' as const, isApart: true },
            ]}
            value={draft.targets.main?.objectId ?? NO_CRM}
            isDisabled={busy !== undefined}
            onChange={(id) => {
              if (id !== null) moveTo(id === NO_CRM ? null : id);
            }}
          />
          {!isKeptOnly &&
            draft.questions.map((question) => (
              <Select
                key={question.id}
                label={question.label === '' ? strings.untitledQuestion : question.label}
                items={[
                  {
                    id: 'none',
                    label:
                      planned.get(question.id) === undefined || target.objectName === undefined
                        ? strings.notFiled
                        : strings.willCreate(planned.get(question.id) ?? '', target.objectName),
                  },
                  ...fittingAttributes(target.items, question.answerType).map((attribute) => ({
                    id: attribute.attributeId,
                    label: `${target.objectName} · ${attribute.title}`,
                    ...(attribute.canWrite ? {} : { description: strings.cantWrite, isArchived: true }),
                  })),
                ]}
                value={question.filedOn?.attributeId ?? 'none'}
                isDisabled={busy !== undefined}
                onChange={(id) => {
                  onDraftChange(
                    changeQuestion(draft, question.id, { filedOn: id === null || id === 'none' ? null : id }),
                  );
                }}
              />
            ))}
          {canBuild && !isKeptOnly && unfiled.length > 0 && (
            <Button icon="plus" onPress={() => void build()} isPending={busy === BUILD} isDisabled={busy !== undefined}>
              {busy === BUILD
                ? strings.building
                : strings.buildObjectButton(
                    name.trim() === '' ? strings.untitledForm : name.trim(),
                    // What it will really make: a file question gets no attribute, so it is not counted.
                    draft.questions.filter((question) => question.answerType !== 'file').length,
                  )}
            </Button>
          )}
          {/* An email field the object already has becomes unique on Publish (late trap #36): said before it happens,
              last before the Publish it is about. */}
          {uniqueTitle !== undefined && target.objectName !== undefined && (
            <Callout tone="info">{strings.willMakeUnique(uniqueTitle, target.objectName)}</Callout>
          )}
        </>
      )}
      {step === 'live' && (
        <>
          <p>{strings.liveText}</p>
          <Field label={strings.address} variant="copy" copyLabel={strings.copyLink} value={link} />
          <Field
            label={strings.embedSnippet}
            hint={strings.embedText}
            variant="copy"
            isMultiline
            copyLabel={strings.copyEmbed}
            value={embedSnippet(
              data.forms.embedUrl(),
              {
                kind: 'form',
                publicKey: live?.publicKey ?? address,
                title: live?.draft.headline ?? draft.headline,
                theme: (live?.draft ?? draft).look.colour,
                buttonText: (live?.draft ?? draft).buttonText,
              },
              'inline',
            )}
          />
          <p>{strings.ownFormLater}</p>
        </>
      )}
    </Modal>
  );
}
