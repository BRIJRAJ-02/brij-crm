// `pnpm --filter @crm/emails brand`: the footer's Timefix wordmarks, made from
// the web app's own wordmark in the muted ink of each theme (the
// `text-tertiary` token), and written to apps/web/public/brand/email/, which
// the app serves. A mid grey stays legible on a client's own dark ground (Gmail
// darkens an email without asking it), where black ink would vanish. With
// `--check` it writes nothing and fails when the committed files aren't what
// the tokens make, so a token change can't leave the logo behind.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { colorToken } from '../src/tokens.ts';
import { decodePng, encodePng, recolour } from './png.ts';

const BRAND = path.resolve(import.meta.dirname, '../../../apps/web/public/brand');

/** The wordmark files to write, and the token colour each takes. */
export const WORDMARKS = [
  { file: 'email/timefix-wordmark-light.png', scheme: 'light' },
  { file: 'email/timefix-wordmark-dark.png', scheme: 'dark' },
] as const;

/** The source: the web app's wordmark, whose alpha channel is the shape. */
const SOURCE = path.join(BRAND, 'timefix-wordmark-light.png');

/** Each wordmark's bytes, from the source and the tokens. */
export function makeWordmarks(): { readonly file: string; readonly bytes: Buffer }[] {
  const source = decodePng(readFileSync(SOURCE));
  return WORDMARKS.map(({ file, scheme }) => ({
    file: path.join(BRAND, file),
    bytes: encodePng(recolour(source, colorToken('text-tertiary', scheme))),
  }));
}

if (import.meta.main) {
  const check = process.argv.includes('--check');
  const stale: string[] = [];
  for (const { file, bytes } of makeWordmarks()) {
    if (check) {
      let current: Buffer | undefined;
      try {
        current = readFileSync(file);
      } catch {
        current = undefined;
      }
      if (current === undefined || !current.equals(bytes)) stale.push(path.relative(process.cwd(), file));
    } else {
      writeFileSync(file, bytes);
      console.log(`Wrote ${path.relative(process.cwd(), file)}`);
    }
  }
  if (stale.length > 0) {
    console.error(
      `EMAIL_BRAND_STALE: ${stale.join(', ')} isn't what the tokens make. Run pnpm --filter @crm/emails brand.`,
    );
    process.exit(1);
  }
}
