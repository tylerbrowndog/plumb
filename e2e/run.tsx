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
const key = (k: string) => $$('.tk').find((b) => b.textContent === k);
const go = () => $('.tk.go');
const log = (...a: any[]) => console.log('•', ...a);

log('welcome:', $('.welcome h1')?.textContent);
await click(btn('Start a job'), 'start');
log('welcome gone:', !$('.welcome'));
log('title:', $('.job-title').textContent, '| empty plan opens on:', $('.tool.on')?.textContent);
log('hint:', $('.hintbar')?.textContent);
await stroke([[110, 150], [330, 150], [330, 420], [110, 420], [112, 155]]);
log('after draw, still sketching, no bar:', !$('.tapebar'), $('.tool.on')?.textContent);
await new Promise((r) => setTimeout(r, 300));
const saved = JSON.parse(localStorage.getItem('plumb.jobs.v1') || '[]');
log('saved rooms:', saved[0]?.rooms?.length, JSON.stringify(saved[0]?.rooms?.[0]?.pts));
await stroke([[330, 150], [430, 150], [430, 300], [330, 300], [332, 152]]);
log('labels:', $$('text.lbl').map((t) => t.textContent).join(' | '));
await click($$('.tool').find((b) => b.textContent === 'Select'), 'select tool');
await click(btn('Measure'), 'measure');
log('tape bar:', $('.tb-where')?.textContent, $('.tb-len')?.textContent, '| go:', go()?.textContent, '| plan still shown:', !!$('svg.plan'));
for (const k of ['1', '2', 'ft', 'space', '6']) await click(key(k), k);
log('typed preview:', $('.tb-len')?.textContent, '| go:', go()?.textContent);
await click(go(), 'save');
log('next wall:', $('.tb-where')?.textContent, $('.tb-len')?.textContent);
await click(go(), 'use est');
log('next wall:', $('.tb-where')?.textContent, $('.tb-len')?.textContent);
for (const k of ['1', '5', '0']) await click(key(k), k);
log('typed 150:', $('.tb-len')?.textContent);
await click($$('.tapebar .chip').find((b) => b.textContent?.includes('Door')), 'door chip');
log('note:', $('.tb-note')?.textContent);
await click(go(), 'save2');
log('labels now:', $$('text.lbl').map((t) => t.textContent).join(' | '));
await click($('.tapebar .tb-nav.close'), 'close');
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
log('add bar:', !!$('.add-bar'), '| go:', go()?.textContent);
for (const k of ['1', '2']) await click(key(k), k);
await click(go(), 'next width');
for (const k of ['1', '0', 'space', '6']) await click(key(k), k);
log('size fields:', $$('.tb-field .tb-len').map((x) => x.textContent).join(' x '));
await click($$('.add-bar .chip').find((b) => b.textContent?.includes('Kitchen')), 'kitchen');
await click(go(), 'add room');
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

// walk around a fresh room: tap a wall while sketching, type two sides, the rest fill in
await click($('.job-btn'), 'drawer for walk');
await click(btn('New job'), 'new job');
log('new job opens on:', $('.tool.on')?.textContent);
await stroke([[110, 200], [300, 200], [300, 360], [110, 360], [112, 205]]);
{
  const tr3 = $('svg.plan > g').getAttribute('transform')!;
  const [, x3, y3, k3] = tr3.match(/translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/)!.map(Number) as number[];
  const d3 = $('svg.plan > g path[stroke]').getAttribute('d')!.match(/-?[\d.]+/g)!.map(Number);
  const P = (i: number) => ({ x: d3[i * 2] * k3 + x3, y: d3[i * 2 + 1] * k3 + y3 });
  const top = { x: (P(0).x + P(1).x) / 2, y: (P(0).y + P(1).y) / 2 };
  await ptr('pointerdown', top.x, top.y);
  await ptr('pointerup', top.x, top.y);
  log('tap wall while sketching opens bar:', $('.tb-where')?.textContent, $('.tb-len')?.textContent);
  // a real keyboard works too
  const kd = async (k: string) => {
    await act(async () => {
      window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
    });
  };
  for (const k of ['1', '2']) await kd(k);
  log('keyboard typed:', $('.tb-len')?.textContent);
  await kd('Enter');
  log('walked to:', $('.tb-where')?.textContent);
  for (const k of ['1', '0', 'space', '6']) await click(key(k), k);
  await click(go(), 'save side 2');
  log('bar closed when the room is done:', !$('.tapebar'), '| toast:', $('.toast')?.textContent);
  log('walk labels:', $$('text.lbl').map((t) => t.textContent).join(' | '), '| strip:', $('.hintbar')?.textContent);
  log('area:', $$('text.rarea').map((t) => t.textContent).join(','));

  // editing lines like a pro app: select a line, then delete, add a corner, slide it
  const saved = () => JSON.parse(localStorage.getItem('plumb.jobs.v1') || '[]');
  const curRoom = async () => {
    await new Promise((r) => setTimeout(r, 300));
    const js = saved();
    const cur = localStorage.getItem('plumb.current.v1');
    let id = cur;
    try {
      id = JSON.parse(cur || 'null');
    } catch {
      /* stored bare */
    }
    const j = js.find((x: any) => x.id === id) ?? js[js.length - 1];
    return j.rooms;
  };
  const screenOf = () => {
    const tr = $('svg.plan > g').getAttribute('transform')!;
    const [, x, y, k] = tr.match(/translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/)!.map(Number) as number[];
    return (p: { x: number; y: number }) => ({ x: p.x * k + x, y: p.y * k + y });
  };
  const tapAt = async (p: { x: number; y: number }) => {
    await ptr('pointerdown', p.x, p.y);
    await ptr('pointerup', p.x, p.y);
  };
  let rooms = await curRoom();
  let S = screenOf();
  const mid = (r: any, i: number) => S({ x: (r.pts[i].x + r.pts[(i + 1) % r.pts.length].x) / 2, y: (r.pts[i].y + r.pts[(i + 1) % r.pts.length].y) / 2 });
  await tapAt(mid(rooms[0], 1));
  log('selected wall shows grip:', !!$('.wall-grip'), '| bar:', $('.tb-where')?.textContent);
  {
    const m = mid(rooms[0], 1);
    await ptr('pointerdown', m.x, m.y);
    for (let i = 1; i <= 6; i++) await ptr('pointermove', m.x + i * 8, m.y);
    await ptr('pointerup', m.x + 48, m.y);
  }
  const before = JSON.stringify(rooms[0].pts);
  rooms = await curRoom();
  log('slid wall, pts changed:', before !== JSON.stringify(rooms[0].pts), JSON.stringify(rooms[0].pts));
  S = screenOf();
  await tapAt(mid(rooms[0], 1));
  await click(btn('Corner'), 'add corner');
  rooms = await curRoom();
  log('after add corner: corners', rooms[0].pts.length, '| bubble:', $('.bubble')?.textContent, '| toast:', $('.toast')?.textContent);
  await click(btn('Delete corner'), 'delete corner');
  rooms = await curRoom();
  log('after delete corner: corners', rooms[0].pts.length, '| toast has undo:', !!$('.toast-undo'));
  S = screenOf();
  await tapAt(mid(rooms[0], 0));
  await click($('button[aria-label="Delete this line"]'), 'delete line');
  rooms = await curRoom();
  log('after delete line: closed', rooms[0].closed, 'walls', rooms[0].pts.length - 1, '| toast:', $('.toast')?.textContent);
  await click($('.toast-undo'), 'undo from toast');
  rooms = await curRoom();
  log('undo brings it back: closed', rooms[0].closed, 'corners', rooms[0].pts.length);
}
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
