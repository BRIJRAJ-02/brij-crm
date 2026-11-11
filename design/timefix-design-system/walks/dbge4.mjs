import { open } from './head.mjs';
const { p, done, res } = await open('light', 'app.html', 1440);
res.push(JSON.stringify(await p.evaluate(() => { const main = document.querySelector('.tf-app__keep .tf-shell__main'); const view = main.getBoundingClientRect(); const out = []; const log = [];
  const shown = (r) => r.width > 0 && r.height > 0 && r.bottom > view.top && r.top < view.bottom && r.right > view.left && r.left < view.right;
  const isBlock = (n, r) => { if (r.width < 80 || r.height < 28) return false; const cs = getComputedStyle(n); if (cs.position === 'fixed' || cs.position === 'sticky') return false; return parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0 || cs.boxShadow !== 'none' || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)'); };
  const walk = (parent, d) => { for (const c of Array.from(parent.children)) { const r = c.getBoundingClientRect(); if (d < 4) log.push([d, String(c.className).slice(0, 40), shown(r), c.closest('[hidden], [inert]') !== null]); if (!shown(r)) continue; if (c.closest('[hidden], [inert]')) continue; if (/^H[1-3]$/.test(c.tagName) || (d > 0 && isBlock(c, r))) { out.push(String(c.className).slice(0, 40)); continue; } if (d < 9) walk(c, d + 1); } };
  walk(main, 0); return { out, log: log.slice(0, 30) }; })));
await done();
