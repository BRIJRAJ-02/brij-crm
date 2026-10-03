// Reads sign in codes back from Mailpit, the local mail catcher
// (docker-compose.yml): `GET /api/v1/messages`, then `GET /api/v1/message/{id}`.
import { expect, type APIRequestContext } from '@playwright/test';

/** Mailpit's API. */
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

interface MessageList {
  readonly messages: readonly { readonly ID: string; readonly To: readonly { readonly Address: string }[] | null }[];
}

interface Message {
  readonly Text: string;
}

/** The newest code sent to `email` that isn't one of `seen`, waiting up to 15 seconds for it to arrive. */
export async function codeFor(
  request: APIRequestContext,
  email: string,
  seen: readonly string[] = [],
): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (await request.get(`${MAILPIT_URL}/api/v1/messages?limit=50`)).json()) as MessageList;
        const [newest] = list.messages.filter((message) =>
          (message.To ?? []).some((to) => to.Address.toLowerCase() === email.toLowerCase()),
        );
        if (newest === undefined) return undefined;
        const message = (await (await request.get(`${MAILPIT_URL}/api/v1/message/${newest.ID}`)).json()) as Message;
        const found = /\b(\d{6})\b/.exec(message.Text)?.[1];
        code = found !== undefined && !seen.includes(found) ? found : undefined;
        return code;
      },
      { timeout: 15_000, message: `a sign in code for ${email} in Mailpit` },
    )
    .toBeDefined();
  if (code === undefined) throw new Error(`No sign in code reached Mailpit for ${email}.`);
  return code;
}
