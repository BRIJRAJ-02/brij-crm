// The embed script (spec 0023, 0023-embeds.md): `embed/v1.js` is written as a
// plain classic script with its comments, then minified into the build as
// `/embed/v1.js`, the one tag a site adds. Served by the dev server the same
// way. A breaking change to the attributes it reads gets `embed/v2.js`, so a
// site's pasted snippet never changes meaning under it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { minify, type Plugin } from 'vite';

/** The script's address on our origin, the one snippets name. */
export const EMBED_SCRIPT_PATH = '/embed/v1.js';

/** The most the minified script may weigh gzipped: a site pays for every byte on every page. */
export const EMBED_SCRIPT_BUDGET = 6 * 1024;

/** The script's source. */
const SOURCE = path.join(import.meta.dirname, 'embed', 'v1.js');

/** The minified script, as shipped. Throws on a syntax error, so a broken script never builds. */
export async function buildEmbedScript(source = readFileSync(SOURCE, 'utf8')): Promise<string> {
  const result = await minify('v1.js', source, { compress: true, mangle: true });
  if (result.errors.length > 0) throw new Error(`embed/v1.js: ${result.errors.map((each) => each.message).join('; ')}`);
  return result.code;
}

/** Emits `/embed/v1.js` into the build and serves it from the dev server. */
export function embedScript(): Plugin {
  return {
    name: 'crm:embed-script',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== EMBED_SCRIPT_PATH) {
          next();
          return;
        }
        buildEmbedScript().then(
          (code) => {
            response.setHeader('content-type', 'text/javascript; charset=utf-8');
            response.end(code);
          },
          (error: unknown) => {
            next(error);
          },
        );
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: EMBED_SCRIPT_PATH.slice(1), source: await buildEmbedScript() });
    },
  };
}
