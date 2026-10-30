// The alignment probe (spec 0058, AC-1): measures real boxes on a rendered screen or popup and reports every
// alignment rule it breaks. One function, `probeAlignment`, with everything inside it and no imports, so it also
// runs in a page a test drives from outside: `await page.evaluate(probeAlignment, { root: '[role=dialog]' })`
// (Playwright serialises the function's source). In Vitest browser mode, call it directly.

/** What the probe measures. Every selector is optional; a check with nothing to measure passes. */
export interface AlignmentProbeOptions {
  /** Where to look: a CSS selector for the card, popup or screen. Default: the whole page. */
  readonly root?: string;
  /**
   * Groups of elements that must share one left edge, each group a list of selectors ("every label, input, tile
   * and button inside one card"). Default: anything marked `data-probe~="edge"`.
   */
  readonly leftEdges?: readonly (readonly string[])[];
  /** Tiles that must all be one width and one height. Default: `[data-tile]`. */
  readonly tiles?: string;
  /** Rows whose label and control must share a baseline, and whose buttons must share a height. Default: `[data-probe~="row"]`. */
  readonly rows?: string;
  /**
   * Blocks that must be centred in their container on both axes, their children on one centre line (an empty
   * state). Default: `[data-probe~="centred"]`.
   */
  readonly centred?: string;
  /** Popups that must use the standard head, body and footer layout. Default: `[role="dialog"], [role="alertdialog"]`. */
  readonly popups?: string;
  /** Elements whose padding and gaps must sit on the token spacing scale. Default: everything under the root. */
  readonly spacing?: string;
  /** Elements to leave out of the spacing check (a control whose inset is a calc of tokens). */
  readonly ignoreSpacing?: string;
  /** Pixel values allowed on top of the scale. */
  readonly allowSpacing?: readonly number[];
  /** How far two edges may differ and still count as one, in pixels. Default 1. */
  readonly tolerance?: number;
}

/** One broken rule. */
export interface AlignmentFailure {
  /** Which rule: `left-edge`, `tile-size`, `baseline`, `button-height`, `centred`, `popup` or `spacing`. */
  readonly check: string;
  /** What is wrong, in a sentence, with the measured numbers. */
  readonly message: string;
}

/** The probe's result: `ok` when nothing is broken. */
export interface AlignmentReport {
  readonly ok: boolean;
  readonly failures: readonly AlignmentFailure[];
  /** How many elements each check looked at, so a test can tell "passed" from "found nothing". */
  readonly checked: Readonly<Record<string, number>>;
}

/**
 * Measures the page (or `options.root`) against spec 0058's alignment rules: shared left edges, equal tiles,
 * label and control baselines, equal button heights, centred empty states, the standard popup layout and the
 * token spacing scale (read from `--space-*` and `--overlay-inset` on the page, so a change of scale needs no
 * change here). It only reads: it never changes the page.
 */
export function probeAlignment(options: AlignmentProbeOptions = {}): AlignmentReport {
  const tolerance = options.tolerance ?? 1;
  const failures: { check: string; message: string }[] = [];
  const checked: Record<string, number> = {};
  const root: Element =
    options.root === undefined ? document.body : (document.querySelector(options.root) ?? document.body);

  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  };
  const all = (selector: string) => [...root.querySelectorAll(selector)].filter(visible);
  const name = (element: Element) => {
    const label = element.getAttribute('aria-label') ?? element.textContent.trim().slice(0, 24);
    return `<${element.tagName.toLowerCase()}> "${label}"`;
  };
  const fail = (check: string, message: string) => {
    failures.push({ check, message });
  };
  const count = (check: string, amount: number) => {
    checked[check] = (checked[check] ?? 0) + amount;
  };

  // Shared left edges.
  const edgeGroups = options.leftEdges ?? [['[data-probe~="edge"]']];
  for (const group of edgeGroups) {
    const members = group.flatMap((selector) => all(selector));
    count('left-edge', members.length);
    const first = members[0];
    if (first === undefined) continue;
    const base = first.getBoundingClientRect().left;
    for (const member of members) {
      const left = member.getBoundingClientRect().left;
      if (Math.abs(left - base) > tolerance) {
        fail(
          'left-edge',
          `${name(member)} starts at ${left.toFixed(1)}px, not ${base.toFixed(1)}px like ${name(first)}`,
        );
      }
    }
  }

  // Tiles are one size.
  const tiles = all(options.tiles ?? '[data-tile]');
  count('tile-size', tiles.length);
  const tileOne = tiles[0];
  if (tileOne !== undefined) {
    const one = tileOne.getBoundingClientRect();
    for (const tile of tiles) {
      const box = tile.getBoundingClientRect();
      if (Math.abs(box.width - one.width) > tolerance || Math.abs(box.height - one.height) > tolerance) {
        fail(
          'tile-size',
          `${name(tile)} is ${box.width.toFixed(1)}x${box.height.toFixed(1)}px, the first tile is ${one.width.toFixed(1)}x${one.height.toFixed(1)}px`,
        );
      }
    }
  }

  // Rows: label and control on one baseline, buttons one height.
  const rows = all(options.rows ?? '[data-probe~="row"]');
  count('baseline', rows.length);
  for (const row of rows) {
    const label = row.querySelector('label, [data-probe~="label"]');
    const control = row.querySelector('input, textarea, select, [role="combobox"], [data-probe~="control"]');
    if (label !== null && control !== null) {
      const text = document.createRange();
      text.selectNodeContents(label);
      const textBox = text.getBoundingClientRect();
      const controlBox = control.getBoundingClientRect();
      const labelMiddle = textBox.top + textBox.height / 2;
      const controlMiddle = controlBox.top + controlBox.height / 2;
      if (Math.abs(labelMiddle - controlMiddle) > tolerance + 1) {
        fail(
          'baseline',
          `the label ${name(label)} sits ${labelMiddle.toFixed(1)}px down, its control ${controlMiddle.toFixed(1)}px`,
        );
      }
    }
    const buttons = [...row.querySelectorAll('button, a[role="button"]')].filter(visible);
    count('button-height', buttons.length);
    const firstButton = buttons[0];
    if (firstButton !== undefined) {
      const height = firstButton.getBoundingClientRect().height;
      for (const button of buttons) {
        const box = button.getBoundingClientRect();
        if (Math.abs(box.height - height) > tolerance) {
          fail(
            'button-height',
            `${name(button)} is ${box.height.toFixed(1)}px tall, ${name(firstButton)} is ${height.toFixed(1)}px`,
          );
        }
        if (Math.abs(box.bottom - firstButton.getBoundingClientRect().bottom) > tolerance) {
          fail('button-height', `${name(button)} does not sit on the same line as ${name(firstButton)}`);
        }
      }
    }
  }

  // Centred blocks (empty states), and their children on one centre line.
  const centred = all(options.centred ?? '[data-probe~="centred"]');
  count('centred', centred.length);
  for (const block of centred) {
    const container = block.parentElement;
    if (container === null) continue;
    const inner = block.getBoundingClientRect();
    const outer = container.getBoundingClientRect();
    const dx = inner.left + inner.width / 2 - (outer.left + outer.width / 2);
    const dy = inner.top + inner.height / 2 - (outer.top + outer.height / 2);
    if (Math.abs(dx) > tolerance)
      fail('centred', `${name(block)} is ${dx.toFixed(1)}px off the horizontal centre of its container`);
    if (Math.abs(dy) > tolerance)
      fail('centred', `${name(block)} is ${dy.toFixed(1)}px off the vertical centre of its container`);
    for (const child of block.children) {
      if (!visible(child)) continue;
      const box = child.getBoundingClientRect();
      const off = box.left + box.width / 2 - (inner.left + inner.width / 2);
      if (Math.abs(off) > tolerance)
        fail('centred', `${name(child)} is ${off.toFixed(1)}px off the block's centre line`);
    }
  }

  // Popups: a title head, then a body, then a footer whose buttons end where the body's content ends.
  const popups = all(options.popups ?? '[role="dialog"], [role="alertdialog"]');
  count('popup', popups.length);
  for (const popup of popups) {
    const head = popup.querySelector('[class*="ws-modal-head"]');
    const body = popup.querySelector('[class*="ws-modal-body"]');
    const foot = popup.querySelector('[class*="ws-modal-foot"]');
    if (body === null) {
      fail('popup', `${name(popup)} has no standard body`);
      continue;
    }
    const bodyStyle = getComputedStyle(body);
    const bodyBox = body.getBoundingClientRect();
    const contentLeft = bodyBox.left + Number.parseFloat(bodyStyle.paddingLeft);
    const contentRight = bodyBox.right - Number.parseFloat(bodyStyle.paddingRight);
    const title = head?.querySelector('h1, h2, h3, [slot="title"]');
    if (
      title !== null &&
      title !== undefined &&
      Math.abs(title.getBoundingClientRect().left - contentLeft) > tolerance
    ) {
      fail(
        'popup',
        `the title starts at ${title.getBoundingClientRect().left.toFixed(1)}px, the body's content at ${contentLeft.toFixed(1)}px`,
      );
    }
    if (foot !== null) {
      const buttons = [...foot.querySelectorAll('button')].filter(visible);
      const last = buttons[buttons.length - 1];
      if (last !== undefined && Math.abs(last.getBoundingClientRect().right - contentRight) > tolerance) {
        fail(
          'popup',
          `the footer's last button ends at ${last.getBoundingClientRect().right.toFixed(1)}px, the body's content at ${contentRight.toFixed(1)}px`,
        );
      }
    }
  }

  // Spacing: every padding and gap is on the token scale.
  const rootStyle = getComputedStyle(document.documentElement);
  const scale = new Set<number>([0, ...(options.allowSpacing ?? [])]);
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.append(probe);
  for (const property of [
    '--overlay-inset',
    ...[2, 4, 6, 8, 12, 16, 20, 24, 32].map((step) => `--space-${String(step)}`),
  ]) {
    if (rootStyle.getPropertyValue(property).trim() === '') continue;
    probe.style.width = `var(${property})`;
    scale.add(Math.round(Number.parseFloat(getComputedStyle(probe).width) * 100) / 100);
  }
  probe.remove();
  const ignored = options.ignoreSpacing === undefined ? [] : [...root.querySelectorAll(options.ignoreSpacing)];
  const spaced = (
    options.spacing === undefined ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll(options.spacing)]
  ).filter((element) => visible(element) && !ignored.some((skip) => skip === element || skip.contains(element)));
  count('spacing', spaced.length);
  const properties = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap'] as const;
  for (const element of spaced) {
    const style = getComputedStyle(element);
    for (const property of properties) {
      const raw = style[property];
      // `normal` is a gap that was never set.
      if (raw === 'normal') continue;
      const value = Math.round(Number.parseFloat(raw) * 100) / 100;
      if (Number.isNaN(value) || scale.has(value)) continue;
      fail('spacing', `${name(element)} has ${property} ${String(value)}px, which is not on the spacing scale`);
    }
  }

  return { ok: failures.length === 0, failures, checked };
}

/** Throws one error listing every failure, for a test that wants to stop on the first broken screen. */
export function assertAligned(report: AlignmentReport): void {
  if (report.ok) return;
  throw new Error(
    `The alignment probe found ${String(report.failures.length)} problem(s):\n${report.failures
      .map((failure) => `- [${failure.check}] ${failure.message}`)
      .join('\n')}`,
  );
}
