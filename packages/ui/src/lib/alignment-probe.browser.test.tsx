// The alignment probe measures real boxes, so it is tested in a real browser with small fixtures: one that obeys the
// rules and one that breaks each of them.
import { afterEach, describe, expect, it } from 'vitest';
import { assertAligned, probeAlignment } from './alignment-probe.ts';

/** Builds a fixture from markup with the page's own tokens in its styles. */
function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.id = 'fixture';
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

afterEach(() => {
  document.getElementById('fixture')?.remove();
});

describe('probeAlignment', () => {
  it('passes a card whose parts share an edge, whose tiles match and whose gaps are on the scale', () => {
    mount(`
      <div style="padding: var(--space-16); display: grid; gap: var(--space-8); width: 400px">
        <label data-probe="edge">Name</label>
        <input data-probe="edge" style="width: 200px; padding: var(--space-4) var(--space-8)" />
        <div style="display: flex; gap: var(--space-8)">
          <div data-tile style="width: 100px; height: 80px"></div>
          <div data-tile style="width: 100px; height: 80px"></div>
        </div>
      </div>`);
    // The input sets its own inset from tokens, as every library field does: a bare input keeps the browser's
    // 1px 2px, which is off the scale, and the probe rightly reports it.
    const report = probeAlignment({ root: '#fixture' });
    expect(report.failures).toEqual([]);
    expect(report.checked['left-edge']).toBe(2);
    expect(report.checked['tile-size']).toBe(2);
    expect(() => {
      assertAligned(report);
    }).not.toThrow();
  });

  it('fails a shifted edge, a tile of another size and an off scale gap', () => {
    mount(`
      <div style="padding: 7px; display: grid; gap: 5px; width: 400px">
        <label data-probe="edge">Name</label>
        <input data-probe="edge" style="width: 200px; margin-left: 9px" />
        <div style="display: flex; gap: 5px">
          <div data-tile style="width: 100px; height: 80px"></div>
          <div data-tile style="width: 110px; height: 80px"></div>
        </div>
      </div>`);
    const report = probeAlignment({ root: '#fixture' });
    expect(new Set(report.failures.map((failure) => failure.check))).toEqual(
      new Set(['left-edge', 'tile-size', 'spacing']),
    );
    expect(() => {
      assertAligned(report);
    }).toThrow(/found \d+ problem/);
  });

  it('checks a block is centred on both axes and its children on one centre line', () => {
    mount(`
      <div style="width: 400px; height: 300px; display: flex">
        <div data-probe="centred" style="margin: auto; text-align: center; display: flex; flex-direction: column; align-items: center">
          <span>Icon</span><span>A long heading here</span>
        </div>
      </div>`);
    expect(probeAlignment({ root: '#fixture', ignoreSpacing: '*' }).failures).toEqual([]);
    document.getElementById('fixture')?.remove();
    mount(`
      <div style="width: 400px; height: 300px; display: flex">
        <div data-probe="centred" style="margin-left: 0"><span>Off to the side</span></div>
      </div>`);
    expect(probeAlignment({ root: '#fixture', ignoreSpacing: '*' }).failures.map((failure) => failure.check)).toContain(
      'centred',
    );
  });

  it('checks buttons in a row share a height', () => {
    mount(`
      <div data-probe="row" style="display: flex; gap: var(--space-8); align-items: flex-end">
        <button style="height: 26px">One</button><button style="height: 30px">Two</button>
      </div>`);
    expect(probeAlignment({ root: '#fixture' }).failures.map((failure) => failure.check)).toContain('button-height');
  });
});
