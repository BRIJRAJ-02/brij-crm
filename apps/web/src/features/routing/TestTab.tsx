// Brief
// Purpose: Routing › Test (spec 0037, AC-1392): try a submission on a form or team page and see where it would go.
// Main task: pick a surface, answer the questions its rules read (and a guest's email on a team page), run, read the result.
// Leaves out: free time (no slot is checked), editing rules (each surface's Routing card), and storing anything.
import {
  isDataError,
  type DataLayer,
  type FormQuestion,
  type RoutingRule,
  type RoutingSurface,
  type RoutingTestResult,
} from '@crm/data';
import { isRecordFact } from '@crm/data/forms';
import {
  Button,
  Callout,
  Card,
  DescriptionList,
  EmptyState,
  Field,
  Select,
  SettingsStack,
  Skeleton,
  Badge,
} from '@crm/ui';
import { useState } from 'react';
import { hiddenFieldFacts, questionFacts, type Fact } from './facts.ts';
import { skillStrings as strings } from './skills-strings.ts';

/** Props for TestTab. */
export interface TestTabProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** Overview's surfaces: every form and team page with rules, and the workspace link. */
  readonly surfaces: readonly RoutingSurface[];
}

/** What a surface's rules read that Test can ask: its questions and the visit's hidden fields, in the rules' use. */
interface Loaded {
  readonly surface: RoutingSurface;
  readonly facts: readonly Fact[];
}

/** The facts `rules` read among `facts`, in the order the facts come; record facts are the CRM's, never typed. */
function factsRead(rules: readonly RoutingRule[], facts: readonly Fact[]): readonly Fact[] {
  const read = new Set(
    rules.flatMap((rule) => rule.when.rules.map((condition) => condition.key)).filter((key) => !isRecordFact(key)),
  );
  return facts.filter((fact) => read.has(fact.key));
}

/** A surface's questions and rules, read through the data layer once it is picked. */
async function readSurface(data: DataLayer, slug: string, surface: RoutingSurface): Promise<Loaded> {
  let questions: readonly FormQuestion[];
  let rules: readonly RoutingRule[];
  if (surface.kind === 'form') {
    const form = await data.forms.get(slug, surface.id);
    const document = form.live ?? form.draft;
    questions = document.questions;
    rules = document.routing.rules;
  } else {
    const page = await data.bookingPages.get(slug, surface.id);
    questions = page.questions;
    rules = page.routing?.rules ?? [];
  }
  const kind = surface.kind === 'form' ? 'form' : 'page';
  return { surface, facts: factsRead(rules, [...questionFacts(questions), ...hiddenFieldFacts(kind)]) };
}

/** Routing › Test. */
export function TestTab({ data, slug, surfaces }: TestTabProps) {
  const [surfaceId, setSurfaceId] = useState<string | undefined>();
  const [loaded, setLoaded] = useState<Loaded | 'loading' | { readonly failed: string } | undefined>();
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<RoutingTestResult | undefined>();
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();

  const pick = (id: string | null) => {
    const surface = surfaces.find((each) => each.id === id);
    setSurfaceId(surface?.id);
    setAnswers({});
    setResult(undefined);
    setFailure(undefined);
    if (surface === undefined) {
      setLoaded(undefined);
      return;
    }
    setLoaded('loading');
    readSurface(data, slug, surface).then(
      // A later pick wins: an earlier surface's answer landing after it is dropped.
      (found) => setLoaded((now) => (now === 'loading' && surface.id === found.surface.id ? found : now)),
      (error: unknown) => setLoaded({ failed: isDataError(error) ? error.message : strings.testFailed }),
    );
  };

  const ready = typeof loaded === 'object' && 'surface' in loaded ? loaded : undefined;
  const isPage = ready?.surface.kind === 'booking_page';

  const run = () => {
    if (ready === undefined) return;
    setRunning(true);
    setFailure(undefined);
    const typed = Object.fromEntries(Object.entries(answers).filter(([, value]) => value.trim() !== ''));
    data.routing
      .test(slug, {
        surface:
          ready.surface.kind === 'form'
            ? { kind: 'form', formId: ready.surface.id }
            : { kind: 'booking_page', pageId: ready.surface.id },
        answers: typed,
        ...(isPage && email.trim() !== '' ? { email: email.trim() } : {}),
      })
      .then(
        (answer) => {
          setRunning(false);
          setResult(answer);
        },
        (error: unknown) => {
          setRunning(false);
          setResult(undefined);
          setFailure(isDataError(error) ? error.message : strings.testFailed);
        },
      );
  };

  if (surfaces.length === 0) return <EmptyState icon="flask-conical" title={strings.noSurfaces} />;
  return (
    <SettingsStack>
      <Card>
        <SettingsStack>
          <Select
            label={strings.surface}
            placeholder={strings.pickSurface}
            isSearchable
            items={surfaces.map((surface) => ({ id: surface.id, label: surface.name }))}
            value={surfaceId ?? null}
            onChange={pick}
          />
          {loaded === 'loading' && <Skeleton shape="block" />}
          {typeof loaded === 'object' && 'failed' in loaded && <Callout tone="danger">{loaded.failed}</Callout>}
          {ready?.facts.map((fact) =>
            fact.kind === 'choice' || fact.kind === 'yes_no' ? (
              <Select
                key={fact.key}
                label={fact.label}
                isClearable
                items={(fact.options ?? []).map((option) => ({ id: option.id, label: option.label }))}
                value={answers[fact.key] ?? null}
                onChange={(id) => setAnswers((now) => ({ ...now, [fact.key]: id ?? '' }))}
              />
            ) : (
              <Field
                key={fact.key}
                label={fact.label}
                {...(fact.kind === 'number' ? { inputMode: 'decimal' as const } : {})}
                value={answers[fact.key] ?? ''}
                onChange={(value) => setAnswers((now) => ({ ...now, [fact.key]: value }))}
                onSubmit={run}
              />
            ),
          )}
          {isPage && (
            <Field
              label={strings.email}
              type="email"
              placeholder={strings.emailPlaceholder}
              value={email}
              onChange={setEmail}
              onSubmit={run}
            />
          )}
          {failure !== undefined && (
            <Callout tone="danger" isAnnounced>
              {failure}
            </Callout>
          )}
          <Button variant="primary" icon="play" isDisabled={ready === undefined} isPending={running} onPress={run}>
            {running ? strings.running : strings.run}
          </Button>
        </SettingsStack>
      </Card>
      {ready !== undefined && (
        <Card title={strings.result}>
          {result === undefined ? (
            <EmptyState icon="flask-conical" title={strings.emptyResult} />
          ) : (
            <Result result={result} />
          )}
        </Card>
      )}
    </SettingsStack>
  );
}

/** Where a result goes, in words. */
function goesTo(result: RoutingTestResult): string {
  const { route, fallback } = result;
  if (route !== undefined) {
    if (route.kind === 'book') return strings.book(route.page?.name ?? '');
    if (route.kind === 'message') return strings.message;
    if (route.kind === 'redirect') return strings.redirect(route.url ?? '');
    return route.wholeRotation ? strings.wholeRotation : route.hosts.map((host) => host.name).join(', ');
  }
  if (fallback?.kind === 'page') return strings.fallbackPage(fallback.name);
  if (fallback?.kind === 'redirect') return strings.fallbackRedirect;
  if (fallback?.kind === 'rotation') return strings.fallbackRotation;
  return strings.fallbackMessage;
}

/** The result as its explanation: the rule, where it goes, who and which skills, the tag, Known, and what was skipped. */
function Result({ result }: { readonly result: RoutingTestResult }) {
  const route = result.route;
  const items = [
    {
      term: strings.rule,
      description:
        result.rule === undefined ? strings.noneMatched : strings.ruleLabel(result.rule.position, result.rule.name),
    },
    { term: strings.goesTo, description: goesTo(result) },
    ...(route !== undefined && route.kind === 'book' && route.hosts.length > 0
      ? [{ term: strings.hosts, description: route.hosts.map((host) => host.name).join(', ') }]
      : []),
    ...(route !== undefined && route.skills.length > 0
      ? [
          {
            term: strings.skillsNeeded,
            description: (
              <>
                {route.skills.map((skill) => (
                  <Badge key={skill.id} text={skill.name} />
                ))}
              </>
            ),
          },
        ]
      : []),
    ...(result.qualified === undefined
      ? []
      : [{ term: strings.tag, description: result.qualified ? strings.qualified : strings.notQualified }]),
    ...(result.known === undefined ? [] : [{ term: strings.known, description: strings.knownValue[result.known] }]),
    ...(result.skipped.length === 0 ? [] : [{ term: strings.skipped, description: result.skipped.join(', ') }]),
  ];
  return <DescriptionList layout="stacked" items={items} />;
}
