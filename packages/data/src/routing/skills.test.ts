import { describe, expect, it } from 'vitest';
import type { RoutingSettings, SkillsView } from '@crm/contracts';
import { dataError } from '../errors.ts';
import { createRoutingSkills, type RoutingSkillsDeps } from './skills.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const SPANISH = '019a0000-0000-7000-8000-000000000001';
const BEA = '019a0000-0000-7000-8000-0000000000b0';
const STAGE = '019a0000-0000-7000-8000-0000000000c0';
const WON = '019a0000-0000-7000-8000-0000000000c1';

/** A fake server holding one workspace's skills; each write waits for `answer` unless it refuses. */
function setup() {
  let server: SkillsView = {
    skills: [{ id: SPANISH, group: 'language', name: 'Spanish', position: 0 }],
    members: [],
    wonMeansSet: false,
  };
  let settings: RoutingSettings = {};
  const waiting: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  const reads: string[] = [];
  let minted = 0;
  const later = <T>(apply: () => T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      waiting.push({
        resolve: () => {
          try {
            resolve(apply());
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        reject,
      });
    });
  const deps: RoutingSkillsDeps = {
    list: () => {
      reads.push('skills');
      return Promise.resolve(server);
    },
    create: (_, input) =>
      later(() => {
        server = { ...server, skills: [...server.skills, { ...input, position: server.skills.length }] };
        return server;
      }),
    update: (_, input) =>
      later(() => {
        server = {
          ...server,
          skills: server.skills.map((skill) => (skill.id === input.id ? { ...skill, ...input } : skill)),
        };
        return server;
      }),
    remove: (_, id) =>
      later(() => {
        server = { ...server, skills: server.skills.filter((skill) => skill.id !== id) };
        return server;
      }),
    setMember: (_, memberId, skillIds) =>
      later(() => {
        server = { ...server, members: [{ memberId, skillIds: [...skillIds] }] };
        return server;
      }),
    settings: () => {
      reads.push('settings');
      return Promise.resolve(settings);
    },
    setSettings: (_, wonStage, updatedAt) =>
      later(() => {
        if (updatedAt !== settings.updatedAt) throw dataError('STALE', 'Someone else changed it.');
        settings = { ...(wonStage === null ? {} : { wonStage }), updatedAt: 'later' };
        server = { ...server, wonMeansSet: wonStage !== null };
        return settings;
      }),
    mintId: () => {
      minted += 1;
      return `019a0000-0000-7000-8000-00000000000${String(minted + 1)}`;
    },
    onReturn: () => () => undefined,
  };
  const store = createRoutingSkills(deps);
  return {
    store,
    reads,
    answer: () => waiting.shift()?.resolve(),
    refuse: (code: string) => waiting.shift()?.reject(dataError(code as 'SKILL_IN_USE', `Refused ${code}.`)),
    setSettingsElsewhere: (next: RoutingSettings) => {
      settings = next;
    },
  };
}

describe('routing skills in the browser (spec 0037, AC-1382)', () => {
  it('shows a new skill at once and keeps the server’s answer', async () => {
    const { store, answer } = setup();
    const view = store.view('acme');
    const release = view.retain();
    await flush();
    const made = store.create('acme', 'language', 'German');
    const shown = view.getSnapshot();
    expect(shown.status === 'ready' && shown.value.skills.map((skill) => skill.name)).toEqual(['Spanish', 'German']);
    answer();
    await made;
    const landed = view.getSnapshot();
    expect(landed.status === 'ready' && landed.value.skills).toHaveLength(2);
    release();
  });

  it('puts back only the refused write, keeping another still waiting, and rejects with the refusal', async () => {
    const { store, answer, refuse } = setup();
    const view = store.view('acme');
    const release = view.retain();
    await flush();
    const removed = store.remove('acme', SPANISH);
    const held = store.setMember('acme', BEA, [SPANISH]);
    let shown = view.getSnapshot();
    expect(shown.status === 'ready' && shown.value.skills).toEqual([]);
    expect(shown.status === 'ready' && shown.value.members).toEqual([{ memberId: BEA, skillIds: [SPANISH] }]);
    refuse('SKILL_IN_USE');
    await expect(removed).rejects.toMatchObject({ code: 'SKILL_IN_USE' });
    shown = view.getSnapshot();
    expect(shown.status === 'ready' && shown.value.skills.map((skill) => skill.name)).toEqual(['Spanish']);
    expect(shown.status === 'ready' && shown.value.members).toEqual([{ memberId: BEA, skillIds: [SPANISH] }]);
    answer();
    await held;
    release();
  });

  it('sets Won means with the time it read, reads again on STALE, and tells the held skills', async () => {
    const { store, answer, reads, setSettingsElsewhere } = setup();
    const settings = store.settings('acme');
    const skills = store.view('acme');
    const releaseSettings = settings.retain();
    const releaseSkills = skills.retain();
    await flush();
    const wonStage = { attributeId: STAGE, optionIds: [WON] };
    const first = store.setWonStage('acme', wonStage);
    const shown = settings.getSnapshot();
    expect(shown.status === 'ready' && shown.value.wonStage).toEqual(wonStage);
    answer();
    await first;
    await flush();
    const told = skills.getSnapshot();
    expect(told.status === 'ready' && told.value.wonMeansSet).toBe(true);
    // Someone else changes it: this tab's next change is refused and the settings are read again.
    setSettingsElsewhere({ updatedAt: 'elsewhere' });
    const before = reads.filter((each) => each === 'settings').length;
    const second = store.setWonStage('acme', null);
    answer();
    await expect(second).rejects.toMatchObject({ code: 'STALE' });
    await flush();
    expect(reads.filter((each) => each === 'settings').length).toBe(before + 1);
    releaseSettings();
    releaseSkills();
  });
});
