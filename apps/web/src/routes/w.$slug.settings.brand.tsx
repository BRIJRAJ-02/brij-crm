import { isDataError, type BrandStore } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BrandScreen } from '../features/settings/BrandScreen.tsx';
import { strings as brandStrings } from '../features/settings/brand-strings.ts';
import { SettingsFailed, SettingsMissing, SettingsPage } from '../features/settings/SettingsPage.tsx';
import { strings } from '../features/settings/workspace-strings.ts';

// Settings › Workspace › Brand (spec 0060, AC-1): every member reads the workspace's logo and colour; owners and
// admins change them. The store loads with the page, never in the first load, and its read starts here.
export const Route = createFileRoute('/w/$slug/settings/brand')({
  loader: async ({ context, params }): Promise<{ readonly brand: BrandStore | undefined }> => {
    const brand = await context.data.brand.load();
    try {
      await brand.readKit(params.slug);
      return { brand };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { brand: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={brandStrings.title} isLoading>
        {null}
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: BrandError,
  component: BrandRoute,
});

function BrandRoute() {
  const { brand } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  if (brand === undefined) return <SettingsMissing backTo="home" />;
  return <BrandScreen brand={brand} slug={slug} toasts={toasts} />;
}

function BrandError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={brandStrings.title}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
