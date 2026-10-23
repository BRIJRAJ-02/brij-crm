// Brief
// Purpose: the pieces every Settings › Super admin page shares (spec 0047): the period switch, a day chart, and the
// states a refused or failed read shows.
// Main task: keep the four pages one product, so a period or a refusal reads the same on each.
// Leaves out: loading anything (each route's loader reads through the data layer) and any page's own layout.
import { isDataError, type DataLayer, type OperatorPeriod } from '@crm/data';
import { useAccountSecurity } from '@crm/data/react';
import { BarStrip, Button, Callout, Card, EmptyState, Link, SegmentedControl, useFormatSettings } from '@crm/ui';
import { useNavigate, useParams, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useStepUp } from '../settings/StepUp.tsx';
import { securitySettingsHref } from '../settings/nav.ts';
import { SettingsFailed, SettingsMissing, SettingsPage } from '../settings/SettingsPage.tsx';
import { DEFAULT_PERIOD, formatters, PERIODS } from './figures.ts';
import { strings } from './strings.ts';

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
          search: (previous: Record<string, unknown>) => {
            const { period: _old, ...rest } = previous;
            return next === DEFAULT_PERIOD ? rest : { ...rest, period: next };
          },
        });
      }}
    />
  );
}

/** One series a day, as a Card holding a chart across its width, the first and last day named under it. */
export function DayChart({
  title,
  days,
  unit,
}: {
  readonly title: string;
  readonly days: readonly { readonly day: string; readonly value: number }[];
  /** What a bar counts, after its number in the tooltip: "sign ups". */
  readonly unit: string;
}) {
  const { locale } = useFormatSettings();
  const format = formatters(locale);
  const first = days[0];
  const last = days.at(-1);
  return (
    <Card title={title}>
      <BarStrip
        size="chart"
        label={title}
        bars={days.map((each) => ({
          id: each.day,
          label: strings.dayBar(format.day(each.day), format.count(each.value), unit),
          value: each.value,
        }))}
        {...(first === undefined || last === undefined
          ? {}
          : { axis: { start: format.day(first.day), end: strings.today } })}
      />
    </Card>
  );
}

/** The refusals a console read may meet that the person can act on: no two factor, or an old sign in. */
export function isHeldBack(error: unknown): boolean {
  return isDataError(error) && (error.code === 'TWO_FACTOR_REQUIRED' || error.code === 'SIGN_IN_AGAIN');
}

/**
 * A console page whose read failed: not a super admin (nothing here), two factor missing (a way to Account,
 * Sign in and devices), an old sign in (confirm it's you here), or anything
 * else (the read again, with Retry).
 */
export function AdminFailed({
  title,
  error,
  data,
}: {
  readonly title: string;
  readonly error: unknown;
  readonly data: DataLayer;
}) {
  const router = useRouter();
  const { slug = '' } = useParams({ strict: false });
  // Not a super admin (or no longer one): as for any address in Settings that names nothing.
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
        <ConfirmItsYou data={data} />
      </SettingsPage>
    );
  }
  return (
    <SettingsFailed
      title={title}
      heading={strings.failedTitle}
      text={isDataError(error) ? error.message : strings.failedTitle}
      onRetry={() => void router.invalidate()}
    />
  );
}

/** An old sign in: a step up here counts as signing in again, then the page reads again. */
function ConfirmItsYou({ data }: { readonly data: DataLayer }) {
  const router = useRouter();
  const security = useAccountSecurity(data.account.security());
  const [isChecking, setChecking] = useState(false);
  const [stillHeld, setStillHeld] = useState(false);
  const commit = useRef<() => void>(() => undefined);
  const stepUp = useStepUp(data, security, { onComplete: () => commit.current() });
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const confirm = async () => {
    setChecking(true);
    setStillHeld(false);
    const proven = await stepUp.prove();
    if (proven) await router.invalidate();
    // Still on this page once the read ran again: the sign in still counts as old.
    if (live.current) {
      setChecking(false);
      setStillHeld(proven);
    }
  };
  useEffect(() => {
    commit.current = () => {
      if (!isChecking) void confirm();
    };
  });
  return (
    <EmptyState
      icon="log-out"
      title={strings.signInTitle}
      isLoading={security.status === 'loading'}
      actions={
        <Button variant="primary" isPending={isChecking} onPress={() => commit.current()}>
          {strings.signInAction}
        </Button>
      }
    >
      {strings.signInText}
      {stepUp.fields}
      {stillHeld && (
        <Callout tone="danger" isAnnounced>
          {strings.signInText}
        </Callout>
      )}
    </EmptyState>
  );
}
