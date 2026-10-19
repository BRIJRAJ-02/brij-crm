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
import { Button, Callout, CopyButton, Field, Modal, Select } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { changeQuestion, fileByLabel, fittingAttributes, publishAttributesOf } from './draft.ts';
import { firstRefusal } from './refusals.ts';
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
    file: 'text',
  };

const BUILD = 'build';

/** Step 1, Set up your form; step 2, Where the answers go; then Your form is live. */
export function PublishDialog(props: PublishDialogProps) {
  const { slug, form, draft, target, objects, canBuild, flush, onDraftChange, onTargetChange, onPublished, onClose } =
    props;
  const { data } = useRouteContext({ from: '__root__' });
  const [step, setStep] = useState<1 | 2 | 'live'>(1);
  const [name, setName] = useState(form.name === strings.untitledForm ? '' : form.name);
  const [address, setAddress] = useState(form.publicKey);
  const [isAddressTyped, setAddressTyped] = useState(false);
  const [taken, setTaken] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [live, setLive] = useState<FormView | undefined>(undefined);

  // The address follows the name until it is typed.
  const rename = (text: string) => {
    setName(text);
    if (isAddressTyped || text.trim() === '') return;
    const suggested = slugFromName(text);
    if (FORM_SLUG.test(suggested)) setAddress(suggested);
  };

  // The address is checked as it changes.
  useEffect(() => {
    if (!FORM_SLUG.test(address) || address === form.publicKey) return;
    let isCurrent = true;
    const timer = setTimeout(() => {
      data.forms.slugAvailable(slug, form.id, address).then(
        (isFree) => {
          if (isCurrent) setTaken(isFree ? undefined : address);
        },
        () => undefined,
      );
    }, 300);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [address, data, slug, form.id, form.publicKey]);

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

  const moveTo = (objectId: string) => {
    if (objectId === draft.targets.main.objectId) return;
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

  const goLive = () => {
    const problem = publishProblem({
      name: name.trim(),
      slug: address,
      document: draft,
      attributes: publishAttributesOf(target),
    });
    if (problem !== undefined) {
      setError(problem.message);
      return;
    }
    setBusy('publish');
    setError(undefined);
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
            <Button slot="close">{strings.cancel}</Button>
            <Button
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
            <Button variant="primary" onPress={goLive} isPending={busy === 'publish'} isDisabled={busy !== undefined}>
              {busy === 'publish' ? strings.publishing : strings.publish}
            </Button>
          </>
        ) : (
          <Button variant="primary" slot="close">
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
              setAddress(text.toLowerCase());
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
            hint={strings.fileOntoHint}
            items={[
              ...objects
                .filter((object) => !object.isArchived)
                .map((object) => ({ id: object.id, label: object.pluralName, icon: object.icon })),
            ]}
            value={draft.targets.main.objectId}
            isDisabled={busy !== undefined}
            onChange={(id) => {
              if (id !== null) moveTo(id);
            }}
          />
          {draft.questions.map((question) => (
            <Select
              key={question.id}
              label={question.label === '' ? strings.untitledQuestion : question.label}
              items={[
                { id: 'none', label: strings.notFiled },
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
          {canBuild && unfiled.length > 0 && (
            <Button icon="plus" onPress={() => void build()} isPending={busy === BUILD} isDisabled={busy !== undefined}>
              {busy === BUILD
                ? strings.building
                : strings.buildObjectButton(
                    name.trim() === '' ? strings.untitledForm : name.trim(),
                    draft.questions.length,
                  )}
            </Button>
          )}
        </>
      )}
      {step === 'live' && (
        <>
          <p>{strings.liveText}</p>
          <Field
            label={strings.address}
            value={link}
            isReadOnly
            suffix={<CopyButton value={link} label={strings.copy} isIconOnly />}
          />
        </>
      )}
    </Modal>
  );
}
