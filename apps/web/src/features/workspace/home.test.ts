import { describe, expect, it } from 'vitest';
import { homeWorkspace } from './home.ts';

const acme = { id: '0199a6f2-0000-7000-8000-000000000001', slug: 'acme', name: 'Acme' };
const globex = { id: '0199a6f2-0000-7000-8000-000000000002', slug: 'globex', name: 'Globex' };

describe('homeWorkspace (spec 0031, AC-802)', () => {
  it('opens the last workspace while it is still listed', () => {
    expect(homeWorkspace({ workspaces: [acme, globex], lastWorkspaceId: globex.id })).toBe(globex);
  });

  it('falls back to the oldest, and to none', () => {
    expect(homeWorkspace({ workspaces: [acme, globex], lastWorkspaceId: '0199a6f2-0000-7000-8000-000000000009' })).toBe(
      acme,
    );
    expect(homeWorkspace({ workspaces: [acme, globex] })).toBe(acme);
    expect(homeWorkspace({ workspaces: [] })).toBeUndefined();
  });
});
