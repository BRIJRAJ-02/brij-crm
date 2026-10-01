// Brief
// Purpose: prove the stack boots, from this screen through the API to Postgres.
// Main task: show whether the API and the database answer.
// Leaves out: navigation, sign in and any markup, styles or copy of its own:
// it is assembled from library components (AC-22). The theme switch sits in
// the card footer until the sidebar footer exists (#4, milestone 3), and the
// app shell then takes over the page frame.
import type { SystemStatus } from '@crm/data';
import { Card, DescriptionList, EmptyState, Link, RelativeTime, Skeleton, ThemeSwitch } from '@crm/ui';
// StatusDot shows the system's health here, not an attribute value, so the
// rule that sends attribute values through AttributeDisplay doesn't apply.
// eslint-disable-next-line no-restricted-imports -- system health, not an attribute value
import { StatusDot } from '@crm/ui';
import { useRouteContext, useRouter } from '@tanstack/react-router';
import { strings } from './strings.ts';

/** The loaded list's terms, shown while the check runs. */
const TERMS = [strings.environment, strings.postgres, strings.roundTrip, strings.checked] as const;

/** The same footer on every state, so the frame never changes and the theme is always reachable. */
function ThemeFooter() {
  const { theme } = useRouteContext({ from: '__root__' });
  return <ThemeSwitch controller={theme} />;
}

export function SystemStatusScreen({ status }: { status: SystemStatus }) {
  return (
    <Card
      placement="page"
      title={strings.product}
      description={strings.answering}
      actions={<StatusDot hue="green">{strings.healthy}</StatusDot>}
      footer={<ThemeFooter />}
    >
      <DescriptionList
        items={[
          { term: strings.environment, description: status.environment },
          { term: strings.postgres, description: status.database.serverVersion },
          { term: strings.roundTrip, description: strings.milliseconds(status.database.latencyMs) },
          { term: strings.checked, description: <RelativeTime value={status.checkedAt} /> },
        ]}
      />
    </Card>
  );
}

/** The loaded card's shape, with its labels, while the check runs. */
export function SystemStatusPending() {
  return (
    <Card placement="page" title={strings.product} description={strings.checking} footer={<ThemeFooter />} isBusy>
      <DescriptionList items={TERMS.map((term) => ({ term, description: <Skeleton width="short" /> }))} />
    </Card>
  );
}

export function SystemStatusError() {
  const router = useRouter();
  return (
    <Card placement="page" title={strings.product} footer={<ThemeFooter />}>
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => void router.invalidate()}>
        {strings.failedText}
      </EmptyState>
    </Card>
  );
}

export function NotFound() {
  return (
    <Card placement="page" title={strings.notFoundTitle} footer={<ThemeFooter />}>
      <EmptyState icon="search" title={strings.notFoundText} actions={<Link href="/">{strings.home}</Link>}>
        {strings.notFoundHint}
      </EmptyState>
    </Card>
  );
}
