import { isDataError } from '@crm/data';
import { EmptyState, Link, PageColumn, TopBar, LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ManagedPageEditor } from '../features/booking/ManagedPageEditor.tsx';
import { linksHref } from '../features/booking/links.ts';
import { managedStrings } from '../features/booking/managed-strings.ts';
import { strings } from '../features/booking/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// One managed booking page's editor (spec 0037, AC-1333 to AC-1336): the template read through the data layer's
// held list, so a change here shows in Captures › Links without a refresh. It sits outside the Captures layout
// (`captures_`), as a booking page's editor does: it needs the whole width and its own TopBar. A template the
// reader may not change answers as absent, said in the page with the way back, since only `booking.admin` and a
// template's editors reach one.
export const Route = createFileRoute('/w/$slug/captures_/managed/$templateId')({
  loader: async ({ context, params }) => {
    const [templates, everyone] = await Promise.all([
      context.data.managedPages.held(params.slug),
      // Who an admin may put on it; cached for the app load, so this costs nothing when another screen read them.
      // A failed read leaves the picker empty rather than keeping the editor out.
      context.data.members.list(params.slug).catch(() => undefined),
    ]);
    const template = templates.find((each) => each.id === params.templateId);
    return {
      ...(template === undefined ? {} : { template }),
      people: (everyone ?? []).filter((person) => person.role !== 'guest'),
    };
  },
  component: ManagedRoute,
  errorComponent: ManagedError,
  pendingComponent: ManagedPending,
});

/** The editor, or the way back when the template isn't there. */
function ManagedRoute() {
  const { template, people } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { data, toasts } = Route.useRouteContext();
  if (template === undefined) return <Missing slug={slug} title={managedStrings.notFound} />;
  return (
    <WorkspacePage
      page={{
        topBar: (
          <TopBar
            title={template.title}
            meta={managedStrings.editorTitle}
            crumbs={[{ id: 'links', label: strings.linksTitle, href: linksHref(slug) }]}
          />
        ),
        // A page of its own per id, so its draft starts afresh.
        body: (
          <PageColumn>
            <ManagedPageEditor
              key={template.id}
              data={data}
              slug={slug}
              template={template}
              people={people}
              toasts={toasts}
              onDeleted={() => void navigate({ href: linksHref(slug) })}
            />
          </PageColumn>
        ),
      }}
    />
  );
}

/** The way back, for a template that isn't there or wouldn't load. */
function Missing({
  slug,
  title,
  text,
  onRetry,
}: {
  readonly slug: string;
  readonly title: string;
  readonly text?: string;
  readonly onRetry?: () => void;
}) {
  return (
    <WorkspacePage
      page={{
        topBar: (
          <TopBar
            title={managedStrings.editorTitle}
            crumbs={[{ id: 'links', label: strings.linksTitle, href: linksHref(slug) }]}
          />
        ),
        body: (
          <PageColumn>
            <EmptyState
              tone={onRetry === undefined ? 'empty' : 'error'}
              title={title}
              {...(onRetry === undefined ? {} : { onRetry })}
              actions={<Link href={linksHref(slug)}>{strings.linksTitle}</Link>}
            >
              {text}
            </EmptyState>
          </PageColumn>
        ),
      }}
    />
  );
}

function ManagedError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const { slug } = Route.useParams();
  return (
    <Missing
      slug={slug}
      title={managedStrings.failed}
      text={isDataError(error) ? error.message : undefined}
      onRetry={() => void router.invalidate()}
    />
  );
}

function ManagedPending() {
  const { slug } = Route.useParams();
  return (
    <WorkspacePage
      page={{
        topBar: (
          <TopBar
            title={managedStrings.editorTitle}
            crumbs={[{ id: 'links', label: strings.linksTitle, href: linksHref(slug) }]}
          />
        ),
        body: (
          <PageColumn>
            <LoadingNow>{managedStrings.editorTitle}</LoadingNow>
          </PageColumn>
        ),
      }}
    />
  );
}
