// Builds a single self-contained HTML page (for hosting as one file).
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
const out = process.argv[2] || 'dist-single/plumb.html';
const files = readdirSync('dist/assets');
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync('dist/assets/' + f, 'utf8')).join('\n');
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync('dist/assets/' + f, 'utf8')).join('\n').replace(/<\/script/gi, '<\\/script');
const html = `<meta charset="utf-8">
<title>Plumb</title>
<meta name="description" content="Sketch rooms, tap walls to measure, get the exact trim, flooring, tile and paint list.">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true });
writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024).toFixed(0) + ' KB');
