// An export's download (spec 0023's submissions export, in spec 0040's shape):
// `GET /api/exports/:exportId/download?workspace=<slug>`, a plain route the
// browser navigates to with its session cookie. The member door decides who
// is asking; only the member who started the export, while it is kept, gets
// the file, streamed chunk by chunk (`text/csv; charset=utf-8`, an
// attachment, never cached, never sniffed). Anyone else gets the same 404, so
// the route never says whether an export exists.
import { exportFile, exportPart, isRefusal } from '@crm/core';
import type { Context, Env, Hono } from 'hono';
import type { Auth } from '../auth/auth.ts';
import { errorFields, log } from '../log.ts';

/** The member door, as the RPC's `member` base opens it. */
type Enter = (userId: string, slug: string) => Promise<Parameters<typeof exportFile>[0]>;

/** What the download needs: sign in and the member door. */
export interface ExportRouteDeps {
  readonly auth: Auth;
  readonly enter: Enter;
}

const NOT_FOUND = { code: 'NOT_FOUND', message: 'This export doesn’t exist, or it has expired. Export again.' };

/** A file name as a header carries it: ASCII in `filename`, the full name in `filename*`. */
function disposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_');
  // RFC 8187 allows no `'`, `(`, `)`, `*` or `!` unescaped in `filename*`; encodeURIComponent leaves them.
  const encoded = encodeURIComponent(fileName).replace(
    /['()*!]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Mounts the download on an app whose base path is `/api`. */
export function mountExports<E extends Env & { Variables: { clientIp: string | undefined; requestId: string } }>(
  app: Hono<E>,
  deps: ExportRouteDeps,
): void {
  app.get('/exports/:exportId/download', async (c: Context<E>) => {
    const slug = c.req.query('workspace');
    const exportId = c.req.param('exportId') ?? '';
    const session = await deps.auth.session(c.req.raw.headers, c.get('clientIp'));
    if (session === undefined || slug === undefined) return c.json(NOT_FOUND, 404);
    for (const cookie of session.setCookies) c.header('set-cookie', cookie, { append: true });
    try {
      const scope = await deps.enter(session.user.id, slug);
      const file = await exportFile(scope, { exportId });
      let part = 0;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (part >= file.parts) {
            controller.close();
            return;
          }
          try {
            controller.enqueue(encoder.encode(await exportPart(scope, { exportId, part })));
            part += 1;
          } catch (error) {
            log.error('export.download_failed', { requestId: c.get('requestId'), ...errorFields(error) });
            controller.error(error);
          }
        },
      });
      // Through the context, so a refreshed session cookie set above goes with the file.
      return c.body(body, 200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': disposition(file.fileName),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      });
    } catch (error) {
      if (isRefusal(error)) return c.json(NOT_FOUND, 404);
      throw error;
    }
  });
}
