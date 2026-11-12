// Copies each component's README and writes its preview.html into the artifact folder.
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const out = process.argv[2];
const dirs = readdirSync('src/components', { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`src/components/${d.name}/${d.name}.demo.tsx`)).map((d) => d.name);
for (const n of dirs) {
  const meta = JSON.parse(readFileSync(`src/components/${n}/meta.json`, 'utf8'));
  mkdirSync(`${out}/components/${n}`, { recursive: true });
  writeFileSync(`${out}/components/${n}/preview.html`, `<!-- @dsCard group="${meta.group}" height=${meta.height} -->\n<div id="root"></div>\n<script>Timefix.mount(${JSON.stringify(n)})</script>\n`);
  writeFileSync(`${out}/components/${n}/README.md`, readFileSync(`src/components/${n}/README.md`, 'utf8'));
}
console.log('previews:', dirs.length);
