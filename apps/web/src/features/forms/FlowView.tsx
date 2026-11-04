// Brief
// Purpose: the Flow view (spec 0063, AC-6325): the steps a visitor walks, top to bottom, what happens after each one, and where the form ends.
// Main task: read the shape of a form's logic in one place, add a step, and go from any part of it to where it is edited.
// Leaves out: editing a rule here (each step links to its card, where Add logic is) and the look of the form (that is the preview).
import type { FormDocument } from '@crm/data';
import { stepsOfBreaks } from '@crm/data/forms';
import { Button, Card, DescriptionList, EmptyState, Link, Modal } from '@crm/ui';
import { conditionsLine, questionFacts } from '../routing/facts.ts';
import { idOfTarget, jumpChoices } from '../questions/jumps.ts';
import { firstWords } from './draft.ts';
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
  /** Adds a step (placed and named by the list) and opens it on the Form tab. Left out, read only. */
  readonly onAddStep?: () => void;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/**
 * A form's logic, read only (AC-6325; T5, 4 November 2026: "I didnt understand what happens here with steps"): one
 * card per step a visitor can reach, its questions, then what happens after it in Typeform's words, each rule "If …
 * Jump to …", and last where everyone else goes ("Otherwise Go to Step 2", or "Then Thank you page" for a step
 * with no rules). The endings close the list, the thank you page first, so every step, every jump and every end is
 * on the page. Add a step is at the foot. Classic and One at a time draw no steps, so they say so in one line.
 */
export function FlowView({
  draft,
  isOpen,
  questionHref,
  stepHref,
  endingsHref,
  onAddStep,
  onOpenChange,
}: FlowViewProps) {
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
  const isSteps = draft.layout === 'steps';
  return (
    <Modal
      variant="window"
      icon="git-branch"
      title={strings.flowTitle}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      actions={
        <>
          {isSteps && onAddStep !== undefined && draft.questions.length > 0 && (
            <Button icon="layers" onPress={onAddStep}>
              {strings.flowAddStep}
            </Button>
          )}
          <Button slot="close">{strings.flowClose}</Button>
        </>
      }
    >
      {!isSteps ? (
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
          const stored = stepId === undefined ? undefined : draft.steps.find((each) => each.id === stepId);
          // Each jump as one line: its conditions in words, then where it goes.
          const choices =
            stepId === undefined
              ? []
              : jumpChoices({ questions: draft.questions, steps: draft.steps }, endings, stepId);
          // A rule still being written (no value yet) is not said: the flow shows only what a visitor would meet.
          const jumps = (stored?.jumps ?? []).flatMap((jump) => {
            const line = conditionsLine(jump.when, facts);
            return line === undefined ? [] : [{ jump, line }];
          });
          const shownIf = stored?.showWhen === undefined ? undefined : conditionsLine(stored.showWhen, facts);
          const lines = [
            ...(shownIf === undefined ? [] : [{ id: `${name}-shown`, term: strings.flowShownIf, detail: shownIf }]),
            ...jumps.map(({ jump, line }, index) => {
              const target = idOfTarget(jump.to);
              const where =
                choices.find((choice) => choice.id === target)?.label ??
                ('ending' in jump.to ? (labelOfEnding(jump.to.ending) ?? jump.to.ending) : jump.to.step);
              return {
                id: `${name}-${target}-${String(index)}`,
                term: strings.flowJump(line),
                detail: strings.flowJumpTo(where),
              };
            }),
            {
              id: `${name}-next`,
              // "Otherwise" only follows an If; a step with no rules simply goes on.
              term: jumps.length > 0 ? strings.flowNext : strings.flowThen,
              detail: nextName === undefined ? strings.flowThanks : strings.flowGoTo(nextName),
            },
          ];
          return (
            <Card
              key={stepId ?? `step-${String(place)}`}
              title={name}
              description={step.keys
                .map((key) => byKey.get(key)?.label ?? key)
                .filter((label) => label.trim() !== '')
                .join(' · ')}
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
      {isSteps && resolved.length > 0 && (
        <Card
          title={strings.flowEndings}
          actions={
            <Link href={endingsHref} onPress={close}>
              {strings.flowEdit}
            </Link>
          }
        >
          <DescriptionList
            items={[
              // The form's own end comes first: where every visitor no rule sent elsewhere finishes.
              {
                id: 'thanks',
                term: strings.flowThanks,
                description: draft.after.kind === 'redirect' ? draft.after.url : firstWords(draft.after.message),
              },
              // Each ending's first words, or nothing: its heading already names it.
              ...endings.map((ending, place) => ({
                id: ending.id,
                term: strings.endingName(place + 1, ending.heading),
                description: firstWords(ending.line ?? ''),
              })),
            ]}
          />
        </Card>
      )}
    </Modal>
  );
}
