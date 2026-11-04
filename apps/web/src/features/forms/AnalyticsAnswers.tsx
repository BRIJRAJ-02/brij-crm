// Brief
// Purpose: a form's Analytics › Answers (after Sprig's results and Tally's insights): one card per question, saying
//   how many answered it, each choice, rating or yes or no with its bar, share and count, a text question's latest
//   three answers.
// Main task: read what people said at a glance, without opening each submission.
// Leaves out: a file, a signature, a ranking and a hidden question (a file or a link's tag says nothing at a
//   glance), and anything about who said it: the submission holds that.
import type { FormAnalyticsAnswer, FormQuestion } from '@crm/data';
import { Badge, Card, EmptyState, Meter, SectionBar, Table, useFormatSettings } from '@crm/ui';
import { figure, percent } from '../insights/format.ts';
import { strings as questionStrings } from '../questions/strings.ts';
import { strings } from './strings.ts';

/** One row of a question's bars: a value as words, and how many picked it. */
interface ChoiceRow {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

/** A stored value as the owner reads it: a choice's words, a number, Yes or No (Agreed for a consent). */
function valueWords(value: string | number | boolean, answerType: FormQuestion['answerType']): string {
  if (typeof value === 'boolean') {
    if (answerType === 'consent') return value ? strings.analyticsAgreed : strings.analyticsNotAgreed;
    return value ? strings.analyticsYes : strings.analyticsNo;
  }
  return String(value);
}

/**
 * The bars a question shows: every choice it offers, in its own order, even those nobody picked (Sprig's results);
 * a rating's stars and a scale's numbers in order, high to low; yes then no; anything else picked (an older choice,
 * a country) after, most picked first.
 */
export function choiceRows(question: FormQuestion, answer: FormAnalyticsAnswer): readonly ChoiceRow[] {
  const counts = new Map((answer.choices ?? []).map((each) => [String(each.value), each.count]));
  const offered: readonly string[] = (() => {
    switch (question.answerType) {
      case 'yes_no':
      case 'checkbox':
      case 'consent':
        return ['true', 'false'];
      case 'rating': {
        const top = question.options?.count ?? 5;
        return Array.from({ length: top }, (_, at) => String(top - at));
      }
      case 'scale': {
        const from = question.options?.from ?? 0;
        const to = question.options?.to ?? 10;
        return Array.from({ length: to - from + 1 }, (_, at) => String(to - at));
      }
      default:
        return question.choices ?? [];
    }
  })();
  const named = (key: string): string => {
    if (key === 'true' || key === 'false') return valueWords(key === 'true', question.answerType);
    return key;
  };
  const first = offered.map((key) => ({ id: key, name: named(key), count: counts.get(key) ?? 0 }));
  const rest = (answer.choices ?? [])
    .filter((each) => !offered.includes(String(each.value)))
    .map((each) => ({ id: String(each.value), name: valueWords(each.value, question.answerType), count: each.count }));
  return [...first, ...rest];
}

/** Props for AnalyticsAnswers. */
export interface AnalyticsAnswersProps {
  /** The live form's questions, in order: the cards follow them. */
  readonly questions: readonly FormQuestion[];
  /** Each question's answers over the period, from the server. */
  readonly answers: readonly FormAnalyticsAnswer[];
  /** The period held more submissions than were read: the cards are of the latest this many. */
  readonly latestOf?: number;
}

/** The Answers section: a heading, then a card per question the server read. */
export function AnalyticsAnswers({ questions, answers, latestOf }: AnalyticsAnswersProps) {
  const { locale } = useFormatSettings();
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  // Numbered by the question's place in the form, so "4." is the form's fourth question even when 3 has no card.
  const cards = questions.flatMap((question, at) => {
    const answer = byId.get(question.id);
    return answer === undefined ? [] : [{ question, answer, number: at + 1 }];
  });
  if (cards.length === 0) return null;
  return (
    <>
      <SectionBar
        title={strings.analyticsAnswers}
        {...(latestOf === undefined ? {} : { description: strings.analyticsAnswersLatest(figure(latestOf, locale)) })}
      />
      {cards.map(({ question, answer, number }) => {
        const label = question.label.trim() === '' ? strings.analyticsUnnamed : question.label.trim();
        const title = `${String(number)}. ${label}`;
        const responses = strings.analyticsResponses(answer.responses, figure(answer.responses, locale));
        const type = <Badge text={questionStrings.answerTypes[question.answerType]} />;
        if (answer.responses === 0) {
          return (
            <Card key={question.id} title={title} description={responses} actions={type}>
              <EmptyState layout="row" title={strings.analyticsNoAnswers} />
            </Card>
          );
        }
        if (answer.choices !== undefined) {
          const rows = choiceRows(question, answer);
          return (
            <Card key={question.id} title={title} description={responses} actions={type}>
              <Table
                label={strings.analyticsAnswersOf(label)}
                isHeaderHidden
                columns={[
                  { id: 'name', label: strings.analyticsAnswer, isRowHeader: true, size: 'fill' },
                  { id: 'bar', label: strings.analyticsBar },
                  { id: 'share', label: strings.analyticsShare, align: 'end', size: 'fit' },
                  { id: 'count', label: strings.analyticsPicked, align: 'end', size: 'fit' },
                ]}
                rows={rows}
                getRowId={(row) => `choice:${row.id}`}
                renderCell={(row, column) => {
                  switch (column) {
                    case 'name':
                      return row.name;
                    case 'bar':
                      return (
                        <Meter
                          tone="share"
                          label={row.name}
                          value={row.count}
                          maxValue={answer.responses}
                          valueText={strings.analyticsPickedOf(
                            figure(row.count, locale),
                            figure(answer.responses, locale),
                          )}
                        />
                      );
                    case 'share':
                      return percent(row.count, answer.responses, locale);
                    default:
                      return figure(row.count, locale);
                  }
                }}
              />
            </Card>
          );
        }
        // An email or a phone: how many answered, and none of them (a contact says nothing at a glance).
        if (answer.latest === undefined) {
          return <Card key={question.id} title={title} description={responses} actions={type} />;
        }
        const latest = answer.latest.map((text, at) => ({ id: String(at), text }));
        return (
          <Card key={question.id} title={title} description={responses} actions={type}>
            <Table
              label={strings.analyticsLatestOf(label)}
              isHeaderHidden
              columns={[{ id: 'text', label: strings.analyticsLatest, isRowHeader: true, size: 'fill' }]}
              rows={latest}
              getRowId={(row) => `latest:${row.id}`}
              renderCell={(row) => row.text}
            />
          </Card>
        );
      })}
    </>
  );
}
