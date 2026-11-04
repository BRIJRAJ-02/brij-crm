// Brief
// Purpose: the Logic map (T41, AC-6325): every question and step with its rules, in the form's order, then After they
// send; what needs a look first; a few rules worth one click; and Test it, the path for answers you pick.
// Main task: read a form's logic in one place, fix what is wrong from here, and try a path before publishing.
// Leaves out: editing a rule in place (each line links to where it is edited) and the form's look.
import type { FormDocument, FormQuestion } from '@crm/data';
import { stepsOfBreaks } from '@crm/data/forms';
import { Button, Callout, Card, DescriptionList, EmptyState, Field, Link, Modal, Select, SettingsStack } from '@crm/ui';
import { useCaptureList } from '@crm/data/react';
import { useRouteContext } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { conditionsLine, questionFacts } from '../routing/facts.ts';
import { idOfTarget, jumpChoices, nextQuestionName, questionJumpChoices } from '../questions/jumps.ts';
import { strings as questionStrings } from '../questions/strings.ts';
import { strings as routingStrings } from '../routing/strings.ts';
import { firstWords } from './draft.ts';
import {
  logicSuggestions,
  problemWords,
  testPath,
  type LogicProblem,
  type LogicSuggestion,
  type TestEnd,
} from './logic.ts';
import { strings } from './strings.ts';

/** Props for the Logic map: the draft it reads, what is wrong, what it suggests, and where each part is edited. */
export interface FlowViewProps {
  readonly draft: FormDocument;
  readonly isOpen: boolean;
  readonly problems: readonly LogicProblem[];
  readonly suggestions: readonly LogicSuggestion[];
  /** The booking pages a rule may name, for their titles. */
  readonly pages: readonly { readonly id: string; readonly title: string }[];
  readonly onSuggest: (suggestion: LogicSuggestion) => void;
  /** One question's row on the Form tab, open and in view. */
  readonly questionHref: (questionId: string) => string;
  /** One step divider's row on the Form tab. */
  readonly stepHref: (stepId: string) => string;
  /** After they send, at the end of the Form tab. */
  readonly endingsHref: string;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/** A question's name, or "Untitled question". */
const nameOf = (question: FormQuestion | undefined) =>
  question === undefined || question.label.trim() === '' ? questionStrings.untitledQuestion : question.label.trim();

/**
 * The Logic map (T41; T5, 4 November 2026: "I didnt understand what happens here with steps"): one card per step a
 * visitor can reach (or one for the questions, without Steps), each question's Show only if and each of the step's
 * rules as "If … → …", then where everyone else goes ("Otherwise → Step 2"); then After they send. Above them what
 * needs a look, each with Go to; a few one click suggestions; and Test it.
 */
export function FlowView({
  draft,
  isOpen,
  problems,
  suggestions,
  pages,
  onSuggest,
  questionHref,
  stepHref,
  endingsHref,
  onOpenChange,
}: FlowViewProps) {
  const endings = draft.endings ?? [];
  const facts = questionFacts(draft.questions);
  const byKey = new Map(draft.questions.map((question) => [question.key, question]));
  const isSteps = draft.layout === 'steps';
  const resolved = isSteps
    ? stepsOfBreaks(draft.questions, draft.steps).filter((step) => step.keys.length > 0)
    : [{ id: undefined, title: undefined, keys: draft.questions.map((question) => question.key) }];
  // A link leads out of this window, so it closes behind the visitor rather than covering the row they asked for.
  const close = () => {
    onOpenChange(false);
  };
  const messageName = (id: string) => {
    const at = endings.findIndex((ending) => ending.id === id);
    return strings.endingName(at + 1, endings[at]?.heading);
  };
  const stepName = (place: number, title?: string) => questionStrings.stepName(place, title);
  const endWords = (end: TestEnd | { readonly kind: 'message' }): string => {
    switch (end.kind) {
      case 'ending':
        return messageName(end.endingId);
      case 'book':
        return strings.toPage(pages.find((page) => page.id === end.bookingPageId)?.title ?? strings.bookingPage);
      case 'redirect':
        return end.url;
      default:
        return draft.after.kind === 'redirect'
          ? draft.after.url
          : draft.after.kind === 'booking'
            ? strings.toPage(
                pages.find((page) => page.id === (draft.after.kind === 'booking' ? draft.after.bookingPageId : ''))
                  ?.title ?? strings.bookingPage,
              )
            : strings.afterKindThanks;
    }
  };

  // Where each problem is, in words, with the link that opens it.
  const problemRow = (problem: LogicProblem, index: number) => {
    const at = problem.place;
    let where: string = strings.afterSend;
    let href = endingsHref;
    if (at.kind === 'question') {
      where = nameOf(draft.questions.find((question) => question.id === at.questionId));
      href = questionHref(at.questionId);
    } else if (at.kind === 'questionJump') {
      where = nameOf(draft.questions.find((question) => question.id === at.questionId));
      href = questionHref(at.questionId);
    } else if (at.kind === 'step' || at.kind === 'jump') {
      const place = resolved.findIndex((step) => step.id === at.stepId) + 1;
      where = stepName(place, draft.steps.find((step) => step.id === at.stepId)?.title);
      href = stepHref(at.stepId);
    }
    return {
      id: `problem-${String(index)}`,
      term: where,
      description: (
        <>
          {problemWords(problem)}{' '}
          <Link href={href} onPress={close}>
            {strings.flowGoTo}
          </Link>
        </>
      ),
    };
  };

  return (
    <Modal
      variant="window"
      icon="git-branch"
      title={strings.logicTitle}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      actions={<Button slot="close">{strings.flowClose}</Button>}
    >
      <SettingsStack variant="plain">
        {problems.length > 0 && (
          <Callout tone="warning" title={strings.toCheck(problems.length)}>
            <DescriptionList layout="stacked" items={problems.map(problemRow)} />
          </Callout>
        )}
        {suggestions.length > 0 && (
          <Card title={strings.suggestionsTitle}>
            <DescriptionList
              items={suggestions.map((suggestion) => ({
                id: suggestion.id,
                term: `“${suggestion.question}”`,
                description: (
                  <>
                    {suggestion.words}{' '}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="plus"
                      onPress={() => {
                        onSuggest(suggestion);
                      }}
                    >
                      {strings.suggestionAdd}
                    </Button>
                  </>
                ),
              }))}
            />
          </Card>
        )}
        {draft.questions.length === 0 ? (
          <EmptyState title={strings.flowEmptyTitle}>{strings.flowEmpty}</EmptyState>
        ) : (
          resolved.map((step, place) => {
            const stepId = step.id;
            const name = isSteps ? stepName(place + 1, step.title) : strings.flowQuestions;
            const next = resolved[place + 1];
            const stored = stepId === undefined ? undefined : draft.steps.find((each) => each.id === stepId);
            const choices =
              stepId === undefined
                ? []
                : jumpChoices({ questions: draft.questions, steps: draft.steps }, endings, stepId);
            const shownIf = stored?.showWhen === undefined ? undefined : conditionsLine(stored.showWhen, facts);
            const questionLines = step.keys.flatMap((key) => {
              const question = byKey.get(key);
              const line = question?.showWhen === undefined ? undefined : conditionsLine(question.showWhen, facts);
              return question === undefined || line === undefined
                ? []
                : [{ id: `q-${question.id}`, term: nameOf(question), description: routingStrings.shownWhen(line) }];
            });
            const jumps = isSteps
              ? (stored?.jumps ?? []).flatMap((jump, index) => {
                  const line = conditionsLine(jump.when, facts);
                  if (line === undefined) return [];
                  const target = idOfTarget(jump.to);
                  const where =
                    choices.find((choice) => choice.id === target)?.label ??
                    ('ending' in jump.to ? messageName(jump.to.ending) : jump.to.step);
                  return [
                    {
                      id: `j-${String(index)}`,
                      term: strings.flowIf(line),
                      description: `${strings.thenArrow} ${where}`,
                    },
                  ];
                })
              : [];
            const lines: { id: string; term: string; description: ReactNode }[] = [
              ...(shownIf === undefined
                ? []
                : [{ id: 'shown', term: strings.flowThisStep, description: routingStrings.shownWhen(shownIf) }]),
              ...questionLines,
              ...jumps,
              ...(isSteps
                ? [
                    {
                      id: 'next',
                      term: jumps.length > 0 ? strings.flowOtherwise : strings.flowThen,
                      description: `${strings.thenArrow} ${next === undefined ? strings.afterSend : stepName(place + 2, next.title)}`,
                    },
                  ]
                : []),
            ];
            const first = byKey.get(step.keys[0] ?? '');
            return (
              <Card
                key={stepId ?? `step-${String(place)}`}
                title={name}
                description={questionStrings.questionCount(step.keys.length)}
                actions={
                  <Link href={stepId === undefined ? questionHref(first?.id ?? '') : stepHref(stepId)} onPress={close}>
                    {strings.flowEdit}
                  </Link>
                }
              >
                {lines.length === 0 ? <p>{strings.flowNoRules}</p> : <DescriptionList items={lines} />}
              </Card>
            );
          })
        )}
        {/* One at a time (spec 0063, AC-6313): each question with rules gets its card, "After Budget", in order. */}
        {draft.layout === 'conversational' &&
          draft.questions.flatMap((question) => {
            const jumps = question.jumps ?? [];
            if (jumps.length === 0) return [];
            const choices = questionJumpChoices(draft.questions, endings, question.id);
            const lines = jumps.flatMap((jump, index) => {
              const line = conditionsLine(jump.when, facts);
              if (line === undefined) return [];
              const where =
                choices.find((choice) => choice.id === idOfTarget(jump.to))?.label ??
                ('ending' in jump.to ? messageName(jump.to.ending) : jump.to.step);
              return [
                { id: `j-${String(index)}`, term: strings.flowIf(line), description: `${strings.thenArrow} ${where}` },
              ];
            });
            return [
              <Card
                key={`after-${question.id}`}
                title={strings.flowAfterQuestion(nameOf(question))}
                actions={
                  <Link href={questionHref(question.id)} onPress={close}>
                    {strings.flowEdit}
                  </Link>
                }
              >
                <DescriptionList
                  items={[
                    ...lines,
                    {
                      id: 'next',
                      term: lines.length > 0 ? strings.flowOtherwise : strings.flowThen,
                      description: `${strings.thenArrow} ${nextQuestionName(draft.questions, question.id) ?? strings.afterSend}`,
                    },
                  ]}
                />
              </Card>,
            ];
          })}
        <Card
          title={strings.afterSend}
          actions={
            <Link href={endingsHref} onPress={close}>
              {strings.flowEdit}
            </Link>
          }
        >
          <DescriptionList
            items={[
              ...draft.routing.rules.flatMap((rule) => {
                const line = conditionsLine(rule.when, facts);
                if (line === undefined) return [];
                const then = rule.then;
                const where =
                  then.kind === 'ending'
                    ? messageName(then.endingId)
                    : then.kind === 'book'
                      ? strings.toPage(
                          pages.find((page) => page.id === then.bookingPageId)?.title ?? strings.bookingPage,
                        )
                      : then.kind === 'redirect'
                        ? then.url
                        : strings.toMessage;
                return [{ id: rule.id, term: strings.flowIf(line), description: `${strings.thenArrow} ${where}` }];
              }),
              {
                id: 'everyone',
                term: draft.routing.rules.length > 0 ? strings.flowOtherwise : strings.flowEveryone,
                description: `${strings.thenArrow} ${endWords({ kind: 'default' })}${
                  draft.after.kind === 'message' && draft.after.message !== ''
                    ? ` · ${firstWords(draft.after.message)}`
                    : ''
                }`,
              },
            ]}
          />
        </Card>
        <TestIt draft={draft} endWords={endWords} stepName={stepName} />
      </SettingsStack>
    </Modal>
  );
}

/** The questions a form's logic reads: what Test it asks you to answer. */
function readQuestions(draft: FormDocument): readonly FormQuestion[] {
  const keys = new Set(
    [
      ...draft.questions.flatMap((question) => [
        ...(question.showWhen?.rules ?? []),
        ...(question.jumps ?? []).flatMap((jump) => jump.when.rules),
      ]),
      ...draft.steps.flatMap((step) => [
        ...(step.showWhen?.rules ?? []),
        ...(step.jumps ?? []).flatMap((jump) => jump.when.rules),
      ]),
      ...draft.routing.rules.flatMap((rule) => rule.when.rules),
    ].map((condition) => condition.key),
  );
  return draft.questions.filter((question) => keys.has(question.key));
}

/**
 * Test it (T41): an answer for each question the logic reads, picked from its real choices, and the path a visitor
 * would take: the steps they see, the ones skipped, and where they end. Nothing is sent or saved.
 */
function TestIt({
  draft,
  endWords,
  stepName,
}: {
  readonly draft: FormDocument;
  readonly endWords: (end: TestEnd) => string;
  readonly stepName: (place: number, title?: string) => string;
}) {
  const [answers, setAnswers] = useState<Readonly<Record<string, unknown>>>({});
  const asked = readQuestions(draft);
  if (asked.length === 0) return null;
  const facts = questionFacts(asked);
  const path = testPath(draft, answers);
  const titleOf = (id: string | undefined) => draft.steps.find((step) => step.id === id)?.title;
  const set = (key: string, value: unknown) => {
    setAnswers((before) => {
      const { [key]: _was, ...rest } = before;
      return value === undefined ? rest : { ...rest, [key]: value };
    });
  };
  return (
    <Card title={strings.testTitle} description={strings.testLine}>
      {asked.map((question) => {
        const fact = facts.find((each) => each.key === question.key);
        const value = answers[question.key];
        if (fact?.options !== undefined) {
          const isYesNo = fact.kind === 'yes_no';
          const picked = isYesNo
            ? value === true
              ? 'yes'
              : value === false
                ? 'no'
                : null
            : typeof value === 'string'
              ? value
              : null;
          return (
            <Select
              key={question.id}
              label={nameOf(question)}
              placeholder={strings.testNoAnswer}
              isClearable
              items={fact.options.map((option) => ({ id: option.id, label: option.label }))}
              value={picked}
              onChange={(id) => {
                set(
                  question.key,
                  id === null
                    ? undefined
                    : isYesNo
                      ? id === 'yes'
                      : question.answerType === 'multi_select'
                        ? { picked: [id] }
                        : id,
                );
              }}
            />
          );
        }
        return (
          <Field
            key={question.id}
            label={nameOf(question)}
            placeholder={strings.testNoAnswer}
            {...(fact?.kind === 'number' ? { inputMode: 'decimal' as const } : {})}
            value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
            onChange={(text) => {
              const number = Number(text);
              set(
                question.key,
                text.trim() === '' ? undefined : fact?.kind === 'number' && Number.isFinite(number) ? number : text,
              );
            }}
          />
        );
      })}
      <DescriptionList
        items={[
          ...(draft.layout === 'steps'
            ? [
                {
                  id: 'steps',
                  term: strings.testSees,
                  description: path.shown
                    .map((step) => stepName(step.place, titleOf(step.id)))
                    .join(` ${strings.thenArrow} `),
                },
                ...(path.skipped.length === 0
                  ? []
                  : [
                      {
                        id: 'skipped',
                        term: strings.testSkips,
                        description: path.skipped.map((step) => stepName(step.place, titleOf(step.id))).join(', '),
                      },
                    ]),
              ]
            : []),
          // One at a time: the questions a rule sent them past.
          ...(draft.layout === 'conversational'
            ? (() => {
                const skipped = draft.questions.filter(
                  (question) => question.answerType !== 'hidden' && !path.asked.has(question.key),
                );
                return skipped.length === 0
                  ? []
                  : [{ id: 'skipped', term: strings.testSkips, description: skipped.map(nameOf).join(', ') }];
              })()
            : []),
          { id: 'end', term: strings.testEnds, description: endWords(path.end) },
        ]}
      />
    </Card>
  );
}

/** Props for the Logic map as the editor opens it. */
export type LogicMapProps = Omit<FlowViewProps, 'pages' | 'suggestions' | 'isOpen'> & { readonly slug: string };

/**
 * The Logic map, drawn while open: it reads the workspace's live booking pages (for their names, and for a
 * suggestion that sends people on to one) only then, as After they send does.
 */
export function LogicMap({ slug, ...props }: LogicMapProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const list = useCaptureList(data.bookingPages.view(slug));
  const all = list.status === 'ready' ? list.items : [];
  const live = all.filter((page) => page.canChange && page.status === 'live');
  const suggestions = logicSuggestions(props.draft, live, {
    message: strings.suggestMessage,
    book: strings.suggestBook,
    low: strings.suggestLow,
    heading: questionStrings.newEndingHeading,
  });
  return <FlowView {...props} isOpen pages={all} suggestions={suggestions} />;
}
