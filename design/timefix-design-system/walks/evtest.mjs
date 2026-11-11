// Proves the sweep's checks fire: plants a clipped label, an off-screen box and two stacked buttons, then runs the same tests.
import { open } from './head.mjs';
const { p, done, res } = await open('light', 'app.html', 1440);
await p.evaluate(() => { const m = document.querySelector('main'); m.insertAdjacentHTML('afterbegin', '<div style="position:relative"><span style="display:block;width:40px;overflow:hidden;white-space:nowrap">A very long label that cannot fit</span><button style="position:absolute;left:0;top:0;width:80px;height:30px">One</button><button style="position:absolute;left:4px;top:2px;width:80px;height:30px">Two</button></div><div style="position:fixed;left:1400px;top:300px;width:300px;height:20px">Off</div>'); });
const src = (await import('node:fs')).readFileSync(new URL('./every.mjs', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('const inspect = () => p.evaluate(') + 'const inspect = () => p.evaluate('.length, src.indexOf('\nconst popupCheck'));
const fn = body.trim().replace(/\);\s*$/, '');
res.push(JSON.stringify(await p.evaluate(`(${fn})()`)));
await done();
