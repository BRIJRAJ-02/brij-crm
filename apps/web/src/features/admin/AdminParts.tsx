// Brief
// Purpose: the pieces every Settings › Super admin page shares (spec 0047): the period switch, a day chart, and the
// states a refused or failed read shows.
// Main task: keep the four pages one product, so a period, a chart or a refusal reads the same on each.
// Leaves out: loading anything (the data layer holds each read; the screens show its state) and any page's layout.
import { isDataError, type DataLayer, type Me, type OperatorPeriod } from '@crm/data';
import { useAccountSecurity } from '@crm/data/react';
import { BarStrip, Button, Callout, Card, EmptyState, Link, Modal, SegmentedControl, useFormatSettings } from '@crm/ui';
import { useMatch, useNavigate, useParams, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useStepUp } from '../settings/StepUp.tsx';
import { securitySettingsHref } from '../settings/nav.ts';
import { SettingsFailed, SettingsMissing, SettingsPage } from '../settings/SettingsPage.tsx';
import { DEFAULT_PERIOD, formatters, PERIOD_LENGTH, PERIODS } from './figures.ts';
import { strings } from './strings.ts';

/** Whether the signed in person is a super admin, as `me.get` said (the server checks every read again). */
export function useIsOperator(): boolean {
  return (
    useMatch({
      from: '/w/$slug',
      shouldThrow: false,
      select: (frame): boolean => (frame.context.me as Me | undefined)?.isOperator === true,
    }) ?? false
  );
}

/** The period switch in a console page's bar: 7, 30 or 90 days, kept in the address. */
export function PeriodSwitch({ period }: { readonly period: OperatorPeriod }) {
  const navigate = useNavigate();
  return (
    <SegmentedControl
      label={strings.period.label}
      size="compact"
      value={period}
      segments={PERIODS.map((value) => ({ value, label: strings.period.options[value] }))}
      onChange={(value) => {
        const next = PERIODS.find((each) => each === value) ?? DEFAULT_PERIOD;
        void navigate({
          to: '.',
          replace: true,
          resetScroll: false,
          search: (previous: Record<string, unknown>) => {
            const { period: _old, ...rest } = previous;
            return next === DEFAULT_PERIOD ? rest : { ...rest, period: next };
          },
        });
      }}
    />
  );
}

/** One day's value in a chart. */
export interface ChartDay {
  readonly day: string;
  readonly value: number;
}

/**
 * One series a day, as a Card holding a chart across its width, the first day and Today under it, and its total
 * and busiest day in words over it (bars name their day and count only to a pointer or a screen reader). While
 * loading (`days` undefined), the period's days as empty stubs, so the page keeps its shape.
 */
export function DayChart({
  title,
  days,
  period,
  unit,
  barLabel,
  summary,
}: {
  readonly title: string;
  readonly days: readonly ChartDay[] | undefined;
  readonly period: OperatorPeriod;
  /** What a bar counts, after its number: "sign ups". */
  readonly unit: string;
  /** A bar's words in place of "<day>: <count> <unit>". */
  readonly barLabel?: (day: string, value: number) => string;
  /** The line over the chart in place of its total and busiest day. */
  readonly summary?: (days: readonly ChartDay[]) => string;
}) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  const shown = days ?? Array.from({ length: PERIOD_LENGTH[period] }, (_, index) => ({ day: String(index), value: 0 }));
  const first = days?.[0];
  const busiest = days?.reduce<ChartDay | undefined>(
    (best, each) => (best === undefined || each.value > best.value ? each : best),
    undefined,
  );
  const total = days?.reduce((sum, each) => sum + each.value, 0) ?? 0;
  const description =
    days === undefined
      ? undefined
      : summary !== undefined
        ? summary(days)
        : busiest === undefined || total === 0
          ? strings.chartQuiet
          : strings.chartSummary(format.count(total), format.day(busiest.day), format.count(busiest.value));
  return (
    <Card title={title} isBusy={days === undefined} {...(description === undefined ? {} : { description })}>
      <BarStrip
        size="chart"
        label={title}
        bars={shown.map((each) => ({
          id: each.day,
          label:
            days === undefined
              ? title
              : barLabel !== undefined
                ? barLabel(format.day(each.day), each.value)
                : strings.dayBar(format.day(each.day), format.count(each.value), unit),
          value: each.value,
        }))}
        {...(first === undefined ? {} : { axis: { start: format.day(first.day), end: strings.today } })}
      />
    </Card>
  );
}

/**
 * A console page whose read was refused or failed: not a super admin (Settings' "nothing here"), two factor
 * missing (a way to Account, Sign in and devices), a session not proven with the app lately (confirm it's you,
 * here), or anything else (Retry).
 */
export function AdminFailed({
  title,
  error,
  data,
  onRetry,
}: {
  readonly title: string;
  readonly error: unknown;
  readonly data: DataLayer;
  readonly onRetry: () => void;
}) {
  const { slug = '' } = useParams({ strict: false });
  if (isDataError(error) && error.code === 'NOT_FOUND') return <SettingsMissing backTo="home" />;
  if (isDataError(error) && error.code === 'TWO_FACTOR_REQUIRED') {
    return (
      <SettingsPage title={title}>
        <EmptyState
          icon="shield-check"
          title={strings.twoFactorTitle}
          actions={<Link href={securitySettingsHref(slug)}>{strings.twoFactorAction}</Link>}
        >
          {strings.twoFactorText}
        </EmptyState>
      </SettingsPage>
    );
  }
  if (isDataError(error) && error.code === 'SIGN_IN_AGAIN') {
    return (
      <SettingsPage title={title}>
        <ConfirmItsYou data={data} onConfirmed={onRetry} />
      </SettingsPage>
    );
  }
  return (
    <SettingsFailed
      title={title}
      heading={strings.failedTitle}
      text={isDataError(error) ? error.message : strings.failedTitle}
      onRetry={onRetry}
    />
  );
}

/** A session not proven with the app lately: a code from the app, in a dialog, then the page reads again. */
function ConfirmItsYou({ data, onConfirmed }: { readonly data: DataLayer; readonly onConfirmed: () => void }) {
  const router = useRouter();
  const security = useAccountSecurity(data.account.security());
  const [isOpen, setOpen] = useState(false);
  const [isChecking, setChecking] = useState(false);
  const [stillHeld, setStillHeld] = useState(false);
  const commit = useRef<() => void>(() => undefined);
  const stepUp = useStepUp(data, security, { secondFactor: true, onComplete: () => commit.current() });
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const isMounted = () => live.current;
  const confirm = async () => {
    setChecking(true);
    setStillHeld(false);
    const proven = await stepUp.prove();
    if (!isMounted()) return;
    setChecking(false);
    if (!proven) return;
    setOpen(false);
    onConfirmed();
    await router.invalidate();
    // Still here once the page read again: the code didn't count for these pages.
    if (isMounted()) setStillHeld(true);
  };
  useEffect(() => {
    commit.current = () => {
      if (!isChecking) void confirm();
    };
  });
  return (
    <EmptyState
      icon="shield-check"
      title={strings.signInTitle}
      isLoading={security.status === 'loading'}
      actions={
        <Button
          variant="primary"
          onPress={() => {
            stepUp.reset();
            setOpen(true);
          }}
        >
          {strings.signInAction}
        </Button>
      }
    >
      {strings.signInText}
      {stillHeld && (
        <Callout tone="danger" isAnnounced>
          {strings.stillHeld}
        </Callout>
      )}
      <Modal
        title={strings.confirmTitle}
        isOpen={isOpen}
        isBusy={isChecking}
        onOpenChange={(open) => {
          if (!open && !isChecking) setOpen(false);
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC" isDisabled={isChecking}>
              {strings.cancel}
            </Button>
            <Button variant="primary" isPending={isChecking} onPress={() => commit.current()}>
              {strings.confirm}
            </Button>
          </>
        }
      >
        {strings.confirmText}
        {stepUp.fields}
      </Modal>
    </EmptyState>
  );
}
