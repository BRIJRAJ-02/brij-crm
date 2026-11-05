import { describe, expect, it } from 'vitest';
import { checkBlock } from './store.ts';

describe('the bento cards, checked before they are sent (spec 0068, AC-6808)', () => {
  it('sends what was typed, trimmed, with nothing empty, and the span and window it carries', () => {
    expect(
      checkBlock(
        {
          kind: 'timeline',
          title: ' Experience ',
          items: [
            { when: '2021', title: 'Designer', place: ' Webflow ' },
            { when: '2019', title: 'Intern', place: '' },
          ],
          size: 'wide',
        },
        [],
      ),
    ).toEqual({
      ok: true,
      block: {
        kind: 'timeline',
        title: 'Experience',
        items: [
          { when: '2021', title: 'Designer', place: 'Webflow' },
          { when: '2019', title: 'Intern' },
        ],
        size: 'wide',
      },
    });
    expect(checkBlock({ kind: 'status', text: 'Available for work', state: 'open' }, [])).toEqual({
      ok: true,
      block: { kind: 'status', text: 'Available for work' },
    });
    expect(checkBlock({ kind: 'work', title: '', items: [{ title: 'Effy', body: '', url: 'effy.app' }] }, [])).toEqual({
      ok: true,
      block: { kind: 'work', items: [{ title: 'Effy', url: 'https://effy.app' }] },
    });
  });

  it('names each refused field by its place, in the server’s own words', () => {
    const steps = checkBlock({ kind: 'steps', title: '', items: [{ title: '', body: 'x' }] }, []);
    expect(steps).toEqual({
      ok: false,
      problems: { items: 'Add at least two steps.', 'items.0.title': 'Name the step.' },
    });
    const events = checkBlock(
      { kind: 'events', title: '', items: [{ title: 'Open studio', at: '', place: '', url: 'javascript:alert(1)' }] },
      [],
    );
    expect(events.ok).toBe(false);
    if (!events.ok) {
      expect(events.problems['items.0.at']).toBe('Pick a date and time.');
      expect(events.problems['items.0.url']).toBeDefined();
    }
    expect(checkBlock({ kind: 'audio', title: '' }, [])).toEqual({
      ok: false,
      problems: { audio: 'Add a recording.' },
    });
    expect(checkBlock({ kind: 'location', title: '', address: '  ' }, [])).toEqual({
      ok: false,
      problems: { address: 'Write the address.' },
    });
  });
});
