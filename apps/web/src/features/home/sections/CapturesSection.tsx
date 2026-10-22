// Home's New captures (spec 0041): the forms that took a submission most
// recently, at most five, each opening its submissions. Read from Forms' own
// list, so it needs no read of its own; for members who manage forms.
import type { FormSummary } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import { ButtonLink, Card, EmptyState, LinkList, useFormatSettings, type LinkRow } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useMemo } from 'react';
import { latestCaptures } from '../captures.ts';
import type { HomeSectionProps } from '../registry.ts';
import { strings } from '../strings.ts';
import { locale } from './shared.tsx';

/** New captures: the latest forms to take a submission. */
export function CapturesSection({ context }: HomeSectionProps) {
  const { slug } = context;
  const { data } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const { timeZone } = useFormatSettings();
  const view = useMemo(() => data.forms.view(slug), [data, slug]);
  const state = useCaptureList<FormSummary>(view);
  const rows = useMemo((): readonly LinkRow[] => {
    if (state.status !== 'ready') return [];
    const when = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short', timeZone });
    return latestCaptures(state.items).map((form) => ({
      id: form.id,
      title: form.name,
      address: strings.captureLine(form.submissionsThisMonth, when.format(new Date(form.lastSubmissionAt))),
      chips: [],
      href: `/w/${slug}/captures/forms/${form.id}?tab=submissions`,
    }));
  }, [state, slug, timeZone]);
  return (
    <Card
      title={strings.captures}
      isBusy={state.status === 'loading'}
      actions={
        <ButtonLink variant="ghost" href={`/w/${slug}/captures/forms`}>
          {strings.allForms}
        </ButtonLink>
      }
    >
      <LinkList
        density="compact"
        placement="card"
        isToolbarHidden
        label={strings.captures}
        searchLabel={strings.captures}
        rows={rows}
        status={state.status}
        onRetry={() => {
          view.reload();
        }}
        errorTitle={strings.capturesFailed}
        emptyState={
          <EmptyState icon="inbox" title={strings.noCaptures} layout="row">
            {strings.noCapturesText}
          </EmptyState>
        }
        onOpen={(id) => {
          void navigate({
            to: '/w/$slug/captures/forms/$formId',
            params: { slug, formId: id },
            search: { tab: 'submissions' },
          });
        }}
      />
    </Card>
  );
}
