// File answers on public forms (#32). Three routes, all under /api:
// - `POST /public/forms/:publicKey/uploads`: a visitor's file, the request body itself (`content-type` its type,
//   `x-file-name` its name, percent encoded). Untrusted, so the order is: the instance ceiling, the address and its
//   form, the page's own Origin (a listed site's file goes nowhere here), the per address, workspace and form limits,
//   the declared size, the body read to at most 4 MiB, then the type against the allowlist, the first bytes against
//   the type, the name made safe, the form's open uploads, and only then the store. The object is keyed
//   `forms/<workspace>/<form>/<random id>.<ext>`, so nothing in it is guessable or visitor made.
// - `DELETE /public/forms/:publicKey/uploads/:fileId`: a visitor removing their own unattached file.
// - `POST /records/:recordId/fields/:attributeId/file?workspace=<slug>`: a member attaching a file to a record's
//   `file` cell (27 Oct 2026). The session authenticated sibling of the public route, with the same body ceiling,
//   type allowlist, first byte check and name cleaning, its own limits (per member and per instance), and the same
//   degrading when `BLOB_READ_WRITE_TOKEN` is unset (503). The core checks the record and the field before a byte
//   is stored, and again before the row lands.
// - `POST /records/:recordId/files?workspace=<slug>`: a member adding a file to a record's Files tab (#32, the
//   crm-files lane). The same order as a cell's: the instance ceiling, the session, the per member limit, the declared
//   size, the type, the body to at most 4 MiB, the first bytes, then a name with an executable extension anywhere in
//   it refused (`hasExecutableName`), the name cleaned; the core checks the record (seen, its object writable, live),
//   the record's cap and the workspace's storage before a byte is stored, and again under the workspace's lock when
//   the row and its `files` outbox row land; the relay is woken once that commits. `x-crm-mutation-id` (a uuid the
//   tab minted) rides in the event, so the tab that sent it skips its own echo.
// - `GET /files/:fileId?workspace=<slug>`: a member's download, through the session and the member door. The core
//   decides: a record's own file first (a Files tab file: the record is theirs to see; a cell's: the field isn't
//   hidden from them either), else a submission's upload (attached to a submission the member may open and among the
//   answers they may see). Anyone else gets the same 404. The bytes stream from the private store as an attachment,
//   never sniffed, never cached; `&inline=1` shows a PNG, JPEG, GIF or WebP in the tab instead (`opensInline`), with
//   the same headers. No URL here is a credential: every read is the session and the door, so a link kept after the
//   reader lost access, or pasted elsewhere, opens nothing.
// Nothing here logs a file name or its content.
import { randomUUID } from 'node:crypto';
import {
  ERROR_MAP,
  FORM_UPLOAD_MAX_BYTES,
  formStrings,
  hasExecutableName,
  matchesContent,
  opensInline,
  RECORD_FILE_MAX_BYTES,
  sanitiseFileName,
  storedNameOf,
  UPLOAD_NAME_HEADER,
  uploadTypeOf,
  type ErrorCode,
  type UploadedFile,
} from '@crm/contracts';
import {
  ATTACHMENT_REFUSALS,
  discardUpload,
  enterPublicForm,
  isRefusal,
  prepareAttachment,
  prepareRecordFile,
  prepareUpload,
  readRecordFile,
  readUpload,
  recordFilePath,
  registerAttachment,
  registerRecordFile,
  registerUpload,
} from '@crm/core';
import type { Database } from '@crm/db';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Auth, AuthSession } from '../auth/auth.ts';
import { commitWrite } from '../hooks.ts';
import { errorFields, log } from '../log.ts';
import { captureFault } from '../monitoring/sentry.ts';
import { RECORD_FILE_LIMITS, UPLOAD_LIMITS, type LimitRule, type PublicLimiter } from '../limits.ts';
import type { WakeRelay } from '../realtime/wake.ts';
import type { FileStore } from '../storage/blob.ts';
import { hashAddress } from './public.ts';

/** The member door, as the RPC's `member` base opens it. */
type Enter = (session: AuthSession, slug: string) => Promise<Parameters<typeof readUpload>[0]>;

/** What the file routes need. */
export interface FormFilesDeps {
  readonly db: Database;
  /** The private store; absent (no token), uploads answer 503 and downloads 404. */
  readonly files: FileStore | undefined;
  readonly limiter: PublicLimiter;
  /** The origin hosted form pages are served from: the only Origin an upload takes. */
  readonly publicOrigin: string;
  readonly ipSalt: string;
  readonly auth: Auth;
  readonly enter: Enter;
  /** Pokes the relay once a Files tab write commits, so other tabs hear it. */
  readonly wakeRelay: WakeRelay;
}

/** The header a Files tab upload names its mutation in: the tab's own id for the write, echoed in its event. */
export const MUTATION_HEADER = 'x-crm-mutation-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface Variables {
  requestId: string;
  clientIp: string | undefined;
  origin: string | undefined;
}

const words = formStrings('en');

function fail(code: ErrorCode, message: string, headers?: Record<string, string>): Response {
  return Response.json({ code, message }, { status: ERROR_MAP[code].status, ...(headers ? { headers } : {}) });
}

/** A file name as a header carries it: ASCII in `filename`, the full name in `filename*`. */
function disposition(fileName: string, kind: 'attachment' | 'inline' = 'attachment'): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*!]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** The file name a request header carries (percent encoded); empty when absent or not decodable. */
function nameOf(header: string | undefined): string {
  try {
    return decodeURIComponent(header ?? '');
  } catch {
    return '';
  }
}

const NOT_FOUND = { code: 'NOT_FOUND', message: 'This file doesn’t exist, or you can’t open it.' };

/** What a record file over the cap answers. */
const TOO_LARGE = 'That file is larger than the 4 MB a record takes.';

/** What a record file of a type it doesn't take answers. */
const WRONG_TYPE = 'That type of file isn’t accepted. Send a PDF, an image, a text or an Office file.';

/** Mounts the file routes on an app whose base path is `/api`. */
export function mountFormFiles(app: Hono<{ Variables: Variables }>, deps: FormFilesDeps): void {
  /** 429 at the first spent limit, else undefined. */
  const limited = (checks: readonly (readonly [string, LimitRule])[]): Response | undefined => {
    for (const [key, limit] of checks) {
      const hit = deps.limiter(key, limit);
      if (!hit.allowed) return fail('RATE_LIMITED', words.tooMany, { 'retry-after': String(hit.retryAfterSeconds) });
    }
    return undefined;
  };

  app.post(
    '/public/forms/:publicKey/uploads',
    bodyLimit({
      maxSize: FORM_UPLOAD_MAX_BYTES,
      onError: () => fail('PAYLOAD_TOO_LARGE', 'That file is larger than the 4 MB a form accepts.'),
    }),
    async (c: Context<{ Variables: Variables }>) => {
      const ceiling = deps.limiter('uploads:instance', UPLOAD_LIMITS.perInstance);
      if (!ceiling.allowed) {
        return fail('RATE_LIMITED', words.tooMany, { 'retry-after': String(ceiling.retryAfterSeconds) });
      }
      const { files } = deps;
      if (files === undefined) return fail('API_UNAVAILABLE', 'File uploads are not available right now.');
      let entered: Awaited<ReturnType<typeof enterPublicForm>>;
      try {
        entered = await enterPublicForm({ db: deps.db }, c.req.param('publicKey') ?? '');
      } catch (error) {
        if (isRefusal(error)) return fail('NOT_FOUND', words.notFound);
        throw error;
      }
      const { scope, formId } = entered;
      // Only the hosted page (and its embed frame, served from the same origin) uploads.
      if (c.get('origin') !== deps.publicOrigin) {
        return fail('FORBIDDEN_ORIGIN', 'Files are taken only from the form’s own page.');
      }
      const address = hashAddress(deps.ipSalt, c.get('clientIp')) ?? 'unknown';
      const spent = limited([
        [`uploads:address:${address}`, UPLOAD_LIMITS.perAddress],
        [`uploads:address-in:${scope.workspaceId}:${address}`, UPLOAD_LIMITS.perAddressInWorkspace],
        [`uploads:form:${scope.workspaceId}:${formId}`, UPLOAD_LIMITS.perForm],
      ]);
      if (spent !== undefined) return spent;
      const declared = Number(c.req.header('content-length') ?? '');
      if (Number.isFinite(declared) && declared > FORM_UPLOAD_MAX_BYTES) {
        return fail('PAYLOAD_TOO_LARGE', 'That file is larger than the 4 MB a form accepts.');
      }
      const type = uploadTypeOf(c.req.header('content-type') ?? '');
      if (type === undefined)
        return fail(
          'INPUT_INVALID',
          'That type of file isn’t accepted. Send a PDF, an image, a text or an Office file.',
        );
      const body = new Uint8Array(await c.req.arrayBuffer());
      if (body.byteLength === 0) return fail('INPUT_INVALID', 'That file is empty.');
      if (body.byteLength > FORM_UPLOAD_MAX_BYTES) {
        return fail('PAYLOAD_TOO_LARGE', 'That file is larger than the 4 MB a form accepts.');
      }
      if (!matchesContent(type, body.subarray(0, 4_096))) {
        return fail('INPUT_INVALID', 'That file isn’t what its type says. Choose another file.');
      }
      const rawName = nameOf(c.req.header(UPLOAD_NAME_HEADER));
      const name = sanitiseFileName(rawName, type);
      const fileId = randomUUID();
      const pathname = `forms/${scope.workspaceId}/${formId}/${storedNameOf(fileId, type)}`;
      try {
        if ((await prepareUpload(scope, { formId })) === 'busy') {
          return fail('RATE_LIMITED', words.tooMany, { 'retry-after': '60' });
        }
        await files.put(pathname, body, type.contentType);
        try {
          const registered = await registerUpload(scope, {
            formId,
            fileId,
            pathname,
            name,
            size: body.byteLength,
            contentType: type.contentType,
            ...(address === 'unknown' ? {} : { ipHash: address }),
          });
          if (registered === 'busy') {
            await files.remove([pathname]).catch(() => undefined);
            return fail('RATE_LIMITED', words.tooMany, { 'retry-after': '60' });
          }
        } catch (error) {
          // The row didn't land: the file would be unreachable, so it goes now rather than wait for the cleanup.
          await files.remove([pathname]).catch(() => undefined);
          throw error;
        }
        const uploaded: UploadedFile = { fileId, name, size: body.byteLength, contentType: type.contentType };
        log.info('form.upload', { requestId: c.get('requestId'), formId, size: body.byteLength });
        return c.json(uploaded, 201, { 'cache-control': 'no-store' });
      } catch (error) {
        if (isRefusal(error)) {
          return error.refusal.code === 'FORM_CLOSED'
            ? fail('FORM_CLOSED', words.closed)
            : fail('NOT_FOUND', words.notFound);
        }
        log.error('Form upload failed', { requestId: c.get('requestId'), formId, ...errorFields(error) });
        captureFault(error, { requestId: c.get('requestId'), route: '/api/public/forms/:publicKey/uploads' });
        return fail('INTERNAL', words.fileFailed);
      }
    },
  );

  app.delete('/public/forms/:publicKey/uploads/:fileId', async (c) => {
    const { files } = deps;
    if (files === undefined) return fail('API_UNAVAILABLE', 'File uploads are not available right now.');
    if (c.get('origin') !== deps.publicOrigin) {
      return fail('FORBIDDEN_ORIGIN', 'Files are taken only from the form’s own page.');
    }
    try {
      const { scope, formId } = await enterPublicForm({ db: deps.db }, c.req.param('publicKey'));
      const address = hashAddress(deps.ipSalt, c.get('clientIp')) ?? 'unknown';
      const spent = limited([[`uploads:remove:${address}`, UPLOAD_LIMITS.perAddress]]);
      if (spent !== undefined) return spent;
      const pathname = await discardUpload(scope, { formId, fileId: c.req.param('fileId') });
      if (pathname !== undefined) await files.remove([pathname]).catch(() => undefined);
      // The same answer whether there was a file to remove or not.
      return c.body(null, 204);
    } catch (error) {
      if (isRefusal(error)) return c.body(null, 204);
      throw error;
    }
  });

  app.post(
    '/records/:recordId/fields/:attributeId/file',
    bodyLimit({
      maxSize: FORM_UPLOAD_MAX_BYTES,
      onError: () => fail('PAYLOAD_TOO_LARGE', 'That file is larger than the 4 MB a field accepts.'),
    }),
    async (c: Context<{ Variables: Variables }>) => {
      const ceiling = deps.limiter('record-files:instance', RECORD_FILE_LIMITS.perInstance);
      if (!ceiling.allowed) {
        return fail('RATE_LIMITED', words.tooMany, { 'retry-after': String(ceiling.retryAfterSeconds) });
      }
      const { files } = deps;
      if (files === undefined) return fail('API_UNAVAILABLE', 'File uploads are not available right now.');
      const slug = c.req.query('workspace');
      const session = await deps.auth.session(c.req.raw.headers, c.get('clientIp'));
      if (session === undefined || slug === undefined) return c.json(NOT_FOUND, 404);
      for (const cookie of session.setCookies) c.header('set-cookie', cookie, { append: true });
      const spent = limited([[`record-files:member:${session.user.id}`, RECORD_FILE_LIMITS.perMember]]);
      if (spent !== undefined) return spent;
      const declared = Number(c.req.header('content-length') ?? '');
      if (Number.isFinite(declared) && declared > FORM_UPLOAD_MAX_BYTES) {
        return fail('PAYLOAD_TOO_LARGE', 'That file is larger than the 4 MB a field accepts.');
      }
      const type = uploadTypeOf(c.req.header('content-type') ?? '');
      if (type === undefined) {
        return fail(
          'INPUT_INVALID',
          'That type of file isn’t accepted. Send a PDF, an image, a text or an Office file.',
        );
      }
      const body = new Uint8Array(await c.req.arrayBuffer());
      if (body.byteLength === 0) return fail('INPUT_INVALID', 'That file is empty.');
      if (body.byteLength > FORM_UPLOAD_MAX_BYTES) {
        return fail('PAYLOAD_TOO_LARGE', 'That file is larger than the 4 MB a field accepts.');
      }
      if (!matchesContent(type, body.subarray(0, 4_096))) {
        return fail('INPUT_INVALID', 'That file isn’t what its type says. Choose another file.');
      }
      const name = sanitiseFileName(nameOf(c.req.header(UPLOAD_NAME_HEADER)), type);
      const fileId = randomUUID();
      const recordId = c.req.param('recordId') ?? '';
      const attributeId = c.req.param('attributeId') ?? '';
      try {
        const scope = await deps.enter(session, slug);
        // The record and the field are checked before a byte is stored, and again when the row lands.
        const ready = await prepareRecordFile(scope, { recordId, attributeId, size: body.byteLength });
        if (ready !== 'ok') return fail('LIMIT_REACHED', ATTACHMENT_REFUSALS[ready]);
        const extension = storedNameOf(fileId, type).slice(fileId.length);
        const pathname = recordFilePath(scope.workspaceId, recordId, fileId, extension);
        await files.put(pathname, body, type.contentType);
        try {
          const registered = await registerRecordFile(scope, {
            recordId,
            attributeId,
            fileId,
            pathname,
            name,
            size: body.byteLength,
            contentType: type.contentType,
          });
          if (typeof registered === 'string') {
            await files.remove([pathname]).catch(() => undefined);
            return fail('LIMIT_REACHED', ATTACHMENT_REFUSALS[registered]);
          }
          log.info('record.file', { requestId: c.get('requestId'), size: body.byteLength });
          return c.json(registered satisfies UploadedFile, 201, { 'cache-control': 'no-store' });
        } catch (error) {
          // The row didn't land: the file would be unreachable, so it goes now rather than wait for the cleanup.
          await files.remove([pathname]).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (isRefusal(error)) {
          const { code, message } = error.refusal;
          return fail(code === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND', message);
        }
        log.error('Record file upload failed', { requestId: c.get('requestId'), ...errorFields(error) });
        captureFault(error, {
          requestId: c.get('requestId'),
          route: '/api/records/:recordId/fields/:attributeId/file',
        });
        return fail('INTERNAL', words.fileFailed);
      }
    },
  );

  app.post(
    '/records/:recordId/files',
    bodyLimit({
      maxSize: RECORD_FILE_MAX_BYTES,
      onError: () => fail('PAYLOAD_TOO_LARGE', TOO_LARGE),
    }),
    async (c: Context<{ Variables: Variables }>) => {
      const ceiling = deps.limiter('record-files:instance', RECORD_FILE_LIMITS.perInstance);
      if (!ceiling.allowed) {
        return fail('RATE_LIMITED', words.tooMany, { 'retry-after': String(ceiling.retryAfterSeconds) });
      }
      const { files } = deps;
      if (files === undefined) return fail('API_UNAVAILABLE', 'File uploads are not available right now.');
      const slug = c.req.query('workspace');
      const session = await deps.auth.session(c.req.raw.headers, c.get('clientIp'));
      if (session === undefined || slug === undefined) return c.json(NOT_FOUND, 404);
      for (const cookie of session.setCookies) c.header('set-cookie', cookie, { append: true });
      const spent = limited([[`record-files:member:${session.user.id}`, RECORD_FILE_LIMITS.perMember]]);
      if (spent !== undefined) return spent;
      const declared = Number(c.req.header('content-length') ?? '');
      if (Number.isFinite(declared) && declared > RECORD_FILE_MAX_BYTES) return fail('PAYLOAD_TOO_LARGE', TOO_LARGE);
      const type = uploadTypeOf(c.req.header('content-type') ?? '');
      if (type === undefined) return fail('INPUT_INVALID', WRONG_TYPE);
      const rawName = nameOf(c.req.header(UPLOAD_NAME_HEADER));
      // Before and after cleaning: a zero width mark or a full width letter must not slip `.exe` past the check.
      if (hasExecutableName(rawName) || hasExecutableName(rawName.normalize('NFKC'))) {
        return fail('INPUT_INVALID', WRONG_TYPE);
      }
      const body = new Uint8Array(await c.req.arrayBuffer());
      if (body.byteLength === 0) return fail('INPUT_INVALID', 'That file is empty.');
      if (body.byteLength > RECORD_FILE_MAX_BYTES) return fail('PAYLOAD_TOO_LARGE', TOO_LARGE);
      if (!matchesContent(type, body.subarray(0, 4_096))) {
        return fail('INPUT_INVALID', 'That file isn’t what its type says. Choose another file.');
      }
      const name = sanitiseFileName(rawName, type);
      if (hasExecutableName(name)) return fail('INPUT_INVALID', WRONG_TYPE);
      const fileId = randomUUID();
      const recordId = c.req.param('recordId') ?? '';
      const minted = c.req.header(MUTATION_HEADER) ?? '';
      const mutationId = UUID.test(minted) ? minted.toLowerCase() : randomUUID();
      try {
        const scope = await deps.enter(session, slug);
        // The record, its cap and the workspace's storage are checked before a byte is stored, and again on landing.
        const ready = await prepareAttachment(scope, { recordId, size: body.byteLength });
        if (ready !== 'ok') return fail('LIMIT_REACHED', ATTACHMENT_REFUSALS[ready]);
        const extension = storedNameOf(fileId, type).slice(fileId.length);
        const pathname = recordFilePath(scope.workspaceId, recordId, fileId, extension);
        await files.put(pathname, body, type.contentType);
        try {
          const registered = await commitWrite(
            { wakeRelay: deps.wakeRelay, user: { id: session.user.id } },
            { mutationId },
            (hooks) =>
              registerAttachment(
                scope,
                { recordId, fileId, pathname, name, size: body.byteLength, contentType: type.contentType },
                hooks,
              ),
          );
          if (typeof registered === 'string') {
            await files.remove([pathname]).catch(() => undefined);
            return fail('LIMIT_REACHED', ATTACHMENT_REFUSALS[registered]);
          }
          log.info('record.attachment', { requestId: c.get('requestId'), size: body.byteLength });
          return c.json(registered, 201, { 'cache-control': 'no-store' });
        } catch (error) {
          // The row didn't land: the file would be unreachable, so it goes now rather than wait for the cleanup.
          await files.remove([pathname]).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (isRefusal(error)) {
          const { code, message } = error.refusal;
          return fail(code === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND', message);
        }
        log.error('Record attachment upload failed', { requestId: c.get('requestId'), ...errorFields(error) });
        captureFault(error, { requestId: c.get('requestId'), route: '/api/records/:recordId/files' });
        return fail('INTERNAL', words.fileFailed);
      }
    },
  );

  app.get('/files/:fileId', async (c) => {
    const slug = c.req.query('workspace');
    const session = await deps.auth.session(c.req.raw.headers, c.get('clientIp'));
    if (session === undefined || slug === undefined || deps.files === undefined) return c.json(NOT_FOUND, 404);
    for (const cookie of session.setCookies) c.header('set-cookie', cookie, { append: true });
    try {
      const scope = await deps.enter(session, slug);
      // A record's own file first: it is keyed on the record, so it keeps working once its submission is gone.
      const file = await readRecordFile(scope, { fileId: c.req.param('fileId') }).catch(async (error: unknown) => {
        if (!isRefusal(error)) throw error;
        return readUpload(scope, { fileId: c.req.param('fileId') });
      });
      const stored = await deps.files.get(file.pathname);
      if (stored === undefined) return c.json(NOT_FOUND, 404);
      // The type is the allowlisted one recorded at upload, never the visitor's; an attachment, so nothing runs. A
      // raster image asked inline shows in the tab, under the same sandbox.
      const inline = c.req.query('inline') === '1' && opensInline(file.contentType);
      return c.body(stored.stream, 200, {
        'content-type': file.contentType,
        'content-length': String(stored.size),
        'content-disposition': disposition(file.name, inline ? 'inline' : 'attachment'),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        // Only this app's own pages may load it, whatever the cookie's SameSite says (an inline image above all).
        'cross-origin-resource-policy': 'same-origin',
        'content-security-policy': "default-src 'none'; sandbox",
      });
    } catch (error) {
      if (isRefusal(error)) return c.json(NOT_FOUND, 404);
      throw error;
    }
  });
}
