// Brief
// Purpose: everything about one record in one place: its details, and what happened to it.
// Main task: read and edit its details in place, and see who made it and when (the timeline grows with milestone 2).
// Leaves out: deleting and restoring it (#22), presence (#26), related records (milestone 3), notes and tasks (#19), comments (#29).
import type {
  ActivityFeed,
  AttributeDefinition,
  MemberSummary,
  ObjectSummary,
  RecordState,
  RecordSubscription,
  RecordView,
  TrashedLookup,
} from '@crm/data';
import { useActivity, useLiveStatus, useRecord } from '@crm/data/react';
import { Button, Callout, EmptyState, Link, RecordHeader, RecordLayout, TopBar } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { objectHref } from '../workspace/objects.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { ActivityTab } from './ActivityTab.tsx';
import { recordHref, recordName, type RecordTab } from './details.ts';
import { OverviewTab } from './OverviewTab.tsx';
import { RecordDetails } from './RecordDetails.tsx';
import { strings } from './strings.ts';

/** Props for the record page: what its route loaded through the data layer. */
export interface RecordPageProps {
  readonly slug: string;
  readonly tab: RecordTab;
  readonly object: ObjectSummary;
  /** The attributes Details lists. */
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  readonly recordId: string;
  /** The record, subscribed; undefined when the address names no record at all. */
  readonly record: RecordSubscription | undefined;
  readonly feed: ActivityFeed | undefined;
  readonly recent: ActivityFeed | undefined;
}

/** The page's tabs, in order. */
const TABS = [
  { id: 'overview', label: strings.overview, icon: 'layout-dashboard' as const },
  { id: 'activity', label: strings.activity, icon: 'activity' as const },
];

/** The top bar: the object's tile, and the crumbs "<Plural> › <title>" with the title as the page's h1. */
function recordTopBar(slug: string, object: ObjectSummary, title: string, children?: ReactNode, isLoading = false) {
  return (
    <TopBar
      title={title}
      icon={object.icon}
      hue={object.hue}
      crumbs={[{ id: object.id, label: object.pluralName, href: objectHref(slug, object) }]}
      isLoading={isLoading}
    >
      {children}
    </TopBar>
  );
}

/** A record that doesn't exist and one the person may not see: one state, one string (AC-376). */
function unavailablePage(slug: string, object: ObjectSummary) {
  return {
    topBar: <TopBar title={object.pluralName} icon={object.icon} hue={object.hue} />,
    body: (
      <EmptyState
        icon="search"
        title={strings.recordUnavailable}
        actions={<Link href={objectHref(slug, object)}>{strings.backTo(object.pluralName)}</Link>}
      >
        {strings.recordUnavailableText}
      </EmptyState>
    ),
  };
}

/** The record page while the record loads: the bars and the layout holding their places. */
export function RecordPendingPage() {
  return (
    <WorkspacePage
      page={{
        topBar: <TopBar title={strings.loading} isLoading />,
        body: <LoadingLayout tab="overview" />,
      }}
    />
  );
}

/** The layout with every slot showing its skeleton. */
function LoadingLayout({ tab, onTabChange }: { readonly tab: RecordTab; readonly onTabChange?: (id: string) => void }) {
  return (
    <RecordLayout
      header={<RecordHeader objectName="" isLoading />}
      tabs={TABS}
      tabsLabel={strings.tabs}
      selectedTab={tab}
      onTabChange={onTabChange ?? (() => undefined)}
      sidebarLabel={strings.details}
      sidebar={<RecordDetails attributes={[]} members={[]} record={undefined} />}
      isLoading
    >
      {null}
    </RecordLayout>
  );
}

/** A record in the trash, or not available: what `records.trashed` answered, while it asks, or that it failed. */
type TrashedCheck = TrashedLookup | { readonly status: 'checking' } | { readonly status: 'failed' };

/** Looks a record that wasn't there up in the trash, once its first read says it is missing; `retry` asks again. */
function useTrashedCheck(
  slug: string,
  recordId: string,
  state: RecordState,
): { readonly check: TrashedCheck | undefined; readonly retry: () => void } {
  const { data } = useRouteContext({ from: '__root__' });
  const [attempt, setAttempt] = useState(0);
  const [check, setCheck] = useState<{ readonly key: string; readonly answer: TrashedCheck } | undefined>(undefined);
  const key = `${slug}/${recordId}/${String(attempt)}`;
  const isMissing = state.status === 'deleted' && !state.isLost;
  useEffect(() => {
    if (!isMissing) return;
    let isCurrent = true;
    data.records.trashed(slug, recordId).then(
      (answer) => {
        if (isCurrent) setCheck({ key, answer });
      },
      () => {
        if (isCurrent) setCheck({ key, answer: { status: 'failed' } });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, recordId, key, isMissing]);
  const retry = () => {
    setAttempt((count) => count + 1);
  };
  if (!isMissing) return { check: undefined, retry };
  return { check: check?.key === key ? check.answer : { status: 'checking' }, retry };
}

/** The record page, or its unavailable state for an address that names no record. */
export function RecordPage(props: RecordPageProps) {
  const { record, feed, recent } = props;
  if (record === undefined || feed === undefined || recent === undefined) {
    return <WorkspacePage currentObject={props.object.apiSlug} page={unavailablePage(props.slug, props.object)} />;
  }
  return <SubscribedRecordPage {...props} record={record} feed={feed} recent={recent} />;
}

/** The page for a record id: every state of AC-376 from the record's subscription, its timeline and the trash. */
function SubscribedRecordPage({
  slug,
  tab,
  object,
  attributes,
  members,
  recordId,
  record,
  feed,
  recent,
}: RecordPageProps & {
  readonly record: RecordSubscription;
  readonly feed: ActivityFeed;
  readonly recent: ActivityFeed;
}) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const state = useRecord(record);
  const timeline = useActivity(feed);
  const { check: trashed, retry: checkAgain } = useTrashedCheck(slug, recordId, state);
  const live = useLiveStatus(data.live);
  const unnamed = strings.unnamed(object.singularName);

  const openTab = (next: string) => {
    if (next === tab) return;
    // Switching tabs replaces the address, so Back leaves the record rather than stepping through its tabs.
    void navigate({
      to: '/w/$slug/objects/$object/$recordId/$tab',
      params: { slug, object: object.apiSlug, recordId, tab: next },
      replace: true,
    });
  };

  // Missing or hidden (one state), whether the record's read or its timeline said so first.
  const isUnavailable =
    trashed?.status === 'unavailable' || (state.status === 'loading' && timeline.status === 'unavailable');
  if (isUnavailable) return <WorkspacePage currentObject={object.apiSlug} page={unavailablePage(slug, object)} />;

  if (state.status === 'error' || trashed?.status === 'failed') {
    const retry = () => {
      if (state.status === 'error') record.retry();
      else checkAgain();
    };
    return (
      <WorkspacePage
        currentObject={object.apiSlug}
        page={{
          topBar: recordTopBar(slug, object, object.pluralName),
          body: (
            <EmptyState tone="error" title={strings.loadFailed} onRetry={retry}>
              {state.error?.message ?? strings.loadFailedText}
            </EmptyState>
          ),
        }}
      />
    );
  }

  const shown: RecordView | undefined =
    trashed?.status === 'trashed'
      ? trashed.record
      : state.status === 'deleted' && !state.isLost
        ? undefined
        : state.record;
  if (shown === undefined) {
    return (
      <WorkspacePage
        currentObject={object.apiSlug}
        page={{
          topBar: recordTopBar(slug, object, strings.loading, undefined, true),
          body: <LoadingLayout tab={tab} onTabChange={openTab} />,
        }}
      />
    );
  }

  const isTrashed = trashed?.status === 'trashed';
  const isLost = state.status === 'deleted' && state.isLost;
  const canEdit = !isTrashed && !isLost && object.access === 'write';
  const name = recordName(shown, object, unnamed);
  const display = { ...shown.display, name };

  const copyLink = () => {
    const href = new URL(recordHref(slug, object.apiSlug, recordId, tab), window.location.origin).href;
    navigator.clipboard.writeText(href).then(
      () => {
        toasts.toast({ tone: 'success', message: strings.linkCopied });
      },
      () => {
        toasts.toast({ tone: 'danger', message: strings.copyFailed });
      },
    );
  };

  let notice: ReactNode;
  if (isTrashed) {
    notice = (
      <Callout tone="danger" placement="banner">
        {strings.wasDeleted(object.singularName)}
      </Callout>
    );
  } else if (isLost) {
    notice = (
      <Callout tone="danger" placement="banner">
        {strings.noLongerAvailable(object.singularName)}
      </Callout>
    );
  } else if (live === 'paused') {
    notice = (
      <Callout placement="banner" isAnnounced>
        {strings.livePaused}
      </Callout>
    );
  }

  return (
    <WorkspacePage
      currentObject={object.apiSlug}
      page={{
        topBar: recordTopBar(slug, object, name),
        body: (
          <RecordLayout
            header={
              <RecordHeader record={display} objectName={object.singularName}>
                <Button variant="ghost" icon="link" onPress={copyLink}>
                  {strings.copyLink}
                </Button>
              </RecordHeader>
            }
            tabs={TABS}
            tabsLabel={strings.tabs}
            selectedTab={tab}
            onTabChange={openTab}
            sidebarLabel={strings.details}
            {...(notice === undefined ? {} : { notice })}
            sidebar={
              <RecordDetails
                attributes={attributes}
                members={members}
                record={shown}
                cellErrors={state.cellErrors}
                referenceDisplays={state.referenceDisplays}
                {...(canEdit
                  ? {
                      onCommit: (attributeId: string, value: unknown) => {
                        data.records.setValue(slug, { rowId: recordId, columnId: attributeId, value });
                      },
                    }
                  : {})}
              />
            }
          >
            {tab === 'activity' ? (
              <ActivityTab feed={feed} />
            ) : (
              <OverviewTab recent={recent} activityHref={recordHref(slug, object.apiSlug, recordId, 'activity')} />
            )}
          </RecordLayout>
        ),
      }}
    />
  );
}
