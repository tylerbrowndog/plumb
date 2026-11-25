// Headless walk-through of the main flows (jsdom). Run: npx tsx e2e/run.tsx
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/', pretendToBeVisual: true });
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
g.localStorage = dom.window.localStorage;
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.IS_REACT_ACT_ENVIRONMENT = true;
g.ResizeObserver = class {
  cb: any;
  constructor(cb: any) {
    this.cb = cb;
  }
  observe() {
    this.cb([]);
  }
  disconnect() {}
};
(dom.window as any).ResizeObserver = g.ResizeObserver;
dom.window.Element.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 390, height: 700, right: 390, bottom: 700, x: 0, y: 0 } as any;
};
(dom.window.Element.prototype as any).setPointerCapture = () => {};
const errors: any[] = [];
const origErr = console.error;
console.error = (...a: any[]) => {
  errors.push(a.join(' '));
  origErr(...a);
};

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React as any;
g.React = React;
const App = (await import('../src/App.tsx')).default;

const root = createRoot(document.getElementById('root')!);
await act(async () => root.render(React.createElement(App)));
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const $$ = (s: string) => [...document.querySelectorAll(s)] as HTMLElement[];
const btn = (text: string) => $$('button').find((b) => b.textContent?.trim().includes(text));
const click = async (el: HTMLElement | undefined, label = '') => {
  if (!el) throw new Error('missing ' + label);
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
};
const ptr = async (type: string, x: number, y: number, id = 1) => {
  const svg = $('svg.plan');
  const ev = new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: id });
  await act(async () => {
    svg.dispatchEvent(ev);
  });
};
const stroke = async (pts: number[][]) => {
  await ptr('pointerdown', pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    for (let t = 0.1; t <= 1.001; t += 0.1) await ptr('pointermove', a[0] + (b[0] - a[0]) * t + (Math.random() - 0.5) * 4, a[1] + (b[1] - a[1]) * t + (Math.random() - 0.5) * 4);
  }
  const l = pts[pts.length - 1];
  await ptr('pointerup', l[0], l[1]);
};
const key = (k: string) => $$('.key').find((b) => b.textContent === k);
const log = (...a: any[]) => console.log('•', ...a);

log('welcome:', $('.welcome h1')?.textContent);
await click(btn('Start a job'), 'start');
log('welcome gone:', !$('.welcome'));
log('title:', $('.job-title').textContent, '| first room card:', $('.first-room h2')?.textContent);
await click(btn('Sketch an odd shape'), 'sketch instead');
log('hint:', $('.hintbar')?.textContent);
await stroke([[110, 150], [330, 150], [330, 420], [110, 420], [112, 155]]);
log('after draw opens wall:', $('.eyebrow')?.textContent, $('.big-len')?.textContent);
await click($('.sheet .icon-btn.close'), 'close first wall');
await click($$('.tool').find((b) => b.textContent === 'Sketch'), 'sketch tool');
await new Promise((r) => setTimeout(r, 300));
const saved = JSON.parse(localStorage.getItem('plumb.jobs.v1') || '[]');
log('saved rooms:', saved[0]?.rooms?.length, JSON.stringify(saved[0]?.rooms?.[0]?.pts));
await stroke([[330, 150], [430, 150], [430, 300], [330, 300], [332, 152]]);
log('labels:', $$('text.lbl').map((t) => t.textContent).join(' | '));
log('wall sheet:', $('.eyebrow')?.textContent, $('.big-len')?.textContent, '|', $('.sub')?.textContent);
for (const k of ['1', '2', "ft '", 'space', '6']) await click(key(k), k);
log('typed preview:', $('.big-len')?.textContent);
await click(btn('Save & next'), 'save');
log('next wall:', $('.eyebrow')?.textContent, $('.big-len')?.textContent);
await click(btn('Use ~'), 'use est');
log('next wall:', $('.eyebrow')?.textContent, $('.big-len')?.textContent);
for (const k of ['1', '5', '0']) await click(key(k), k);
log('typed 150:', $('.big-len')?.textContent);
await click($$('.chip').find((b) => b.textContent?.includes('Door')), 'door chip');
await click(btn('Save & next'), 'save2');
log('labels now:', $$('text.lbl').map((t) => t.textContent).join(' | '));
await click($('.sheet .icon-btn.close'), 'close');
await click($$('.tool').find((b) => b.textContent === 'Window'), 'window tool');
await click($('button[aria-label="Fit to screen"]'), 'fit');
const tr = $('svg.plan > g').getAttribute('transform')!;
const [, tx, ty, kk] = tr.match(/translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/)!.map(Number) as number[];
const dAttr = $('svg.plan > g path[stroke]').getAttribute('d')!;
const nums = dAttr.match(/-?[\d.]+/g)!.map(Number);
const wx = (nums[0] + nums[2]) / 2,
  wy = (nums[1] + nums[3]) / 2;
log('tap world', wx, wy, 'screen', wx * kk + tx, wy * kk + ty);
await ptr('pointerdown', wx * kk + tx, wy * kk + ty);
await ptr('pointerup', wx * kk + tx, wy * kk + ty);
log('after window tap sheet:', $('.h2')?.textContent);
await click(btn('Done'), 'done');
await click($$('.tool').find((b) => b.textContent === 'Select'), 'select');
await ptr('pointerdown', 430, 300);
for (let i = 1; i <= 5; i++) await ptr('pointermove', 430 + i * 6, 300 + i * 6);
await ptr('pointerup', 460, 330);
await click($('button[aria-label=Undo]'), 'undo');
// add a room by typing its size
await click($('button[aria-label="Add a room by its size"]'), 'room btn');
log('add sheet:', $('.add-sheet .h2')?.textContent);
for (const k of ['1', '2']) await click(key(k), k);
await click(btn('Next: width'), 'next width');
for (const k of ['1', '0', 'space', '6']) await click(key(k), k);
log('size fields:', $$('.size-val').map((x) => x.textContent).join(' x '));
await click($$('.add-sheet .chip').find((b) => b.textContent?.includes('Kitchen')), 'kitchen');
await click(btn('Add room'), 'add room');
log('toast:', $('.toast')?.textContent);
log('rooms now:', $$('text.rname').map((t) => t.textContent).join(','), $$('text.rarea').map((t) => t.textContent).join(','));
await new Promise((r) => setTimeout(r, 300));
{
  const s3 = JSON.parse(localStorage.getItem('plumb.jobs.v1') || '[]');
  const kr = s3[0].rooms.find((r: any) => r.name === 'Kitchen');
  log('kitchen walls:', JSON.stringify(kr?.walls), 'pts', JSON.stringify(kr?.pts), 'inPerUnit', s3[0].inPerUnit);
  log('room 1 pts after typing:', JSON.stringify(s3[0].rooms[0].pts), JSON.stringify(s3[0].rooms[0].walls));
}
await click(btn('List'), 'list');
log('hero:', $('.hero')?.textContent);
log('items:\n   ' + $$('.card .item:not(.slim)').map((i) => i.textContent).join('\n   '));
await click($('.cut-head'), 'cut');
log('cut:\n   ' + $$('.stick-txt').slice(0, 3).map((s) => s.textContent).join('\n   '));
await click($$('.cut-head').find((b) => b.textContent?.includes('Assumptions')), 'assump');
log('settings rows:', $$('.settings label').length);
await click($('.job-btn'), 'drawer');
await click(btn('Sample'), 'sample');
await click(btn('List'), 'list2');
log('sample hero:', $('.hero')?.textContent);
log('sample items:\n   ' + $$('.card .item:not(.slim)').map((i) => i.textContent).join('\n   '));
await click(btn('Plan'), 'plan');
{
  const tr2 = $('svg.plan > g').getAttribute('transform')!;
  const [, x2, y2, k2] = tr2.match(/translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/)!.map(Number) as number[];
  await ptr('pointerdown', 60 * k2 + x2, 66 * k2 + y2);
  await ptr('pointerup', 60 * k2 + x2, 66 * k2 + y2);
  log('room sheet:', ($('.name-input') as HTMLInputElement)?.value, '| labels:', $$('.sheet .field-label').map((x) => x.textContent).join(','));
  await click($$('.sheet .seg3 button').find((b) => b.textContent === 'LVP'), 'lvp');
  await click($$('.sheet .seg3 button').find((b) => b.textContent?.includes('Walls')), 'walls');
  await click($$('.sheet .seg3 button').find((b) => b.textContent?.includes('Ceiling')), 'ceil');
  await click($('.sheet .icon-btn.close'), 'close room');
  await click(btn('List'), 'list3');
  log('groups:', $$('.group-head').map((x) => x.textContent).join(','), '| facts:', $('.facts')?.textContent);
  log('forget count:', $$('.item.slim').length);
  await click(btn('Plan'), 'plan2');
}
log('sample labels:', $$('text.lbl').map((t) => t.textContent).join(' | '));
log('rooms:', $$('text.rname').map((t) => t.textContent).join(','), $$('text.rarea').map((t) => t.textContent).join(','));
await ptr('pointerdown', 150, 300, 1);
await ptr('pointerdown', 250, 300, 2);
await ptr('pointermove', 300, 300, 2);
await ptr('pointerup', 300, 300, 2);
await ptr('pointerup', 150, 300, 1);
log('pinch ok');
await click($('.job-btn'), 'drawer2');
await click(btn('Erase all Plumb data'), 'wipe1');
await click(btn('Erase all'), 'wipe2');
log('after wipe jobs:', JSON.parse(localStorage.getItem('plumb.jobs.v1') || '[]').length, '| title:', $('.job-title').textContent);
await click($('button[aria-label="How Plumb works"]'), 'help');
log('help reopens welcome:', !!$('.welcome'));
const { parseImport } = await import('../src/store.ts');
const bad = parseImport(
  JSON.stringify({
    jobs: [
      { name: 'x'.repeat(500), rooms: [{ pts: [{ x: 0, y: 0 }, { x: 'a', y: 1 }, { x: 10, y: 0 }, { x: 10, y: 10 }], walls: [{ lengthIn: 1e9 }] }], openings: [{ room: 'nope' }], settings: { wastePct: 'boom', coats: 1e9 } },
      42,
      null,
    ],
  }),
);
log('import sanitized:', bad.length, bad[0].name.length, bad[0].rooms[0].pts.length, JSON.stringify(bad[0].rooms[0].walls), bad[0].openings.length, bad[0].settings.wastePct, bad[0].settings.coats);
log('console errors:', errors.length);
process.exit(errors.length ? 1 : 0);
