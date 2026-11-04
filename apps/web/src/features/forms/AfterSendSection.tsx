// Brief
// Purpose: what happens after someone sends a form (T39, 5 November 2026), at the end of the Form tab, read as
// sentences: each rule "If Budget is Under $1k → A different thank-you message", then "Everyone else sees
// [Thank you page]"; then the score, once a question gives points.
// Main task: say what each person sees next, in one place, each part changed where it is read.
// Leaves out: which step jumps where (each step's own logic, above).
import type { BookingPageView, FormDocument, FormTargetChoices, RoutingRule } from '@crm/data';
import {
  CONDITIONS_MAX,
  FORM_ENDINGS_MAX,
  ROUTING_RULES_MAX,
  SCORE_FACT,
  SCORED_TYPES,
  type FormEnding,
} from '@crm/data/forms';
import { useCaptureList } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  Field,
  focusLater,
  InfoTip,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SectionBar,
  SegmentedControl,
  Select,
  Sentence,
  SettingsRow,
  SettingsStack,
  Tooltip,
  type Toasts,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { linksHref, pageEditorHref } from '../booking/links.ts';
import { ConditionLines, withCondition } from '../routing/ConditionLines.tsx';
import { questionFacts, storedShowWhen, type Fact } from '../routing/facts.ts';
import { stepPlaces } from '../questions/steps.ts';
import { strings as questionStrings } from '../questions/strings.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { afterPageProblem } from './after-page.ts';
import { isRedirectAddress, mintEndingId } from './draft.ts';
import { logicProblems, problemsAt, problemWords, readyRule } from './logic.ts';
import { strings } from './strings.ts';

/** The default line's id, for a link to it (the Flow's Edit, `?question=after`). */
export const AFTER_ROW = 'after';

/** The countdowns a form offers before it sends its visitor on to book (AC-1056): 0 is at once. */
const COUNTDOWNS = [0, 3, 5, 10, 15, 30] as const;

/** A rule's destination as its Select names it: a thank-you message, a booking page, or a link. */
const TO_MESSAGE = 'message';
const TO_LINK = 'link';
const TO_PAGE = 'page:';

/** Props for After they send. */
export interface AfterSendSectionProps {
  readonly slug: string;
  readonly draft: FormDocument;
  readonly target: FormTargetChoices;
  readonly isReadOnly: boolean;
  readonly toasts: Toasts;
  readonly newId: () => string;
  readonly onDraftChange: (next: FormDocument | ((before: FormDocument) => FormDocument)) => void;
  /** `after` to bring the Everyone line into focus as the tab shows (the Flow's Edit). */
  readonly focusRow?: string;
  /** The thank-you message a publish refused, and why: said on its card. */
  readonly problem?: { readonly endingId: string; readonly message: string };
  /** A field still being typed blocks Publish: show its message whether or not it was left yet. */
  readonly showGaps: boolean;
  /** A step's row on the Form tab, for Edit the rule on a thank-you message only a step sends people to. */
  readonly stepHref?: (stepId: string) => string;
  /**
   * A thank-you message's words took focus (T47, 5 November 2026): the preview shows that message in the form's
   * place while it is edited, `default` for what everyone else sees, else the ending's id.
   */
  readonly onEditEnding?: (which: 'default' | { readonly endingId: string }) => void;
}

/** The facts a rule here may read: every question, and the score once a question gives points. */
function factsOf(draft: FormDocument): readonly Fact[] {
  const scored = draft.questions.some(
    (question) => question.points !== undefined && SCORED_TYPES.includes(question.answerType),
  );
  return [
    ...questionFacts(draft.questions),
    ...(scored ? [{ key: SCORE_FACT, label: strings.scoreRow, kind: 'number' as const }] : []),
  ];
}

/**
 * After they send, as sentences (T39): the rules first, in the order they are tried ("If … → …"), each in a card
 * with its ⋯, then one quiet "+ Send some people somewhere else", then what everyone else sees. A thank-you message
 * only a step's jump reaches has its own card, saying which step sends people there.
 */
export function AfterSendSection(props: AfterSendSectionProps) {
  const { slug, draft, target, isReadOnly, toasts, newId, onDraftChange, problem, showGaps } = props;
  const { data } = useRouteContext({ from: '__root__' });
  const pages = useCaptureList(data.bookingPages.view(slug));
  const pageList: readonly BookingPageView[] = pages.status === 'ready' ? pages.items : [];
  const usable = pageList.filter((page) => page.canChange && page.status === 'live');
  const facts = factsOf(draft);
  const endings = draft.endings ?? [];
  const rules = draft.routing.rules;
  const endingRuled = new Set(rules.flatMap((rule) => (rule.then.kind === 'ending' ? [rule.then.endingId] : [])));
  const loose = endings.filter((ending) => !endingRuled.has(ending.id));
  const ready = readyRule(draft.questions, facts);
  // What is wrong with each rule (T41): a value no answer fits, a question gone, an earlier rule winning.
  const issues = logicProblems(draft);
  const isRulesFull = rules.length >= ROUTING_RULES_MAX;
  const isEndingsFull = endings.length >= FORM_ENDINGS_MAX;
  const addRef = useRef<HTMLButtonElement>(null);
  const firstRefs = useRef(new Map<string, HTMLButtonElement | null>());

  // A thank-you message switched away from is kept here, so switching back brings its words back.
  const parked = useRef(new Map<string, FormEnding>());

  /** + Send some people somewhere else: a ready rule to a new thank-you message (or a page, or a link), focused. */
  const addRule = () => {
    if (isRulesFull || ready === undefined) return;
    const ruleId = newId();
    const page = usable[0];
    const endingId = mintEndingId(endings);
    const then: RoutingRule['then'] = !isEndingsFull
      ? { kind: 'ending', endingId }
      : page === undefined
        ? { kind: 'redirect', url: 'https://' }
        : { kind: 'book', bookingPageId: page.id, message: '' };
    onDraftChange((before) => ({
      ...before,
      ...(then.kind === 'ending'
        ? { endings: [...(before.endings ?? []), { id: endingId, heading: questionStrings.newEndingHeading }] }
        : {}),
      routing: { rules: [...before.routing.rules, { id: ruleId, when: storedShowWhen(ready), then }] },
    }));
    focusLater(() => firstRefs.current.get(ruleId) ?? null);
  };

  const changeRule = (ruleId: string, change: (rule: RoutingRule) => RoutingRule) => {
    onDraftChange((before) => ({
      ...before,
      routing: { rules: before.routing.rules.map((rule) => (rule.id === ruleId ? change(rule) : rule)) },
    }));
  };
  const changeEnding = (endingId: string, next: Partial<FormEnding>) => {
    onDraftChange((before) => ({
      ...before,
      endings: (before.endings ?? []).map((ending) => {
        if (ending.id !== endingId) return ending;
        const { line, button, ...rest } = { ...ending, ...next };
        // An empty line or no button is absent, not an empty value: the document holds only what the form has.
        return {
          ...rest,
          ...(line === undefined || line.trim() === '' ? {} : { line }),
          ...(button === undefined ? {} : { button }),
        };
      }),
    }));
  };

  /** Whether a thank-you message is still needed by something other than `ruleId`: another rule, or a jump. */
  const isUsedElsewhere = (document: FormDocument, endingId: string, ruleId?: string) =>
    document.routing.rules.some(
      (each) => each.id !== ruleId && each.then.kind === 'ending' && each.then.endingId === endingId,
    ) ||
    [...document.steps.flatMap((step) => step.jumps ?? []), ...document.questions.flatMap((q) => q.jumps ?? [])].some(
      (jump) => 'ending' in jump.to && jump.to.ending === endingId,
    );

  /** A rule's destination changed: a thank-you message it leaves is parked, one it picks comes back or is made. */
  const changeDestination = (rule: RoutingRule, id: string) => {
    onDraftChange((before) => {
      const was = rule.then;
      let nextEndings = before.endings ?? [];
      if (was.kind === 'ending' && id !== TO_MESSAGE && !isUsedElsewhere(before, was.endingId, rule.id)) {
        const leaving = nextEndings.find((each) => each.id === was.endingId);
        if (leaving !== undefined) parked.current.set(rule.id, leaving);
        nextEndings = nextEndings.filter((each) => each.id !== was.endingId);
      }
      let then: RoutingRule['then'] | undefined;
      if (id === TO_MESSAGE) {
        if (was.kind === 'ending') return before;
        const kept = parked.current.get(rule.id);
        const ending =
          kept !== undefined && !nextEndings.some((each) => each.id === kept.id)
            ? kept
            : { id: mintEndingId(nextEndings), heading: questionStrings.newEndingHeading };
        if (nextEndings.length >= FORM_ENDINGS_MAX) return before;
        nextEndings = [...nextEndings, ending];
        then = { kind: 'ending', endingId: ending.id };
      } else if (id === TO_LINK) {
        then = was.kind === 'redirect' ? was : { kind: 'redirect', url: 'https://' };
      } else if (id.startsWith(TO_PAGE)) {
        // The hosts a team page's route narrows to stay as they were while the page stays the same.
        const bookingPageId = id.slice(TO_PAGE.length);
        then = was.kind === 'book' ? { ...was, bookingPageId } : { kind: 'book', bookingPageId, message: '' };
      }
      if (then === undefined) return before;
      const next = then;
      return {
        ...before,
        endings: nextEndings,
        routing: { rules: before.routing.rules.map((each) => (each.id === rule.id ? { ...each, then: next } : each)) },
      };
    });
  };

  /** Delete a rule, and its thank-you message once nothing else leads there; Undo puts both back where they were. */
  const removeRule = (rule: RoutingRule) => {
    const endingId = rule.then.kind === 'ending' ? rule.then.endingId : undefined;
    const dropsEnding = endingId !== undefined && !isUsedElsewhere(draft, endingId, rule.id);
    const ruleAt = rules.indexOf(rule);
    const ending = endings.find((each) => each.id === endingId);
    const endingAt = ending === undefined ? -1 : endings.indexOf(ending);
    onDraftChange((before) => ({
      ...before,
      routing: { rules: before.routing.rules.filter((each) => each.id !== rule.id) },
      ...(dropsEnding ? { endings: (before.endings ?? []).filter((each) => each.id !== endingId) } : {}),
    }));
    focusLater(() => addRef.current);
    toasts.toast({
      tone: 'info',
      message: strings.ruleDeleted,
      action: {
        label: strings.undo,
        onAction: () => {
          onDraftChange((before) => {
            const kept = before.endings ?? [];
            const endingsBack =
              dropsEnding && ending !== undefined && !kept.some((each) => each.id === ending.id)
                ? [...kept.slice(0, endingAt), ending, ...kept.slice(endingAt)]
                : kept;
            const now = before.routing.rules;
            const rulesBack = now.some((each) => each.id === rule.id)
              ? now
              : [...now.slice(0, ruleAt), rule, ...now.slice(ruleAt)];
            return { ...before, endings: endingsBack, routing: { rules: rulesBack } };
          });
        },
      },
    });
  };

  /** Delete a thank-you message nothing sends anyone to, with Undo. */
  const removeLoose = (ending: FormEnding) => {
    const at = endings.indexOf(ending);
    onDraftChange((before) => ({
      ...before,
      endings: (before.endings ?? []).filter((each) => each.id !== ending.id),
    }));
    focusLater(() => addRef.current);
    toasts.toast({
      tone: 'info',
      message: strings.messageDeleted,
      action: {
        label: strings.undo,
        onAction: () => {
          onDraftChange((before) => {
            const kept = before.endings ?? [];
            return kept.some((each) => each.id === ending.id)
              ? before
              : { ...before, endings: [...kept.slice(0, at), ending, ...kept.slice(at)] };
          });
        },
      },
    });
  };

  /** Send people here: a ready rule to a thank-you message nothing sends anyone to yet. */
  const ruleTo = (endingId: string) => {
    if (isRulesFull || ready === undefined) return;
    const ruleId = newId();
    onDraftChange((before) => ({
      ...before,
      routing: {
        rules: [
          ...before.routing.rules,
          { id: ruleId, when: storedShowWhen(ready), then: { kind: 'ending', endingId } },
        ],
      },
    }));
    focusLater(() => firstRefs.current.get(ruleId) ?? null);
  };

  const move = (ruleId: string, by: -1 | 1) => {
    onDraftChange((before) => {
      const list = [...before.routing.rules];
      const from = list.findIndex((each) => each.id === ruleId);
      const to = from + by;
      const moving = list[from];
      if (moving === undefined || to < 0 || to >= list.length) return before;
      list.splice(from, 1);
      list.splice(to, 0, moving);
      return { ...before, routing: { rules: list } };
    });
  };

  const destinations = (rule: RoutingRule) => {
    const then = rule.then;
    const chosen = then.kind === 'book' ? pageList.find((page) => page.id === then.bookingPageId) : undefined;
    return [
      ...(then.kind === 'ending' || !isEndingsFull ? [{ id: TO_MESSAGE, label: strings.toMessage }] : []),
      ...usable.map((page) => ({ id: `${TO_PAGE}${page.id}`, label: strings.toPage(page.title) })),
      ...(chosen !== undefined && !usable.includes(chosen)
        ? [
            {
              id: `${TO_PAGE}${chosen.id}`,
              label: strings.toPage(chosen.title),
              description: strings.pageNotUsable,
              isArchived: true,
            },
          ]
        : []),
      { id: TO_LINK, label: strings.toLink },
    ];
  };
  const destinationOf = (rule: RoutingRule): string | null => {
    switch (rule.then.kind) {
      case 'ending':
        return TO_MESSAGE;
      case 'redirect':
        return TO_LINK;
      case 'book':
        return `${TO_PAGE}${rule.then.bookingPageId}`;
      default:
        return null;
    }
  };

  const ruleCard = (rule: RoutingRule, place: number) => {
    const then = rule.then;
    const ending = then.kind === 'ending' ? endings.find((each) => each.id === then.endingId) : undefined;
    const name = strings.ruleName(place + 1);
    const canAddCondition = rule.when.rules.length < CONDITIONS_MAX;
    const isOnlyDelete = !canAddCondition && rules.length === 1;
    // Delete alone is no menu (no single item menus): the bin itself.
    const menu = isReadOnly ? undefined : isOnlyDelete ? (
      <Tooltip content={strings.deleteRule}>
        <Button
          variant="ghost-danger"
          icon="trash"
          label={`${strings.deleteRule} ${name}`}
          onPress={() => {
            removeRule(rule);
          }}
        />
      </Tooltip>
    ) : (
      <MenuTrigger>
        <Button variant="ghost" icon="ellipsis" label={strings.ruleMenu(place + 1)} />
        <Menu
          label={strings.ruleMenu(place + 1)}
          onAction={(key) => {
            if (key === 'condition') {
              changeRule(rule.id, (before) => ({ ...before, when: storedShowWhen(withCondition(before.when, facts)) }));
            }
            if (key === 'up') move(rule.id, -1);
            if (key === 'down') move(rule.id, 1);
            if (key === 'delete') removeRule(rule);
          }}
        >
          {canAddCondition && (
            <MenuItem id="condition" icon="plus">
              {strings.addCondition}
            </MenuItem>
          )}
          {place > 0 && (
            <MenuItem id="up" icon="arrow-up">
              {strings.moveUp}
            </MenuItem>
          )}
          {place < rules.length - 1 && (
            <MenuItem id="down" icon="arrow-down">
              {strings.moveDown}
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem id="delete" icon="trash" isDanger>
            {strings.deleteRule}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    );
    return (
      <Card key={rule.id}>
        {ending !== undefined && problem?.endingId === ending.id && <Callout tone="danger">{problem.message}</Callout>}
        {problemsAt(issues, { kind: 'rule', ruleId: rule.id }).map((issue) => (
          <Callout key={issue.kind} tone="warning">
            {problemWords(issue)}
          </Callout>
        ))}
        <SettingsStack variant="nested">
          <ConditionLines
            value={rule.when}
            facts={facts}
            name={name}
            isReadOnly={isReadOnly}
            firstRef={(node) => {
              firstRefs.current.set(rule.id, node);
            }}
            {...(menu === undefined ? {} : { end: menu })}
            onChange={(when) => {
              changeRule(rule.id, (before) => ({ ...before, when: storedShowWhen(when) }));
            }}
            then={
              <>
                {strings.thenArrow}
                {then.kind === 'message' ? (
                  strings.toMessage
                ) : (
                  <Select
                    label={`${strings.destination}, ${name}`}
                    isLabelHidden
                    variant="inline"
                    savesOnPick
                    items={destinations(rule)}
                    value={destinationOf(rule)}
                    isReadOnly={isReadOnly}
                    onChange={(id) => {
                      if (id !== null) changeDestination(rule, id);
                    }}
                  />
                )}
              </>
            }
          />
        </SettingsStack>
        {ending !== undefined && (
          <EndingFields
            ending={ending}
            facts={facts}
            draft={draft}
            pages={usable}
            isReadOnly={isReadOnly}
            isJustAdded={false}
            showGaps={showGaps}
            onChange={(next) => {
              changeEnding(ending.id, next);
            }}
            onFocus={() => props.onEditEnding?.({ endingId: ending.id })}
          />
        )}
        {then.kind === 'redirect' && (
          <RuleLink
            url={then.url}
            isReadOnly={isReadOnly}
            showGaps={showGaps}
            onChange={(url) => {
              changeRule(rule.id, (before) => ({ ...before, then: { kind: 'redirect', url } }));
            }}
          />
        )}
        {then.kind === 'message' && (
          <Field
            label={strings.thankYou}
            isLabelHidden
            isMultiline
            value={then.message}
            maxLength={2_000}
            isReadOnly={isReadOnly}
            onChange={(message) => {
              changeRule(rule.id, (before) => ({ ...before, then: { kind: 'message', message } }));
            }}
          />
        )}
      </Card>
    );
  };

  // The step a jump to this thank-you message sits on, for its card's line.
  const flow = { questions: draft.questions, steps: draft.steps };
  const places = stepPlaces(flow);
  const sentBy = (endingId: string): { readonly name: string; readonly stepId?: string } | undefined => {
    const step = draft.steps.find((each) =>
      (each.jumps ?? []).some((jump) => 'ending' in jump.to && jump.to.ending === endingId),
    );
    if (step !== undefined) {
      return { name: questionStrings.stepName(places.get(step.id)?.number ?? 1, step.title), stepId: step.id };
    }
    const question = draft.questions.find((each) =>
      (each.jumps ?? []).some((jump) => 'ending' in jump.to && jump.to.ending === endingId),
    );
    return question === undefined
      ? undefined
      : { name: question.label === '' ? questionStrings.untitledQuestion : question.label };
  };

  const looseCard = (ending: FormEnding) => {
    const by = sentBy(ending.id);
    const canSend = !isRulesFull && ready !== undefined;
    const menu =
      isReadOnly || by !== undefined ? undefined : !canSend ? (
        <Tooltip content={strings.deleteMessage}>
          <Button
            variant="ghost-danger"
            icon="trash"
            label={strings.messageDelete}
            onPress={() => {
              removeLoose(ending);
            }}
          />
        </Tooltip>
      ) : (
        <MenuTrigger>
          <Button variant="ghost" icon="ellipsis" label={strings.messageMenu} />
          <Menu
            label={strings.messageMenu}
            onAction={(key) => {
              if (key === 'send') ruleTo(ending.id);
              if (key === 'delete') removeLoose(ending);
            }}
          >
            <MenuItem id="send" icon="git-branch">
              {strings.sendPeopleHere}
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="delete" icon="trash" isDanger>
              {strings.deleteMessage}
            </MenuItem>
          </Menu>
        </MenuTrigger>
      );
    return (
      <Card key={ending.id}>
        {problem?.endingId === ending.id && <Callout tone="danger">{problem.message}</Callout>}
        {/* Said plainly, not as a second copy of the step's rule (UX review), with the way to that rule. */}
        <Sentence {...(menu === undefined ? {} : { end: menu })}>
          {by === undefined ? strings.nothingSendsHere : strings.sentByStep(by.name)}
          {by?.stepId !== undefined && props.stepHref !== undefined && (
            <ButtonLink variant="ghost" size="sm" href={props.stepHref(by.stepId)}>
              {strings.editTheRule}
            </ButtonLink>
          )}
        </Sentence>
        <EndingFields
          ending={ending}
          facts={facts}
          draft={draft}
          pages={usable}
          isReadOnly={isReadOnly}
          isJustAdded={false}
          showGaps={showGaps}
          onChange={(next) => {
            changeEnding(ending.id, next);
          }}
          onFocus={() => props.onEditEnding?.({ endingId: ending.id })}
        />
      </Card>
    );
  };

  const scored = draft.questions.some(
    (question) => question.points !== undefined && SCORED_TYPES.includes(question.answerType),
  );
  const numbers = target.items.filter((item) => item.type === 'number' && item.canWrite);
  const cantAdd = isRulesFull
    ? strings.rulesFull(ROUTING_RULES_MAX)
    : ready === undefined
      ? strings.sendSomeNeedsQuestion
      : undefined;

  return (
    <SettingsStack variant="plain">
      <SectionBar title={strings.afterSend} />
      {rules.map(ruleCard)}
      {loose.map(looseCard)}
      {!isReadOnly && (
        <span>
          {cantAdd === undefined ? (
            <Button ref={addRef} variant="ghost" icon="plus" onPress={addRule}>
              {strings.sendSome}
            </Button>
          ) : (
            <Tooltip content={cantAdd}>
              <Button ref={addRef} variant="ghost" icon="plus" isDisabled>
                {strings.sendSome}
              </Button>
            </Tooltip>
          )}
        </span>
      )}
      <Card>
        <AfterDefault
          slug={slug}
          draft={draft}
          pages={pages.status}
          pageList={pageList}
          usable={usable}
          hasRules={rules.length > 0 || loose.length > 0}
          isFocused={props.focusRow === AFTER_ROW}
          isReadOnly={isReadOnly}
          showGaps={showGaps}
          onDraftChange={onDraftChange}
          onEditThanks={() => props.onEditEnding?.('default')}
        />
      </Card>
      {/* The score (Typeform's): only once a question gives points, as one row. */}
      {scored && (
        <SettingsRow
          title={strings.scoreRow}
          meta={<InfoTip label={strings.scoreRow}>{strings.scoreSaveHelp}</InfoTip>}
          control="compact"
        >
          <Select
            savesOnPick
            label={strings.scoreSaveTo}
            isLabelHidden
            size="sm"
            items={[
              { id: '', label: strings.scoreFiledNowhere },
              ...numbers.map((item) => ({ id: item.attributeId, label: item.title })),
            ]}
            value={draft.scoreFiledOn?.attributeId ?? ''}
            isReadOnly={isReadOnly}
            onChange={(attributeId) => {
              onDraftChange((before) => {
                const { scoreFiledOn: _was, ...rest } = before;
                return attributeId === null || attributeId === ''
                  ? rest
                  : { ...rest, scoreFiledOn: { objectRole: 'main', attributeId } };
              });
            }}
          />
        </SettingsRow>
      )}
    </SettingsStack>
  );
}

/** A rule's link: its address, said when it is not a whole one yet. */
function RuleLink({
  url,
  isReadOnly,
  showGaps,
  onChange,
}: {
  readonly url: string;
  readonly isReadOnly: boolean;
  readonly showGaps: boolean;
  readonly onChange: (url: string) => void;
}) {
  const [isLeft, setLeft] = useState(false);
  const error = (isLeft || showGaps) && !isRedirectAddress(url) ? strings.routeIncomplete : undefined;
  return (
    <Field
      label={strings.linkAddress}
      type="url"
      value={url}
      isRequired
      isReadOnly={isReadOnly}
      {...(error === undefined ? {} : { error })}
      onBlur={() => {
        setLeft(true);
      }}
      onChange={onChange}
    />
  );
}

/** Props for what everyone else gets. */
interface AfterDefaultProps {
  readonly slug: string;
  readonly draft: FormDocument;
  readonly pages: 'ready' | 'loading' | 'error' | 'no-access';
  readonly pageList: readonly BookingPageView[];
  readonly usable: readonly BookingPageView[];
  /** Some rule sends people elsewhere: the line reads "Everyone else". */
  readonly hasRules: boolean;
  /** Brought into focus as the tab shows (a link to it). */
  readonly isFocused: boolean;
  readonly isReadOnly: boolean;
  readonly showGaps: boolean;
  readonly onDraftChange: (next: FormDocument | ((before: FormDocument) => FormDocument)) => void;
  /** The thank you's words took focus: the preview shows it. */
  readonly onEditThanks?: (() => void) | undefined;
}

/** What everyone else gets (AC-570, AC-1055): the thank you page, a booking page, or a link. */
type AfterKind = FormDocument['after']['kind'];

/**
 * "Everyone sees [Thank you page]" (T39): one sentence, its words edited under it; a booking page reads "Everyone
 * sees [A booking page] [Intro call] after [5 seconds]", a link "Everyone sees [A link] [https://…]". Switching keeps
 * what each choice held, so going back loses nothing.
 */
function AfterDefault({
  slug,
  draft,
  pages,
  pageList,
  usable,
  hasRules,
  isFocused,
  isReadOnly,
  showGaps,
  onDraftChange,
  onEditThanks,
}: AfterDefaultProps) {
  const seesAllPages = useCan('booking.admin');
  const after = draft.after;
  const kindRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isFocused) focusLater(() => kindRef.current);
  }, [isFocused]);
  const [kept, setKept] = useState({
    message: after.kind === 'redirect' ? '' : after.message,
    url: after.kind === 'redirect' ? after.url : 'https://',
    bookingPageId: after.kind === 'booking' ? after.bookingPageId : undefined,
    countdownSeconds: after.kind === 'booking' ? after.countdownSeconds : 5,
  });
  const [isAddressLeft, setAddressLeft] = useState(after.kind === 'redirect' && !isRedirectAddress(after.url));
  const redirectError =
    !isReadOnly && after.kind === 'redirect' && (isAddressLeft || showGaps) && !isRedirectAddress(after.url)
      ? strings.redirectIncomplete
      : undefined;
  // Booking is always a choice: with no live page, it shows how to make one and the form keeps doing what it did.
  const [isBookingPending, setBookingPending] = useState(false);
  const shownKind: AfterKind = isBookingPending ? 'booking' : after.kind;
  const choose = (next: AfterKind) => {
    if (next === shownKind) return;
    setBookingPending(false);
    if (next === after.kind) return;
    setAddressLeft(false);
    setKept((before) =>
      after.kind === 'redirect'
        ? { ...before, url: after.url }
        : after.kind === 'booking'
          ? {
              ...before,
              message: after.message,
              bookingPageId: after.bookingPageId,
              countdownSeconds: after.countdownSeconds,
            }
          : { ...before, message: after.message },
    );
    const pageId = usable.some((page) => page.id === kept.bookingPageId) ? kept.bookingPageId : usable[0]?.id;
    if (next === 'booking' && pageId === undefined) {
      setBookingPending(true);
      return;
    }
    const message = after.kind === 'redirect' ? kept.message : after.message;
    onDraftChange((before) => ({
      ...before,
      after:
        next === 'redirect'
          ? { kind: 'redirect', url: kept.url }
          : next === 'booking' && pageId !== undefined
            ? { kind: 'booking', bookingPageId: pageId, countdownSeconds: kept.countdownSeconds, message }
            : { kind: 'message', message },
    }));
  };
  const bookingPage = after.kind === 'booking' ? pageList.find((page) => page.id === after.bookingPageId) : undefined;
  const afterProblem = afterPageProblem(draft, pages === 'ready' ? pageList : undefined, seesAllPages);

  return (
    <>
      {after.kind === 'booking' && afterProblem?.kind === 'paused' && (
        <Callout
          tone="warning"
          title={strings.pagePausedTitle(afterProblem.page.title)}
          {...(afterProblem.page.canChange
            ? {
                actions: (
                  <ButtonLink href={pageEditorHref(slug, afterProblem.page.id)} variant="secondary">
                    {strings.openPage}
                  </ButtonLink>
                ),
              }
            : {})}
        >
          {strings.pagePaused({
            hostLeft: afterProblem.page.pausedReason === 'host_removed',
            canResume: afterProblem.page.canChange,
            canPick: !isReadOnly,
          })}
        </Callout>
      )}
      {after.kind === 'booking' && afterProblem?.kind === 'gone' && (
        <Callout tone="warning" title={strings.pageGoneTitle}>
          {strings.pageGone(!isReadOnly)}
        </Callout>
      )}
      <Sentence>
        {hasRules ? strings.everyoneElseSees : strings.everyoneSees}
        <Select
          triggerRef={kindRef}
          label={strings.everyoneGets}
          isLabelHidden
          variant="inline"
          savesOnPick
          items={[
            { id: 'message', label: strings.afterKindThanks },
            { id: 'booking', label: strings.afterKindBooking },
            { id: 'redirect', label: strings.afterKindLink },
          ]}
          value={shownKind}
          isReadOnly={isReadOnly}
          onChange={(value) => {
            if (value === 'message' || value === 'redirect' || value === 'booking') choose(value);
          }}
        />
        {after.kind === 'booking' && !isBookingPending && (
          <>
            <Select
              label={strings.bookingPage}
              isLabelHidden
              variant="inline"
              savesOnPick
              items={[
                ...usable.map((page) => ({ id: page.id, label: page.title })),
                ...(bookingPage !== undefined && !usable.includes(bookingPage)
                  ? [
                      {
                        id: bookingPage.id,
                        label: bookingPage.title,
                        description: strings.pageNotUsable,
                        isArchived: true,
                      },
                    ]
                  : []),
              ]}
              value={after.bookingPageId}
              isReadOnly={isReadOnly}
              onChange={(id) => {
                if (id === null) return;
                onDraftChange((before) =>
                  before.after.kind === 'booking'
                    ? { ...before, after: { ...before.after, bookingPageId: id } }
                    : before,
                );
              }}
            />
            <Select
              label={strings.countdown}
              isLabelHidden
              variant="inline"
              savesOnPick
              items={COUNTDOWNS.map((seconds) => ({
                id: String(seconds),
                label: seconds === 0 ? strings.countdownInLine : strings.countdownAfterInLine(seconds),
              }))}
              value={String(after.countdownSeconds)}
              isReadOnly={isReadOnly}
              onChange={(id) => {
                const seconds = Number(id);
                if (!Number.isInteger(seconds)) return;
                onDraftChange((before) =>
                  before.after.kind === 'booking'
                    ? { ...before, after: { ...before.after, countdownSeconds: seconds } }
                    : before,
                );
              }}
            />
          </>
        )}
      </Sentence>
      {isBookingPending && usable.length > 0 && (
        <Select
          label={strings.bookingPage}
          placeholder={strings.pickBookingPage}
          items={usable.map((page) => ({ id: page.id, label: strings.pageItem(page.title, page.durations[0] ?? 30) }))}
          value={null}
          isReadOnly={isReadOnly}
          onChange={(id) => {
            if (id === null) return;
            setBookingPending(false);
            onDraftChange((before) => ({
              ...before,
              after: {
                kind: 'booking',
                bookingPageId: id,
                countdownSeconds: kept.countdownSeconds,
                message: before.after.kind === 'redirect' ? kept.message : before.after.message,
              },
            }));
          }}
        />
      )}
      {isBookingPending && usable.length === 0 && (
        <EmptyState
          layout="row"
          {...(pages === 'error' ? { tone: 'error' as const } : { icon: 'link' as const })}
          isLoading={pages === 'loading'}
          title={pages === 'error' ? strings.bookingPagesFailed : strings.noBookingPages}
          {...(pages === 'ready'
            ? {
                actions: (
                  <ButtonLink href={linksHref(slug)} variant="secondary">
                    {strings.createBookingPage}
                  </ButtonLink>
                ),
              }
            : {})}
        >
          {after.kind === 'redirect' ? strings.keepsWebPage : strings.keepsMessage}
        </EmptyState>
      )}
      {isBookingPending ? null : after.kind === 'redirect' ? (
        <Field
          label={strings.linkAddress}
          {...(redirectError === undefined ? {} : { error: redirectError })}
          type="url"
          value={after.url}
          onBlur={() => {
            setAddressLeft(true);
          }}
          isRequired
          isReadOnly={isReadOnly}
          onChange={(url) => {
            onDraftChange((before) => ({ ...before, after: { kind: 'redirect', url } }));
          }}
        />
      ) : after.kind === 'message' ? (
        <Field
          label={strings.thankYou}
          isLabelHidden
          placeholder={strings.thankYouDefault}
          isMultiline
          value={after.message}
          maxLength={2_000}
          isReadOnly={isReadOnly}
          {...(onEditThanks === undefined ? {} : { onFocus: onEditThanks })}
          onChange={(message) => {
            onDraftChange((before) => ({ ...before, after: { kind: 'message', message } }));
          }}
        />
      ) : null}
    </>
  );
}

/** Props for an ending's own words and button. */
interface EndingFieldsProps {
  readonly ending: FormEnding;
  readonly facts: readonly Fact[];
  readonly draft: FormDocument;
  readonly pages: readonly BookingPageView[];
  readonly isReadOnly: boolean;
  readonly isJustAdded: boolean;
  readonly showGaps: boolean;
  readonly onChange: (change: Partial<FormEnding>) => void;
  /** Its words took focus: the preview shows it. */
  readonly onFocus?: (() => void) | undefined;
}

/** An ending (AC-6315): its heading and line, each with Insert an answer, then an optional button. */
function EndingFields({
  ending,
  draft,
  pages,
  isReadOnly,
  isJustAdded,
  showGaps,
  onChange,
  onFocus,
}: EndingFieldsProps) {
  const headingRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const lineRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // A new ending's heading takes focus as it opens, so its words are typed at once.
  useEffect(() => {
    if (isJustAdded) focusLater(() => headingRef.current);
  }, [isJustAdded]);
  const kind = ending.button?.kind ?? 'none';
  const firstPage = pages[0]?.id;
  const [isLeft, setLeft] = useState(false);
  const urlError =
    ending.button?.kind === 'url' && (isLeft || showGaps) && !isRedirectAddress(ending.button.url)
      ? strings.routeIncomplete
      : undefined;
  return (
    <>
      <Field
        ref={headingRef}
        label={strings.endingHeading}
        size="lg"
        placeholder={strings.endingHeadingPlaceholder}
        value={ending.heading}
        maxLength={120}
        isReadOnly={isReadOnly}
        {...(onFocus === undefined ? {} : { onFocus })}
        {...(isReadOnly
          ? {}
          : {
              info: (
                <InsertAnswer
                  draft={draft}
                  field={headingRef}
                  onInsert={(heading) => {
                    onChange({ heading });
                  }}
                />
              ),
            })}
        onChange={(heading) => {
          onChange({ heading });
        }}
      />
      <Field
        ref={lineRef}
        label={strings.endingLine}
        placeholder={strings.endingLinePlaceholder}
        value={ending.line ?? ''}
        maxLength={2_000}
        isMultiline
        isReadOnly={isReadOnly}
        {...(onFocus === undefined ? {} : { onFocus })}
        {...(isReadOnly
          ? {}
          : {
              info: (
                <InsertAnswer
                  draft={draft}
                  field={lineRef}
                  onInsert={(line) => {
                    onChange({ line });
                  }}
                />
              ),
            })}
        onChange={(line) => {
          onChange({ line });
        }}
      />
      <SegmentedControl
        label={strings.endingButton}
        isLabelVisible
        size="compact"
        isFitted
        segments={[
          { value: 'none', label: strings.endingButtonNone },
          { value: 'url', label: strings.endingButtonUrl },
          ...(firstPage === undefined ? [] : [{ value: 'booking', label: strings.endingButtonBooking }]),
        ]}
        value={kind}
        isReadOnly={isReadOnly}
        onChange={(next) => {
          if (next === 'url') onChange({ button: { kind: 'url', url: 'https://' } });
          else if (next === 'booking' && firstPage !== undefined) {
            onChange({ button: { kind: 'booking', bookingPageId: firstPage } });
          } else onChange({ button: undefined });
        }}
      />
      {ending.button?.kind === 'url' && (
        <Field
          label={strings.endingAddress}
          value={ending.button.url}
          maxLength={2_048}
          isReadOnly={isReadOnly}
          {...(urlError === undefined ? {} : { error: urlError })}
          onBlur={() => {
            setLeft(true);
          }}
          onChange={(url) => {
            onChange({
              button: {
                kind: 'url',
                url,
                ...(ending.button?.label === undefined ? {} : { label: ending.button.label }),
              },
            });
          }}
        />
      )}
      {ending.button?.kind === 'booking' && (
        <Select
          savesOnPick
          label={strings.endingButtonBooking}
          items={pages.map((page) => ({ id: page.id, label: page.title }))}
          value={ending.button.bookingPageId}
          isReadOnly={isReadOnly}
          onChange={(bookingPageId) => {
            if (bookingPageId !== null) onChange({ button: { kind: 'booking', bookingPageId } });
          }}
        />
      )}
      {ending.button !== undefined && (
        <Field
          label={strings.endingButtonLabel}
          placeholder={strings.endingButtonLabelPlaceholder}
          value={ending.button.label ?? ''}
          maxLength={40}
          isReadOnly={isReadOnly}
          onChange={(label) => {
            const button = ending.button;
            if (button === undefined) return;
            onChange({ button: { ...button, ...(label === '' ? { label: undefined } : { label }) } });
          }}
        />
      )}
    </>
  );
}

/**
 * Insert an answer (T20: nobody types {{key}}): a small menu of the form's questions, and the score when a question
 * gives points, that puts the answer into the text where the caret was. The text keeps `{{key}}`, which the hosted
 * page fills in with the visitor's answer.
 */
function InsertAnswer({
  draft,
  field,
  onInsert,
}: {
  readonly draft: FormDocument;
  readonly field: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>;
  readonly onInsert: (text: string) => void;
}) {
  const scored = draft.questions.some(
    (question) => question.points !== undefined && SCORED_TYPES.includes(question.answerType),
  );
  const choices = [
    ...draft.questions
      .filter((question) => !['file', 'signature', 'consent'].includes(question.answerType))
      .map((question) => ({
        id: question.key,
        label: question.label.trim() === '' ? question.key : question.label,
      })),
    ...(scored ? [{ id: SCORE_FACT, label: strings.insertScore }] : []),
  ];
  if (choices.length === 0) return null;
  return (
    <MenuTrigger>
      <Button variant="ghost" size="sm" icon="at-sign">
        {strings.insertAnswer}
      </Button>
      <Menu
        label={strings.insertAnswer}
        onAction={(key) => {
          const input = field.current;
          const token = `{{${String(key)}}}`;
          const text = input?.value ?? '';
          const start = input?.selectionStart ?? text.length;
          const end = input?.selectionEnd ?? text.length;
          const before = text.slice(0, start);
          const spaced = before === '' || /\s$/.test(before) ? token : ` ${token}`;
          onInsert(`${before}${spaced}${text.slice(end)}`);
          const caret = before.length + spaced.length;
          focusLater(() => {
            input?.setSelectionRange(caret, caret);
            return input;
          });
        }}
      >
        {choices.map((choice) => (
          <MenuItem key={choice.id} id={choice.id}>
            {choice.label}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}
