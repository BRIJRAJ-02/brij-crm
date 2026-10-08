// The build refuses a realtime address the deployed CSP would block (spec 0005).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectSources, realtimeCspProblem } from './realtime-csp.ts';

const CSP = "default-src 'self'; connect-src 'self' wss://live.example.com; object-src 'none'";

describe('the realtime address against the CSP', () => {
  it('reads connect-src', () => {
    expect(connectSources(CSP)).toEqual(["'self'", 'wss://live.example.com']);
    expect(connectSources("default-src 'self'")).toEqual([]);
  });

  it('takes no address (live off) and a laptop address', () => {
    expect(realtimeCspProblem(undefined, CSP)).toBeUndefined();
    expect(realtimeCspProblem('', CSP)).toBeUndefined();
    expect(realtimeCspProblem('ws://localhost:8000/connection/websocket', CSP)).toBeUndefined();
  });

  it('takes a wss address whose origin connect-src lists', () => {
    expect(realtimeCspProblem('wss://live.example.com/connection/websocket', CSP)).toBeUndefined();
  });

  it('refuses one the CSP would block, plain ws to a host, and a non address', () => {
    expect(realtimeCspProblem('wss://elsewhere.example.com/connection/websocket', CSP)).toMatch(
      /Add wss:\/\/elsewhere\.example\.com to connect-src/,
    );
    expect(realtimeCspProblem('ws://live.example.com/connection/websocket', CSP)).toMatch(/must be wss/);
    expect(realtimeCspProblem('not a url', CSP)).toMatch(/isn't an address/);
  });

  it("reads vercel.json's CSP, which has a connect-src", () => {
    const vercel = JSON.parse(readFileSync(path.join(import.meta.dirname, 'vercel.json'), 'utf8')) as {
      headers: { headers: { key: string; value: string }[] }[];
    };
    const csp = vercel.headers
      .flatMap((rule) => rule.headers)
      .find((header) => header.key === 'Content-Security-Policy');
    expect(connectSources(csp?.value ?? '')).toContain("'self'");
  });
});
