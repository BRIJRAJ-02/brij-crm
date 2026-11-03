// Spec 0068: a link page's edits are a draft until Publish. Suites written before it read the page as a visitor right
// after editing it; this wraps an app so each such read sees the page as its owner would have published it just
// before (`publishLinkPageForTest`, a superuser's update on the test database). Never used outside tests.
import { publishLinkPageForTest } from '@crm/core/testing';

/** A link page's public paths, and the handle in them. */
const PUBLIC_PAGE = /^\/api\/public\/(?:handles|profiles)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:[/?]|$)/;

/** `app` with each request to a link page's public path published first. */
export function publishingReads<App extends { request: (...args: never[]) => unknown }>(
  app: App,
  adminUrl: string,
): App {
  const request = app.request.bind(app) as (...args: unknown[]) => Promise<Response> | Response;
  const wrapped = async (...args: unknown[]): Promise<Response> => {
    const [input] = args;
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : undefined;
    const handle = path === undefined ? undefined : PUBLIC_PAGE.exec(path)?.[1];
    if (handle !== undefined) await publishLinkPageForTest(adminUrl, handle);
    return request(...args);
  };
  return Object.assign(app, { request: wrapped });
}
