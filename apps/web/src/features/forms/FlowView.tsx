// Brief
// Purpose: the Flow view (spec 0063, AC-6325): the steps a visitor walks, top to bottom, with each step's jumps as a plain line and the form's endings at the foot.
// Main task: read the shape of a form's logic in one place, and go from any part of it to where it is edited.
// Leaves out: editing anything (every part is a link back to its own row) and the look of the form itself (that is the preview).
import type { FormDocument } from '@crm/data';
import { stepsOfBreaks } from '@crm/data/forms';
import { Button, Card, DescriptionList, EmptyState, Link, Modal } from '@crm/ui';
import { conditionsLine, questionFacts } from '../routing/facts.ts';
import { idOfTarget, jumpChoices } from '../questions/jumps.ts';
import { strings } from './strings.ts';

/** Props for the Flow view: the draft it reads, and where each part is edited. */
export interface FlowViewProps {
  readonly draft: FormDocument;
  readonly isOpen: boolean;
  /** One question's row on the Form tab, open and in view. */
  readonly questionHref: (questionId: string) => string;
  /** One step divider's row on the Form tab. */
  readonly stepHref: (stepId: string) => string;
  /** The Settings tab, where the endings are worded. */
  readonly endingsHref: string;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/**
 * A form's logic, read only (AC-6325): one card per step a visitor can reach, each listing what it asks and where
 * its answers send them, then the endings. Classic draws no steps, so it says so rather than an empty diagram.
 */
export function FlowView({ draft, isOpen, questionHref, stepHref, endingsHref, onOpenChange }: FlowViewProps) {
  const endings = draft.endings ?? [];
  const facts = questionFacts(draft.questions);
  const byKey = new Map(draft.questions.map((question) => [question.key, question]));
  const resolved = stepsOfBreaks(draft.questions, draft.steps).filter((step) => step.keys.length > 0);
  // A link leads out of this window, so it closes behind the visitor rather than covering the row they asked for.
  const close = () => {
    onOpenChange(false);
  };
  const labelOfEnding = (id: string) => {
    const at = endings.findIndex((ending) => ending.id === id);
    const ending = endings[at];
    return ending === undefined ? undefined : strings.endingName(at + 1, ending.heading);
  };
  return (
    <Modal
      variant="window"
      icon="git-branch"
      title={strings.flowTitle}
      context={strings.flowLine}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      actions={<Button slot="close">{strings.flowClose}</Button>}
    >
      {draft.layout === 'classic' ? (
        <p>{strings.flowClassic}</p>
      ) : resolved.length === 0 ? (
        <EmptyState icon="git-branch" title={strings.flowEmptyTitle}>
          {strings.flowEmpty}
        </EmptyState>
      ) : (
        resolved.map((step, place) => {
          const stepId = step.id;
          const name = strings.flowStep(place + 1, step.title);
          const next = resolved[place + 1];
          const nextName = next === undefined ? undefined : strings.flowStep(place + 2, next.title);
          // Each jump as one line: its conditions in words, then where it goes, with "→" standing for the arrow.
          const choices =
            stepId === undefined
              ? []
              : jumpChoices({ questions: draft.questions, steps: draft.steps }, endings, stepId);
          const jumps =
            (stepId === undefined ? undefined : draft.steps.find((each) => each.id === stepId)?.jumps) ?? [];
          const lines = [
            ...jumps.map((jump) => {
              const target = idOfTarget(jump.to);
              const where = choices.find((choice) => choice.id === target)?.label;
              const words =
                where ??
                ('ending' in jump.to
                  ? strings.flowToEnding(labelOfEnding(jump.to.ending) ?? jump.to.ending)
                  : strings.flowToStep(jump.to.step));
              return {
                id: `${name}-${target}`,
                term: strings.flowJump(conditionsLine(jump.when, facts)),
                detail: words,
              };
            }),
            {
              id: `${name}-next`,
              term: strings.flowNext,
              // Where it falls through to, by name: the next step a visitor reaches, or the thank you at the foot.
              detail: nextName ?? strings.flowThanks,
            },
          ];
          return (
            <Card
              key={stepId ?? `step-${String(place)}`}
              title={name}
              description={[
                strings.flowQuestions(step.keys.length),
                ...step.keys.map((key) => byKey.get(key)?.label ?? key).filter((label) => label.trim() !== ''),
              ].join(' · ')}
              actions={
                stepId === undefined ? (
                  // The questions before the first divider have no divider of their own: the first one links instead.
                  <Link href={questionHref(byKey.get(step.keys[0] ?? '')?.id ?? '')} onPress={close}>
                    {strings.flowEdit}
                  </Link>
                ) : (
                  <Link href={stepHref(stepId)} onPress={close}>
                    {strings.flowEdit}
                  </Link>
                )
              }
            >
              <DescriptionList
                items={lines.map((line) => ({ id: line.id, term: line.term, description: line.detail }))}
              />
            </Card>
          );
        })
      )}
      {endings.length > 0 && (
        <Card
          title={strings.flowEndings}
          actions={
            <Link href={endingsHref} onPress={close}>
              {strings.flowEdit}
            </Link>
          }
        >
          <DescriptionList
            items={endings.map((ending, place) => ({
              id: ending.id,
              term: strings.endingName(place + 1, ending.heading),
              description: ending.line === undefined || ending.line === '' ? strings.flowNoLine : ending.line,
              ...(ending.line === undefined || ending.line === '' ? { isPlaceholder: true } : {}),
            }))}
          />
        </Card>
      )}
    </Modal>
  );
}
