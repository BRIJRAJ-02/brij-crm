import { open } from './head.mjs';
const { p, done, res } = await open('light', 'app.html', 1440);
res.push(JSON.stringify(await p.evaluate(() => { const main = document.querySelector('.tf-app__keep .tf-shell__main'); const v = main.getBoundingClientRect(); const keep = document.querySelector('.tf-app__keep').getBoundingClientRect();
  const kids = Array.from(main.children).map((c) => { const r = c.getBoundingClientRect(); return [c.className, Math.round(r.width), Math.round(r.height), Math.round(r.top)]; });
  return { v: [v.left, v.top, v.width, v.height].map(Math.round), keep: [keep.width, keep.height], kids, inert: !!main.closest('[inert]'), hidden: !!main.closest('[hidden]') }; })));
await done();
