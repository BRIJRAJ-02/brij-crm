// The embed script ships small and whole (spec 0023, 0023-embeds.md): every
// site pays for it on every page, so it stays under 6 kB gzipped, and it
// still reads every attribute the snippets name.
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildEmbedScript, EMBED_SCRIPT_BUDGET } from './embed-script.ts';

describe('the embed script', () => {
  it('minifies to under 6 kB gzipped', async () => {
    const code = await buildEmbedScript();
    expect(gzipSync(code).length).toBeLessThan(EMBED_SCRIPT_BUDGET);
  });

  it('keeps the attributes, the message shape and the cookie the snippets and frames rely on', async () => {
    const code = await buildEmbedScript();
    for (const word of [
      'data-timefix-form',
      'data-timefix-booking',
      'data-timefix-mode',
      'data-timefix-workspace',
      'data-timefix-version',
      'data-timefix-pass',
      'data-timefix-consent',
      'data-crm-form-post',
      'tfx_vid',
      'tfx_landing',
    ]) {
      expect(code).toContain(word);
    }
  });

  it('refuses a broken script instead of shipping it', async () => {
    await expect(buildEmbedScript('(function () {')).rejects.toThrow(/embed\/v1\.js/);
  });
});
