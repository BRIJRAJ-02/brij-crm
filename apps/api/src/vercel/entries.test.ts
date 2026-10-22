// The two entries build the same app (spec 0045): `server.ts` (Railway, a
// laptop) and the Vercel Function's `handler.ts` must hand `createApp` the
// same services, apart from the few listed below with their reason. A
// service one entry forgets falls back to a default that refuses quietly:
// on 22 Oct the function had no mailer, so every step up code, invitation and
// farewell email failed in production with "No mailer was given to this app."
// The check reads each entry's source, since `server.ts` starts a server on
// import.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The services `server.ts` gives the app that the function leaves out on
 * purpose. Add one only with its reason.
 */
const FUNCTION_LEAVES_OUT: Readonly<Record<string, string>> = {
  // No worker runs beside the function, so no live connection exists to cut (NO_SIGNED_OUT is right).
  signedOut: 'no worker or Centrifugo on Vercel',
  // Server-Timing is a load test switch (API_TIMING) on a long running server only.
  timing: 'load timing runs on the long running server only',
};

/** The services the function gives that `server.ts` doesn't. Add one only with its reason. */
const FUNCTION_ADDS: Readonly<Record<string, string>> = {
  // Nothing runs between drain turns, so a signed in request starts one once queued work comes due (spec 0045).
  wakeOnUse: 'the job drain wakes from use when work is due, in place of the worker poke',
  // An instance may be frozen once it answers, so work started after the answer runs inside waitUntil.
  keepAlive: "Vercel's waitUntil; a long running server needs none",
};

const source = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

/** Every property name in an object literal, including those inside a conditional spread (`...(x ? {} : { a })`). */
function namesIn(node: ts.Node): string[] {
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap((property) => {
      if (ts.isSpreadAssignment(property)) return namesIn(property.expression);
      return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? [property.name.text] : [];
    });
  }
  if (ts.isParenthesizedExpression(node)) return namesIn(node.expression);
  if (ts.isConditionalExpression(node)) return [...namesIn(node.whenTrue), ...namesIn(node.whenFalse)];
  return [];
}

/** The service names one entry's `createApp({ services: { … } })` call passes. Exactly one such call per entry. */
export function servicesPassed(code: string, fileName = 'entry.ts'): string[] {
  const file = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createApp') {
      const [options] = node.arguments;
      const services =
        options !== undefined && ts.isObjectLiteralExpression(options)
          ? options.properties.find(
              (property): property is ts.PropertyAssignment =>
                ts.isPropertyAssignment(property) &&
                ts.isIdentifier(property.name) &&
                property.name.text === 'services',
            )
          : undefined;
      if (services === undefined) throw new Error(`${fileName}: createApp's services aren't an object literal.`);
      calls.push(namesIn(services.initializer));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const [only, ...more] = calls;
  if (only === undefined || more.length > 0) throw new Error(`${fileName}: expected one createApp call.`);
  return [...new Set(only)].sort();
}

describe('the two api entries', () => {
  const server = servicesPassed(source('../server.ts'), 'server.ts');
  const handler = servicesPassed(source('./handler.ts'), 'handler.ts');

  it('give createApp the same services, apart from the listed ones', () => {
    expect(server).toContain('mailer');
    const missing = server.filter((name) => !handler.includes(name) && !(name in FUNCTION_LEAVES_OUT));
    const extra = handler.filter((name) => !server.includes(name) && !(name in FUNCTION_ADDS));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it('keeps no stale entry in either list', () => {
    expect(Object.keys(FUNCTION_LEAVES_OUT).filter((name) => !server.includes(name) || handler.includes(name))).toEqual(
      [],
    );
    expect(Object.keys(FUNCTION_ADDS).filter((name) => !handler.includes(name) || server.includes(name))).toEqual([]);
  });

  it('reads shorthand, keyed and conditionally spread services', () => {
    const code = `createApp({ services: { db, rules: APP_RULES, ...(t === undefined ? {} : { timing }) }, env });`;
    expect(servicesPassed(code)).toEqual(['db', 'rules', 'timing']);
    expect(servicesPassed(`createApp({ services: { db, auth }, env });`)).not.toContain('mailer');
  });
});
