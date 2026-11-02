import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [mode, w, h] of [['popup',560,480],['inline',560,480]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(`https://app.timefix.com/f/graphic-designer?embed=1&mode=${mode}&fid=1&host=http%3A%2F%2Flocalhost%3A3000`, { waitUntil: 'networkidle', timeout: 45000 }).catch(e=>console.log('goto',e.message));
  await p.waitForTimeout(2000);
  await p.screenshot({ path: `/tmp/f-${mode}.png` });
  await p.close();
}
await b.close();
