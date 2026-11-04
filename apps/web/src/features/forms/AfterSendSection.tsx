// Brief
// Purpose: what happens after someone sends a form (T20, 5 November 2026), at the end of the Form tab's list as
// Typeform's endings and Tally's thank you page are: the thank you page everyone else gets, other endings, and sending
// people to a booking page or a link, each "depending on answers"; then the score, once a question gives points.
// Main task: say what each person sees next, in one place, with one click per outcome.
// Leaves out: which step jumps where (each step's own logic, above), and reordering (the first match wins in list
// order, which is rarely changed; Typeform hides it too).
import type { BookingPageView, FormDocument, FormTargetChoices, RoutingRule } from '@crm/data';
import { FORM_ENDINGS_MAX, ROUTING_RULES_MAX, SCORE_FACT, SCORED_TYPES, type FormEnding } from '@crm/data/forms';
import { useCaptureList } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  Callout,
  EmptyState,
  Field,
  FieldGroup,
  focusLater,
  Menu,
  MenuItem,
  MenuTrigger,
  QuestionList,
  SegmentedControl,
  Select,
  SettingsRow,
  Tooltip,
  InfoTip,
  type QuestionListItem,
  type Toasts,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { linksHref, pageEditorHref } from '../booking/links.ts';
import { ConditionsEditor } from '../routing/ConditionsEditor.tsx';
import { conditionsLine, questionFacts, readyConditions, storedShowWhen, type Fact } from '../routing/facts.ts';
import { strings as routingStrings } from '../routing/strings.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { afterPageProblem } from './after-page.ts';
import { firstWords, isRedirectAddress, mintEndingId } from './draft.ts';
import { strings } from './strings.ts';

/** The default row's id: what everyone no rule sends elsewhere gets. */
export const AFTER_ROW = 'after';
const RULE = 'rule:';
const ENDING = 'ending:';

/** The countdowns a form offers before it sends its visitor on to book (AC-1056): 0 is at once. */
const COUNTDOWNS = [0, 3, 5, 10, 15, 30] as const;

/** Props for After they send. */
export interface AfterSendSectionProps {
  readonly slug: string;
  readonly draft: FormDocument;
  readonly target: FormTargetChoices;
  readonly isReadOnly: boolean;
  readonly toasts: Toasts;
  readonly newId: () => string;
  readonly onDraftChange: (next: FormDocument | ((before: FormDocument) => FormDocument)) => void;
  /** A row to open and bring into view as the tab shows: `after`, or an ending a publish refused. */
  readonly focusRow?: string;
  /** The ending a publish refused, and why: kept open with the message. */
  readonly problem?: { readonly endingId: string; readonly message: string };
  /** A field still being typed blocks Publish: show its message whether or not it was left yet. */
  readonly showGaps: boolean;
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
 * After they send: one list of what happens, the thank you page first (everyone else), then each rule in the order it
 * is tried, then any ending only a jump reaches. Each opens in place, as a question does.
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
  const placeOf = (endingId: string) => endings.findIndex((ending) => ending.id === endingId) + 1;
  const endingRuled = new Set(rules.flatMap((rule) => (rule.then.kind === 'ending' ? [rule.then.endingId] : [])));
  const jumpedTo = new Set(
    [
      ...draft.steps.flatMap((step) => step.jumps ?? []),
      ...draft.questions.flatMap((question) => question.jumps ?? []),
    ].flatMap((jump) => ('ending' in jump.to ? [jump.to.ending] : [])),
  );
  const loose = endings.filter((ending) => !endingRuled.has(ending.id));

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // A link to a row (Publish's refusal, the Flow's Edit) opens it, once per link.
  const [focused, setFocused] = useState<string | undefined>(undefined);
  const want = props.focusRow ?? (problem === undefined ? undefined : endingRowOf(problem.endingId));
  if (want !== focused) {
    setFocused(want);
    if (want !== undefined) setOpen((before) => new Set([...before, want]));
  }
  function endingRowOf(endingId: string): string {
    const rule = rules.find((each) => each.then.kind === 'ending' && each.then.endingId === endingId);
    return rule === undefined ? `${ENDING}${endingId}` : `${RULE}${rule.id}`;
  }
  const [justAdded, setJustAdded] = useState<string | undefined>(undefined);
  const openRow = (id: string) => {
    setOpen((before) => new Set([...before, id]));
    setJustAdded(id);
  };

  const afterItem = (): QuestionListItem => {
    const after = draft.after;
    if (after.kind === 'redirect') {
      return { id: AFTER_ROW, label: strings.afterKindLink, typeIcon: 'external-link', note: after.url };
    }
    if (after.kind === 'booking') {
      const page = pageList.find((each) => each.id === after.bookingPageId);
      return {
        id: AFTER_ROW,
        label: strings.bookingRow(page?.title),
        typeIcon: 'calendar-check',
        note: strings.afterEveryone,
      };
    }
    return {
      id: AFTER_ROW,
      label: strings.thankYouPage,
      typeIcon: 'circle-check',
      note: firstWords(after.message === '' ? strings.thankYouDefault : after.message),
    };
  };
  const conditionOf = (rule: RoutingRule) => {
    const line = conditionsLine(rule.when, facts);
    return line === undefined ? {} : { condition: strings.whenLine(line) };
  };
  const ruleItem = (rule: RoutingRule): QuestionListItem => {
    const then = rule.then;
    const base = { id: `${RULE}${rule.id}`, ...conditionOf(rule) };
    switch (then.kind) {
      case 'ending': {
        const ending = endings.find((each) => each.id === then.endingId);
        return {
          ...base,
          label: strings.endingName(placeOf(then.endingId), ending?.heading),
          typeIcon: 'message-square',
          hasProblem: problem?.endingId === then.endingId,
        };
      }
      case 'book':
        return {
          ...base,
          label: strings.bookingRow(pageList.find((page) => page.id === then.bookingPageId)?.title),
          typeIcon: 'calendar-check',
        };
      case 'redirect':
        return { ...base, label: strings.linkRow(then.url), typeIcon: 'external-link' };
      default:
        return { ...base, label: strings.messageRow, typeIcon: 'message-square' };
    }
  };
  const items: readonly QuestionListItem[] = [
    afterItem(),
    ...rules.map(ruleItem),
    ...loose.map((ending) => ({
      id: `${ENDING}${ending.id}`,
      label: strings.endingName(placeOf(ending.id), ending.heading),
      typeIcon: 'message-square' as const,
      note: jumpedTo.has(ending.id) ? strings.endingByJump : strings.endingUnreached,
      hasProblem: problem?.endingId === ending.id,
    })),
  ];

  const isEndingsFull = endings.length >= FORM_ENDINGS_MAX;
  const isRulesFull = rules.length >= ROUTING_RULES_MAX;
  // A ready condition, one click from the button: complete the moment it appears (foolproof, the owner).
  const ready = () => storedShowWhen(readyConditions(facts));

  /** + Another ending: an ending, with a ready "depending on answers" rule sending people to it, opened. */
  const addEnding = () => {
    if (isEndingsFull) return;
    const endingId = mintEndingId(endings);
    const ruleId = newId();
    const withRule = facts.length > 0 && !isRulesFull;
    onDraftChange((before) => ({
      ...before,
      endings: [...(before.endings ?? []), { id: endingId, heading: '' }],
      ...(withRule
        ? {
            routing: {
              rules: [...before.routing.rules, { id: ruleId, when: ready(), then: { kind: 'ending', endingId } }],
            },
          }
        : {}),
    }));
    openRow(withRule ? `${RULE}${ruleId}` : `${ENDING}${endingId}`);
  };

  /** Send to a booking page or link: a ready rule, to the first live booking page, else to a link. */
  const addSend = () => {
    if (isRulesFull || facts.length === 0) return;
    const ruleId = newId();
    const page = usable[0];
    onDraftChange((before) => ({
      ...before,
      routing: {
        rules: [
          ...before.routing.rules,
          {
            id: ruleId,
            when: ready(),
            then:
              page === undefined
                ? { kind: 'redirect', url: 'https://' }
                : { kind: 'book', bookingPageId: page.id, message: '' },
          },
        ],
      },
    }));
    openRow(`${RULE}${ruleId}`);
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

  const listRef = useRef<HTMLButtonElement>(null);
  /** Remove a row: its rule, and its ending once nothing else leads there; Undo puts both back where they were. */
  const remove = (rowId: string) => {
    const ruleId = rowId.startsWith(RULE) ? rowId.slice(RULE.length) : undefined;
    const rule = rules.find((each) => each.id === ruleId);
    const endingId =
      rule?.then.kind === 'ending'
        ? rule.then.endingId
        : rowId.startsWith(ENDING)
          ? rowId.slice(ENDING.length)
          : undefined;
    const otherRule = rules.some(
      (each) => each.id !== ruleId && each.then.kind === 'ending' && each.then.endingId === endingId,
    );
    const dropsEnding = endingId !== undefined && !otherRule && !jumpedTo.has(endingId);
    const ruleAt = rule === undefined ? -1 : rules.indexOf(rule);
    const ending = endings.find((each) => each.id === endingId);
    const endingAt = ending === undefined ? -1 : endings.indexOf(ending);
    onDraftChange((before) => ({
      ...before,
      routing: { rules: before.routing.rules.filter((each) => each.id !== ruleId) },
      ...(dropsEnding ? { endings: (before.endings ?? []).filter((each) => each.id !== endingId) } : {}),
    }));
    focusLater(() => listRef.current);
    toasts.toast({
      tone: 'info',
      message: strings.outcomeRemoved,
      action: {
        label: strings.undo,
        onAction: () => {
          onDraftChange((before) => {
            const kept = before.endings ?? [];
            const endingsBack =
              dropsEnding && ending !== undefined && !kept.some((each) => each.id === ending.id)
                ? [...kept.slice(0, endingAt), ending, ...kept.slice(endingAt)]
                : kept;
            const rulesNow = before.routing.rules;
            const rulesBack =
              rule !== undefined && !rulesNow.some((each) => each.id === rule.id)
                ? [...rulesNow.slice(0, ruleAt), rule, ...rulesNow.slice(ruleAt)]
                : rulesNow;
            return { ...before, endings: endingsBack, routing: { rules: rulesBack } };
          });
        },
      },
    });
  };

  const sendLabel = strings.sendElsewhere;
  const canSend = !isRulesFull && facts.length > 0;
  const scored = draft.questions.some(
    (question) => question.points !== undefined && SCORED_TYPES.includes(question.answerType),
  );
  const numbers = target.items.filter((item) => item.type === 'number' && item.canWrite);

  return (
    <>
      <QuestionList
        label={strings.afterSend}
        isCountHidden
        {...(isReadOnly || !canSend
          ? {}
          : {
              wideActions: (
                <Button variant="ghost" icon="calendar-check" onPress={addSend}>
                  {sendLabel}
                </Button>
              ),
            })}
        actions={
          isReadOnly ? undefined : (
            <>
              {isEndingsFull ? (
                <Tooltip content={strings.endingsFull(FORM_ENDINGS_MAX)}>
                  <Button icon="plus" isDisabled>
                    {strings.anotherEnding}
                  </Button>
                </Tooltip>
              ) : (
                <Button ref={listRef} icon="plus" onPress={addEnding}>
                  {strings.anotherEnding}
                </Button>
              )}
              {canSend && (
                <MenuTrigger>
                  <Button variant="ghost" icon="ellipsis" label={strings.afterMenu} />
                  <Menu
                    label={strings.afterMenu}
                    onAction={(key) => {
                      if (key === 'send') addSend();
                    }}
                  >
                    <MenuItem id="send" icon="calendar-check">
                      {sendLabel}
                    </MenuItem>
                  </Menu>
                </MenuTrigger>
              )}
            </>
          )
        }
        items={items}
        openIds={open}
        onOpenChange={(id, isOpen) => {
          setOpen((before) => {
            const next = new Set(before);
            if (isOpen) next.add(id);
            else next.delete(id);
            return next;
          });
        }}
        renderOpen={(id) => {
          if (id === AFTER_ROW) {
            return (
              <AfterDefault
                slug={slug}
                draft={draft}
                pages={pages.status}
                pageList={pageList}
                usable={usable}
                isReadOnly={isReadOnly}
                showGaps={showGaps}
                onDraftChange={onDraftChange}
              />
            );
          }
          const ruleId = id.startsWith(RULE) ? id.slice(RULE.length) : undefined;
          const rule = rules.find((each) => each.id === ruleId);
          const endingId =
            rule?.then.kind === 'ending' ? rule.then.endingId : id.startsWith(ENDING) ? id.slice(ENDING.length) : '';
          const ending = endings.find((each) => each.id === endingId);
          const condition =
            rule === undefined ? null : (
              <FieldGroup label={strings.dependingOnAnswers}>
                <ConditionsEditor
                  value={rule.when}
                  facts={facts}
                  factLabel={routingStrings.question}
                  isReadOnly={isReadOnly}
                  onChange={(when) => {
                    changeRule(rule.id, (before) => ({ ...before, when: storedShowWhen(when) }));
                  }}
                />
              </FieldGroup>
            );
          if (ending !== undefined) {
            return (
              <>
                {problem?.endingId === ending.id && <Callout tone="danger">{problem.message}</Callout>}
                <EndingFields
                  ending={ending}
                  facts={facts}
                  draft={draft}
                  pages={usable}
                  isReadOnly={isReadOnly}
                  isJustAdded={justAdded === id}
                  showGaps={showGaps}
                  onChange={(next) => {
                    changeEnding(ending.id, next);
                  }}
                />
                {condition}
              </>
            );
          }
          if (rule === undefined) return null;
          return (
            <>
              <RouteFields
                rule={rule}
                usable={usable}
                pageList={pageList}
                isReadOnly={isReadOnly}
                showGaps={showGaps}
                onChange={(then) => {
                  changeRule(rule.id, (before) => ({ ...before, then }));
                }}
              />
              {condition}
            </>
          );
        }}
        renderFooterStart={(id) => {
          // An ending nothing leads to yet: one click gives it a ready rule.
          if (isReadOnly || !id.startsWith(ENDING) || facts.length === 0 || isRulesFull) return null;
          const endingId = id.slice(ENDING.length);
          return (
            <Button
              variant="ghost"
              icon="git-branch"
              onPress={() => {
                const ruleId = newId();
                onDraftChange((before) => ({
                  ...before,
                  routing: {
                    rules: [...before.routing.rules, { id: ruleId, when: ready(), then: { kind: 'ending', endingId } }],
                  },
                }));
                openRow(`${RULE}${ruleId}`);
              }}
            >
              {strings.addCondition}
            </Button>
          );
        }}
        renderFooter={(id) =>
          isReadOnly || id === AFTER_ROW ? null : (
            <Tooltip content={strings.removeOutcome}>
              <Button
                variant="ghost-danger"
                size="lg"
                icon="trash"
                label={strings.removeOutcome}
                onPress={() => {
                  remove(id);
                }}
              />
            </Tooltip>
          )
        }
      />
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
    </>
  );
}

/** Props for the thank you page's own row. */
interface AfterDefaultProps {
  readonly slug: string;
  readonly draft: FormDocument;
  readonly pages: 'ready' | 'loading' | 'error' | 'no-access';
  readonly pageList: readonly BookingPageView[];
  readonly usable: readonly BookingPageView[];
  readonly isReadOnly: boolean;
  readonly showGaps: boolean;
  readonly onDraftChange: (next: FormDocument | ((before: FormDocument) => FormDocument)) => void;
}

/** What everyone else gets (AC-570, AC-1055): the thank you page, a booking page, or a link. */
type AfterKind = FormDocument['after']['kind'];

/**
 * The thank you page, open: its words in place, and a quiet choice of what everyone no rule sends elsewhere gets
 * (the old After sending card, moved here). Switching keeps what each choice held, so going back loses nothing.
 */
function AfterDefault({
  slug,
  draft,
  pages,
  pageList,
  usable,
  isReadOnly,
  showGaps,
  onDraftChange,
}: AfterDefaultProps) {
  const seesAllPages = useCan('booking.admin');
  const after = draft.after;
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
  const pickPending = (pageId: string) => {
    setBookingPending(false);
    onDraftChange((before) => ({
      ...before,
      after: {
        kind: 'booking',
        bookingPageId: pageId,
        countdownSeconds: kept.countdownSeconds,
        message: before.after.kind === 'redirect' ? kept.message : before.after.message,
      },
    }));
  };
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
      <SegmentedControl
        label={strings.afterEveryone}
        size="compact"
        segments={[
          { value: 'message', label: strings.afterKindThanks },
          { value: 'booking', label: strings.afterKindBooking },
          { value: 'redirect', label: strings.afterKindLink },
        ]}
        value={shownKind}
        isReadOnly={isReadOnly}
        onChange={(value) => {
          if (value === 'message' || value === 'redirect' || value === 'booking') choose(value);
        }}
      />
      {isBookingPending && usable.length > 0 && (
        <Select
          label={strings.bookingPage}
          placeholder={strings.pickBookingPage}
          items={usable.map((page) => ({ id: page.id, label: strings.pageItem(page.title, page.durations[0] ?? 30) }))}
          value={null}
          isReadOnly={isReadOnly}
          onChange={(id) => {
            if (id !== null) pickPending(id);
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
      {after.kind === 'booking' && !isBookingPending && (
        <>
          {afterProblem?.kind === 'paused' && (
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
          {afterProblem?.kind === 'gone' && (
            <Callout tone="warning" title={strings.pageGoneTitle}>
              {strings.pageGone(!isReadOnly)}
            </Callout>
          )}
          <Select
            label={strings.bookingPage}
            items={[
              ...usable.map((page) => ({ id: page.id, label: strings.pageItem(page.title, page.durations[0] ?? 30) })),
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
                before.after.kind === 'booking' ? { ...before, after: { ...before.after, bookingPageId: id } } : before,
              );
            }}
          />
          <Select
            label={strings.countdown}
            items={COUNTDOWNS.map((seconds) => ({
              id: String(seconds),
              label: seconds === 0 ? strings.countdownAtOnce : strings.countdownAfter(seconds),
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
      ) : (
        <Field
          label={strings.thankYou}
          placeholder={strings.thankYouDefault}
          isMultiline
          value={after.message}
          maxLength={2_000}
          isReadOnly={isReadOnly}
          onChange={(message) => {
            onDraftChange((before) => ({
              ...before,
              after: before.after.kind === 'booking' ? { ...before.after, message } : { kind: 'message', message },
            }));
          }}
        />
      )}
    </>
  );
}

/** Props for a rule that sends people to a booking page, a link, or shows a message. */
interface RouteFieldsProps {
  readonly rule: RoutingRule;
  readonly usable: readonly BookingPageView[];
  readonly pageList: readonly BookingPageView[];
  readonly isReadOnly: boolean;
  readonly showGaps: boolean;
  readonly onChange: (then: RoutingRule['then']) => void;
}

/** Where a rule sends people: a booking page or a link (a message, kept for rules made before). */
function RouteFields({ rule, usable, pageList, isReadOnly, showGaps, onChange }: RouteFieldsProps) {
  const then = rule.then;
  const [isLeft, setLeft] = useState(false);
  if (then.kind === 'message') {
    return (
      <Field
        label={strings.thankYou}
        isMultiline
        value={then.message}
        maxLength={2_000}
        isReadOnly={isReadOnly}
        onChange={(message) => {
          onChange({ kind: 'message', message });
        }}
      />
    );
  }
  if (then.kind !== 'book' && then.kind !== 'redirect') return null;
  const chosen = then.kind === 'book' ? pageList.find((page) => page.id === then.bookingPageId) : undefined;
  const error =
    then.kind === 'redirect' && (isLeft || showGaps) && !isRedirectAddress(then.url)
      ? strings.routeIncomplete
      : undefined;
  return (
    <>
      {usable.length > 0 && (
        <SegmentedControl
          label={strings.afterEveryone}
          isLabelVisible={false}
          size="compact"
          segments={[
            { value: 'book', label: strings.afterKindBooking },
            { value: 'redirect', label: strings.afterKindLink },
          ]}
          value={then.kind}
          isReadOnly={isReadOnly}
          onChange={(value) => {
            const page = usable[0];
            if (value === 'book' && then.kind !== 'book' && page !== undefined) {
              onChange({ kind: 'book', bookingPageId: page.id, message: '' });
            }
            if (value === 'redirect' && then.kind !== 'redirect') onChange({ kind: 'redirect', url: 'https://' });
          }}
        />
      )}
      {then.kind === 'book' ? (
        <Select
          savesOnPick
          label={strings.bookingPage}
          items={[
            ...usable.map((page) => ({ id: page.id, label: strings.pageItem(page.title, page.durations[0] ?? 30) })),
            ...(chosen !== undefined && !usable.includes(chosen)
              ? [{ id: chosen.id, label: chosen.title, description: strings.pageNotUsable, isArchived: true }]
              : []),
          ]}
          value={then.bookingPageId}
          isReadOnly={isReadOnly}
          onChange={(id) => {
            // The hosts it narrows to (a team page's) stay as they were.
            if (id !== null) onChange({ ...then, bookingPageId: id });
          }}
        />
      ) : (
        <Field
          label={strings.linkAddress}
          type="url"
          value={then.url}
          isRequired
          isReadOnly={isReadOnly}
          {...(error === undefined ? {} : { error })}
          onBlur={() => {
            setLeft(true);
          }}
          onChange={(url) => {
            onChange({ kind: 'redirect', url });
          }}
        />
      )}
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
}

/** An ending (AC-6315): its heading and line, each with Insert an answer, then an optional button. */
function EndingFields({ ending, draft, pages, isReadOnly, isJustAdded, showGaps, onChange }: EndingFieldsProps) {
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
        size="compact"
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
