// Every sidebar page in every workspace: shoot it, check it for breakage (clipped text, things off screen, controls on top of
// each other, page scroll), then open each menu/popup trigger on the page and check the popup fits the window.
// Args: theme width popups(0|1). Prints one line per problem; shots go to sweep/ev-*.
import { open, out } from './head.mjs';
const theme = process.argv[2] ?? 'light'; const width = Number(process.argv[3] ?? 1440); const popups = process.argv[4] === '1';
const { p, workspace, done, res } = await open(theme, 'app.html', width);
const problems = [];
const say = (where, what) => problems.push(`${where}: ${what}`);

const inspect = () => p.evaluate(() => {
  const found = []; const W = innerWidth; const H = innerHeight;
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).toString().trim().replace(/\s+/g, ' ').slice(0, 50);
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.opacity !== '0' && !el.closest('[inert],[hidden],[aria-hidden="true"]'); };
  const sc = document.scrollingElement; if (sc.scrollHeight - H > 1 || sc.scrollWidth - W > 1) found.push(`page scrolls ${sc.scrollWidth - W}x${sc.scrollHeight - H}`);
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    // Off the window sideways (not inside a horizontal scroller).
    if ((r.right > W + 2 || r.left < -2) && r.width < W) { let s = el.parentElement, inScroller = false; while (s) { const o = getComputedStyle(s).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { inScroller = true; break; } s = s.parentElement; } if (!inScroller) found.push(`off screen: ${label(el)}`); }
    // Text cut off without an ellipsis: a leaf with its own text that overflows a box that hides overflow.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (own && (cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && cs.whiteSpace === 'nowrap') found.push(`text clipped: ${label(el)}`);
    if (own && el.scrollHeight > el.clientHeight + 3 && (cs.overflowY === 'hidden' || cs.overflow === 'hidden') && cs.display !== 'inline' && !cs.webkitLineClamp?.match(/\d/) && el.clientHeight > 0) found.push(`text cut vertically: ${label(el)}`);
  }
  // Controls sitting on top of each other.
  const ctl = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"]')].filter(visible).map((el) => ({ el, r: el.getBoundingClientRect() }));
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
    const a = ctl[i], b = ctl[j]; if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left); const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (x > 4 && y > 4 && x * y > 0.3 * Math.min(a.r.width * a.r.height, b.r.width * b.r.height)) found.push(`overlap: "${label(a.el)}" / "${label(b.el)}"`);
  }
  return [...new Set(found)].slice(0, 12);
});

const popupCheck = (where) => p.evaluate(() => {
  const W = innerWidth, H = innerHeight; const out = [];
  for (const el of document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"], .tf-popover, [data-trigger]')) {
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`popup outside window (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`);
    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'auto') out.push('popup content wider than popup');
  }
  return out;
});

const slug = (s) => s.replace(/\W+/g, '_');
const pages = async (ws) => {
  const loc = p.locator('.tf-nav__label').locator('visible=true');
  const names = [...new Set((await loc.allInnerTexts()).map((s) => s.trim()))].filter((n) => n && n !== 'Search' && n !== 'Settings');
  for (const n of names) {
    const where = `${ws} › ${n}`;
    try {
      await p.keyboard.press('Escape');
      await loc.filter({ hasText: new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click(); await p.waitForTimeout(600);
      for (const x of await inspect()) say(where, x);
      await p.screenshot({ path: `${out}ev-${theme}-${width}-${ws}-${slug(n)}.png` });
      if (popups) {
        const triggers = p.locator('main [aria-haspopup]:visible, main [aria-expanded]:visible');
        const count = Math.min(await triggers.count(), 14);
        for (let i = 0; i < count; i++) {
          const tr = triggers.nth(i); const name = ((await tr.getAttribute('aria-label')) || (await tr.innerText().catch(() => '')) || `#${i}`).trim().replace(/\s+/g, ' ').slice(0, 30);
          try { await tr.click({ timeout: 1500 }); await p.waitForTimeout(350);
            for (const x of await popupCheck()) say(`${where} › ${name}`, x);
            await p.screenshot({ path: `${out}ev-${theme}-${width}-${ws}-${slug(n)}-pop${i}.png` });
          } catch (e) { say(`${where} › ${name}`, 'could not open: ' + String(e.message).split('\n')[0].slice(0, 80)); }
          await p.keyboard.press('Escape'); await p.waitForTimeout(150); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
        }
      }
    } catch (e) { say(where, 'FAILED ' + String(e.message).split('\n')[0].slice(0, 100)); }
  }
};
const fresh = async () => { await p.goto(`http://127.0.0.1:5391/app.html?r=${Date.now()}`); await p.waitForTimeout(2000); };
if (width < 700) { res.push('phone: tab bar only'); } else {
  await pages('team');
  await fresh(); await workspace('Appointments'); await pages('salon');
  await fresh(); await workspace('Tables'); await pages('restaurant');
}
console.log(problems.join('\n') || 'no problems');
await done();
