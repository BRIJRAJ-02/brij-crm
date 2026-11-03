// Brief
// Purpose: what an Insights share link opens (spec 0067, AC-6720), signed in as no one: the workspace's numbers for
//   the pages the link names, over its range.
// Main task: a client or partner reads how the pages are doing.
// Leaves out: every person: no sessions, names, emails, free text answers, Other's sites or landing parameters;
//   changing the period or the pages (the link fixes both); and any way into the workspace.
import type { DataError, SharedInsights } from '@crm/data';
import { EmptyState, PageColumn, Skeleton, Stats, TopBar } from '@crm/ui';
import { InsightsBody } from './InsightsBody.tsx';
import { strings } from './strings.ts';

/** The shared page. */
export function SharedInsightsScreen({ shared }: { readonly shared: SharedInsights }) {
  return (
    <>
      <TopBar
        title={shared.label}
        icon="chart-line"
        meta={`${strings.sharedBy(shared.workspaceName)} · ${strings.ranges[shared.range]} · ${shared.pageNames.join(', ')}`}
      />
      <PageColumn>
        <InsightsBody numbers={shared.numbers} />
      </PageColumn>
    </>
  );
}

/** The shared page while it loads. */
export function SharedInsightsPending() {
  return (
    <>
      <TopBar title={strings.insights} icon="chart-line" isLoading />
      <PageColumn>
        <Stats label={strings.summary} items={[]} isLoading />
        <Skeleton shape="fill" />
      </PageColumn>
    </>
  );
}

/** A link that opens nothing (revoked, expired, wrong), or one that couldn't load. */
export function SharedInsightsError({ error }: { readonly error: DataError | undefined }) {
  const gone = error?.code === 'NOT_FOUND';
  return (
    <PageColumn align="center">
      <EmptyState
        icon={gone ? 'unlink' : 'circle-alert'}
        title={gone ? strings.sharedGoneTitle : strings.sharedFailed}
        {...(gone ? {} : { tone: 'error' as const })}
      >
        {gone ? strings.sharedGoneText : (error?.message ?? '')}
      </EmptyState>
    </PageColumn>
  );
}
