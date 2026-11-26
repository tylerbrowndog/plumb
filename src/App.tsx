import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MousePointer2, PenLine, SquarePlus, DoorOpen, AppWindow, Undo2, Redo2, Maximize, Menu, ChevronDown, CircleHelp, Trash2, Settings2, Lock, Mic, TriangleAlert } from 'lucide-react';
import { canDeleteCorner, closeRun, deleteCorner, deleteWall, deleteWallEffect, splitWall } from './edit';

/** a short tick under the thumb, where the phone allows it */
const buzz = (ms = 10) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not on this phone */
  }
};
import type { Job, Opening, Selection, Tool } from './types';
import PlanCanvas, { type View } from './PlanCanvas';
import { AddRoomSheet, OpeningSheet, RoomSheet, WallSheet } from './Sheets';
import Materials from './Materials';
import Jobs from './Jobs';
import { loadCurrent, loadJobs, markTip, markWelcome, newJob, newRoom, sampleJob, saveCurrent, saveJobs, seenTip, seenWelcome, wipeAll } from './store';
import Welcome from './Welcome';
import { bounds, isVerified, wallCount, wallEnds, lerp, roomBySize } from './geometry';
import { fmtFtIn } from './units';
import { estimate } from './estimate';
import VoicePanel, { type VLine } from './Voice';
import { isEcho, makeEar, prepareEars, earKind, setTalkBack, speak, stopSpeaking, talkBackOn, type EarKind } from './speech';
import { runVoice, type VoiceMemory } from './voiceRun';
import { findIssues, lengthWarning, type Issue } from './checks';

const TOOLS: { t: Tool | 'add'; icon: typeof PenLine; label: string }[] = [
  { t: 'select', icon: MousePointer2, label: 'Select' },
  { t: 'add', icon: SquarePlus, label: 'Room' },
  { t: 'draw', icon: PenLine, label: 'Sketch' },
  { t: 'door', icon: DoorOpen, label: 'Door' },
  { t: 'window', icon: AppWindow, label: 'Window' },
];

const HINTS: Record<Tool, string> = {
  select: 'Tap a line to measure, move or delete it. Tap a corner to drag or delete it.',
  draw: 'Draw walls with a finger. Corners snap square. Tap a wall to measure it.',
  rect: 'Drag corner to corner for a square room.',
  door: 'Tap a wall where the door goes.',
  window: 'Tap a wall where the window goes.',
};

// what one step on the plan was, in a few words, for the note that undo and redo show
function describeAction(before: Job, after: Job): string {
  const added = after.rooms.filter((r) => !before.rooms.some((x) => x.id === r.id));
  const gone = before.rooms.filter((r) => !after.rooms.some((x) => x.id === r.id));
  if (added.length && !gone.length) return added.length > 1 ? 'new rooms' : `new ${added[0].name}`;
  if (gone.length && !added.length) return gone.length > 1 ? 'deleted rooms' : `deleted ${gone[0].name}`;
  const oAdd = after.openings.filter((o) => !before.openings.some((x) => x.id === o.id));
  const oGone = before.openings.filter((o) => !after.openings.some((x) => x.id === o.id));
  const kind = (o: Opening) => (o.type === 'window' ? 'window' : o.type === 'opening' ? 'opening' : 'door');
  if (oAdd.length && !oGone.length) return `new ${kind(oAdd[0])}`;
  if (oGone.length && !oAdd.length) return `deleted ${kind(oGone[0])}`;
  let taped = false,
    moved = false,
    shape = false;
  for (const r of after.rooms) {
    const f = before.rooms.find((x) => x.id === r.id);
    if (!f) continue;
    if (r.pts.length !== f.pts.length) shape = true;
    else if (r.pts.some((q, i) => q.x !== f.pts[i].x || q.y !== f.pts[i].y)) moved = true;
    if (r.walls.some((w, i) => !w.predicted && (w.lengthIn ?? 0) !== (f.walls[i]?.lengthIn ?? 0))) taped = true;
  }
  if (taped) return 'tape length';
  if (shape) return 'corner change';
  if (moved) return 'move';
  if (after.openings.some((o) => { const f = before.openings.find((x) => x.id === o.id); return f && f.t !== o.t; })) return 'move';
  return 'last change';
}

function initial() {
  let jobs = loadJobs();
  if (!jobs.length) jobs = [newJob('My first job')];
  const cur = loadCurrent();
  const id = jobs.find((j) => j.id === cur)?.id ?? jobs[0].id;
  return { jobs, id };
}

export default function App() {
  const init = useMemo(initial, []);
  const [jobs, setJobs] = useState<Job[]>(init.jobs);
  const [curId, setCurId] = useState(init.id);
  const job = jobs.find((j) => j.id === curId) ?? jobs[0];
  const jobRef = useRef(job);
  jobRef.current = job;

  // an empty plan opens ready to draw, like a pad of paper
  const [tool, setTool] = useState<Tool>(() => (job.rooms.length ? 'select' : 'draw'));
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState<Selection>(null);
  const [tab, setTab] = useState<'plan' | 'list'>('plan');
  const [drawer, setDrawer] = useState(false);
  const [allow45, setAllow45] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastUndo, setToastUndo] = useState(false);
  const [welcome, setWelcome] = useState(() => !seenWelcome() && !init.jobs.some((j) => j.rooms.length));
  const hist = useRef<Record<string, { past: Job[]; future: Job[] }>>({});
  const [, bump] = useState(0);
  const mainRef = useRef<HTMLDivElement>(null);
  const [mainSize, setMainSize] = useState({ w: 390, h: 700 });
  const [view, setView] = useState<View>({ x: 60, y: 120, k: 2 });
  // the camera glides when the app moves it (fit, follow the picked wall), like a CAD zoom; a finger always wins
  const viewRef = useRef(view);
  viewRef.current = view;
  const glide = useRef({ raf: 0, last: null as View | null });
  const glideTo = (to: View, ms = 260) => {
    cancelAnimationFrame(glide.current.raf);
    const from = viewRef.current;
    const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still || (Math.abs(from.k - to.k) < 1e-3 && Math.hypot(from.x - to.x, from.y - to.y) < 1)) {
      setView(to);
      return;
    }
    const t0 = performance.now();
    glide.current.last = from;
    const step = (now: number) => {
      // the user grabbed the plan mid-glide: stop and leave it where they put it
      if (viewRef.current !== glide.current.last) return;
      const t = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      // zoom in log space so it feels even
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      // keep the point that ends at screen centre moving in a straight line
      const v = { k, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      glide.current.last = v;
      viewRef.current = v;
      setView(v);
      if (t < 1) glide.current.raf = requestAnimationFrame(step);
    };
    glide.current.raf = requestAnimationFrame(step);
  };
  // Sketch goes back to Select after each room, unless it is locked on (tap Sketch again)
  const [sketchLock, setSketchLock] = useState(false);
  const [hud, setHud] = useState<{ text: string; n: number; ms: number } | null>(null);
  const showHud = (text: string, ms = 900) => {
    setHud((h) => ({ text, n: (h?.n ?? 0) + 1, ms }));
    window.clearTimeout((showHud as unknown as { t?: number }).t);
    (showHud as unknown as { t?: number }).t = window.setTimeout(() => setHud(null), ms);
  };

  const toast = useCallback((s: string, undoable = false) => {
    setToastMsg(s);
    setToastUndo(undoable);
    if (undoable) buzz(14);
    window.clearTimeout((toast as unknown as { t?: number }).t);
    (toast as unknown as { t?: number }).t = window.setTimeout(() => setToastMsg(null), undoable ? 4500 : 1800);
  }, []);

  // ----- voice: you call it out, Plumb writes it down -----
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [vlines, setVlines] = useState<VLine[]>([]);
  const [vwarn, setVwarn] = useState(false);
  const [talk, setTalk] = useState(talkBackOn);
  const [ear, setEar] = useState<EarKind>('keyboard');
  const vmem = useRef<VoiceMemory>({});
  const vinput = useRef<HTMLInputElement>(null);
  const vline = useRef(0);
  const selRef = useRef<Selection>(null);
  const tabRef = useRef<'plan' | 'list'>('plan');
  const talkRef = useRef(talk);
  talkRef.current = talk;
  const heardRef = useRef<(t: string) => void>(() => undefined);
  const earRef = useRef<ReturnType<typeof makeEar> | null>(null);
  useEffect(() => {
    prepareEars();
    const t = setTimeout(() => setEar(earKind()), 600);
    return () => clearTimeout(t);
  }, []);
  const getEar = () =>
    (earRef.current ||= makeEar({
      partial: (t) => setPartial(t),
      final: (t) => {
        setPartial('');
        if (isEcho(t)) return;
        heardRef.current(t);
      },
      state: (on, why) => {
        setListening(on);
        if (!on) setPartial('');
        if (why === 'denied') {
          setEar('keyboard');
          pushLines([{ text: 'The mic is off for Plumb here. Tap the box and use the keyboard\'s mic.', tone: 'warn' }]);
        }
      },
    }));
  const pushLines = (ls: Omit<VLine, 'id'>[]) => setVlines((v) => [...v, ...ls.map((l) => ({ ...l, id: ++vline.current }))].slice(-12));
  /** from a tap: open the strip and start the mic in the same tap, or put the cursor in the box for the keyboard's mic */
  const startVoice = () => {
    setVoiceOpen(true);
    const k = getEar().start();
    setEar(k);
    if (k === 'keyboard') vinput.current?.focus();
    if (!seenTip('voice')) {
      markTip('voice');
      pushLines([{ text: k === 'keyboard' ? 'Tap the mic on your keyboard and call it out: "12 foot 6, next"' : 'Call it out: "12 foot 6, next". Say "no, 12 foot" to fix one.', tone: 'info' }]);
    }
  };
  const stopVoice = () => {
    earRef.current?.stop();
    stopSpeaking();
    setListening(false);
  };

  useEffect(() => {
    const t = setTimeout(() => saveJobs(jobs), 250);
    return () => clearTimeout(t);
  }, [jobs]);
  useEffect(() => saveCurrent(curId), [curId]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setMainSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);

  const H = () => (hist.current[curId] ||= { past: [], future: [] });

  const setJob = (next: Job) => setJobs((js) => js.map((j) => (j.id === next.id ? next : j)));

  const commit = useCallback(
    (fn: (j: Job) => Job) => {
      const prev = jobRef.current;
      const next = { ...fn(prev), updatedAt: Date.now() };
      const h = (hist.current[prev.id] ||= { past: [], future: [] });
      h.past.push(prev);
      if (h.past.length > 200) h.past.shift();
      h.future = [];
      jobRef.current = next;
      setJobs((js) => js.map((j) => (j.id === next.id ? next : j)));
    },
    [],
  );

  const undo = () => {
    const h = H();
    const p = h.past.pop();
    if (!p) {
      showHud('Nothing to undo');
      return;
    }
    const cur = jobRef.current;
    h.future.push(cur);
    jobRef.current = p;
    setJob(p);
    setSel(null);
    // back to a blank page: be ready to draw again
    if (!p.rooms.length) {
      setAdding(false);
      setTool('draw');
    }
    buzz(10);
    showHud(`Undid ${describeAction(p, cur)}`);
    bump((n) => n + 1);
  };
  const redo = () => {
    const h = H();
    const f = h.future.pop();
    if (!f) {
      showHud('Nothing to redo');
      return;
    }
    const cur = jobRef.current;
    h.past.push(cur);
    jobRef.current = f;
    setJob(f);
    setSel(null);
    // the first room came back: one finger looks around again
    if (!cur.rooms.length && f.rooms.length && tool === 'draw' && !sketchLock) setTool('select');
    buzz(10);
    showHud(`Redid ${describeAction(cur, f)}`);
    bump((n) => n + 1);
  };

  const delRoom = (id: string) => {
    const r = job.rooms.find((x) => x.id === id);
    if (!r) return;
    commit((j) => ({ ...j, rooms: j.rooms.filter((x) => x.id !== id), openings: j.openings.filter((o) => o.room !== id) }));
    setSel(null);
    toast(`${r.name} deleted.`, true);
  };
  const delOpening = (id: string) => {
    const o = job.openings.find((x) => x.id === id);
    if (!o) return;
    commit((j) => ({ ...j, openings: j.openings.filter((x) => x.id !== id) }));
    setSel(null);
    toast(`${o.type === 'door' ? 'Door' : o.type === 'window' ? 'Window' : 'Opening'} deleted.`, true);
  };
  const delCorner = (room: string, idx: number) => {
    const r = job.rooms.find((x) => x.id === room);
    if (!r || !canDeleteCorner(r)) return;
    commit((j) => deleteCorner(j, room, idx));
    setSel(null);
    toast('Corner deleted. The lines on each side are one line now.', true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null;
      const typing = !!tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable);
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && sel && sel.kind !== 'wall') {
        e.preventDefault();
        if (sel.kind === 'corner') delCorner(sel.room, sel.idx);
        else if (sel.kind === 'opening') delOpening(sel.id);
        else if (sel.kind === 'room') delRoom(sel.room);
        return;
      }
      if (e.key === 'Escape') {
        if (drawer) setDrawer(false);
        else if (adding) setAdding(false);
        else if (sel) setSel(null);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ----- view helpers -----
  const RAIL = 72,
    RIGHT = 10;
  // how much of the bottom each bar covers (its height plus the gap under it)
  const sheetH = sel ? (sel.kind === 'wall' ? 226 : sel.kind === 'room' ? 308 : sel.kind === 'opening' ? 356 : 70) : adding ? 228 : 70;
  // where the tools float: the left rail and the view buttons. The plan fits beside them, or below
  // the rail across the full width, whichever lets it draw bigger (a phone held upright: usually below)
  const toolRects = () => {
    const rect = (sel: string, fb: { l: number; t: number; r: number; b: number }) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el ? { l: el.offsetLeft, t: el.offsetTop, r: el.offsetLeft + el.offsetWidth, b: el.offsetTop + el.offsetHeight } : fb;
    };
    // the undo buttons slide with the bar under them, so work out where they will rest, not where they are mid-slide
    const vb = mainSize.h - sheetH - 8;
    const vw = (document.querySelector('.view-ctl') as HTMLElement | null)?.offsetWidth || 146;
    return [rect('.rail', { l: 10, t: 8, r: RAIL, b: 320 }), { l: mainSize.w - 10 - vw, t: vb - 48, r: mainSize.w - 10, b: vb }];
  };
  const PAD = 30; // the length tags sit just outside each wall
  const fitAreas = () => {
    const [rail, vc] = toolRects();
    // the undo buttons sit just above the bottom bar on the right: the plan goes above them,
    // or beside them down to the bar, whichever draws it bigger
    const bottom = mainSize.h - 92;
    return [
      { x0: rail.r + 6, x1: mainSize.w - 8, y0: 12, y1: vc.t - 6 },
      { x0: 8, x1: mainSize.w - 8, y0: rail.b + 6, y1: vc.t - 6 },
      { x0: rail.r + 6, x1: vc.l - 6, y0: 12, y1: bottom },
      { x0: 8, x1: vc.l - 6, y0: rail.b + 6, y1: bottom },
    ];
  };
  const fit = useCallback(
    (j: Job = jobRef.current, instant = false) => {
      const b = bounds(j);
      if (!b) {
        const k = (mainSize.w * 0.55) / 144;
        setView({ k, x: mainSize.w / 2 - 72 * k, y: mainSize.h * 0.4 - 60 * k });
        return;
      }
      const bw = Math.max(24, b.maxX - b.minX),
        bh = Math.max(24, b.maxY - b.minY);
      let best: { k: number; x: number; y: number } | null = null;
      for (const a of fitAreas()) {
        const aw = a.x1 - a.x0 - PAD * 2,
          ah = a.y1 - a.y0 - PAD * 2;
        if (aw < 60 || ah < 60) continue;
        const k = Math.min(aw / bw, ah / bh, 8);
        // the side area wins ties: it keeps the plan higher on the screen
        if (!best || k > best.k * 1.08)
          best = { k, x: a.x0 + PAD + (aw - bw * k) / 2 - b.minX * k, y: a.y0 + PAD + (ah - bh * k) / 2 - b.minY * k };
      }
      if (best) {
        if (instant) {
          cancelAnimationFrame(glide.current.raf);
          setView(best);
        } else glideTo(best);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mainSize],
  );

  const fitted = useRef<string>('');
  useEffect(() => {
    if (tab !== 'plan') return;
    const key = curId + ':' + mainSize.w + 'x' + mainSize.h;
    if (fitted.current === key) return;
    fitted.current = key;
    fit(undefined, true);
  }, [curId, mainSize, fit, tab]);

  // keep the selected wall, or door or window, visible above its bar
  useEffect(() => {
    let m: { x: number; y: number } | null = null;
    if (sel?.kind === 'wall') {
      const r = job.rooms.find((x) => x.id === sel.room);
      if (!r) return;
      const [a, b] = wallEnds(r, sel.wall);
      m = lerp(a, b, 0.5);
    } else if (sel?.kind === 'opening') {
      const o = job.openings.find((x) => x.id === sel.id);
      const r = o && job.rooms.find((x) => x.id === o.room);
      if (!o || !r || o.wall >= wallCount(r)) return;
      const [a, b] = wallEnds(r, o.wall);
      m = lerp(a, b, o.t);
    }
    if (sel?.kind === 'room') {
      // a picked room: lift it so it isn't hidden behind its bar
      const r = job.rooms.find((x) => x.id === sel.room);
      if (!r || !r.pts.length) return;
      const ys = r.pts.map((q) => q.y),
        xs = r.pts.map((q) => q.x);
      const y0 = Math.min(...ys),
        y1 = Math.max(...ys),
        x0 = Math.min(...xs),
        x1 = Math.max(...xs);
      const [rail] = toolRects();
      const follow = (v: View): View => {
        // the room and its length tags fit between the top and the undo buttons over the bar
        const top = 12 + PAD,
          bottom = mainSize.h - sheetH - 58 - PAD;
        const s0 = y0 * v.k + v.y,
          s1 = y1 * v.k + v.y;
        if (s0 >= top && s1 <= bottom) return v;
        const roomH = (y1 - y0) * v.k;
        if (roomH <= bottom - top) {
          // it fits as drawn: slide it only as far as it takes
          const dy = s1 > bottom ? bottom - s1 : top - s0;
          return { ...v, y: v.y + dy };
        }
        // too tall for the space: zoom out to the room, like a CAD zoom-to-selection
        const left = rail.r + 6 + PAD,
          right = mainSize.w - 8 - PAD;
        const k = Math.min(v.k, (bottom - top) / Math.max(1, y1 - y0), (right - left) / Math.max(1, x1 - x0));
        zoomedOut.current = true;
        return { k, x: (left + right) / 2 - ((x0 + x1) / 2) * k, y: (top + bottom) / 2 - ((y0 + y1) / 2) * k };
      };
      const to = follow(viewRef.current);
      if (to !== viewRef.current) glideTo(to);
      return;
    }
    if (!m) return;
    const pt = m;
    const tools = toolRects();
    const follow = (v: View): View => {
      const sx = pt.x * v.k + v.x,
        sy = pt.y * v.k + v.y;
      const top = 24,
        bottom = mainSize.h - sheetH - 30;
      const underTool = tools.some((q) => sx > q.l - 14 && sx < q.r + 14 && sy > q.t - 14 && sy < q.b + 14);
      if (sy > top && sy < bottom && sx > 16 && sx < mainSize.w - 16 && !underTool) return v;
      // move only as far as it takes, so the plan doesn't jump
      const ty = sy > bottom ? bottom - 50 : sy < top ? top + 50 : sy;
      const tx = underTool || sx < 16 || sx > mainSize.w - 16 ? RAIL + (mainSize.w - RAIL - RIGHT) / 2 : sx;
      return { ...v, x: v.x + (tx - sx), y: v.y + (ty - sy) };
    };
    const to = follow(viewRef.current);
    if (to !== viewRef.current) glideTo(to, 220);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel && sel.kind === 'wall' ? sel.room + sel.wall : sel?.kind === 'opening' ? sel.id : sel?.kind === 'room' ? 'room:' + sel.room : null]);

  // when a bar closes, bring the plan back into view if measuring or panning left part of it under the tools
  const refitIfHidden = (pad = 24) => {
    if (tab !== 'plan') return;
    const b = bounds(jobRef.current);
    if (!b) return;
    const l = b.minX * view.k + view.x - pad,
      r = b.maxX * view.k + view.x + pad,
      t = b.minY * view.k + view.y - pad,
      bt = b.maxY * view.k + view.y + pad;
    const under = toolRects().some((q) => l < q.r && r > q.l && t < q.b && bt > q.t);
    if (under || l < 0 || r > mainSize.w || t < 0 || bt > mainSize.h - 84) fit();
  };
  const hadBar = useRef(false);
  // set when a picked room zoomed the plan out to fit over its bar; closing the bar zooms back
  const zoomedOut = useRef(false);
  useEffect(() => {
    const open = !!sel || adding;
    const was = hadBar.current;
    hadBar.current = open;
    if (!was || open) return;
    if (zoomedOut.current) {
      zoomedOut.current = false;
      fit();
      return;
    }
    refitIfHidden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, adding]);
  // a new room drawn partly under the tools or off the edge: bring the whole plan into view
  const roomCount = useRef(job.rooms.length);
  useEffect(() => {
    const was = roomCount.current;
    roomCount.current = job.rooms.length;
    if (job.rooms.length > was && !sel && !adding) {
      // a plan sketched small (a tablet, a quick doodle) zooms up so its tags are big enough to tap
      const bb = bounds(jobRef.current);
      const area = fitAreas()[0];
      if (bb && tab === 'plan') {
        const sw = (bb.maxX - bb.minX) * view.k,
          sh = (bb.maxY - bb.minY) * view.k;
        if (sw < (area.x1 - area.x0) * 0.42 && sh < (area.y1 - area.y0) * 0.42) {
          fit();
          return;
        }
      }
      refitIfHidden(-4);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.rooms.length, curId]);

  const firstUnverified = () => {
    for (const r of job.rooms) for (let i = 0; i < wallCount(r); i++) if (!isVerified(r, i)) return { room: r.id, wall: i };
    return null;
  };

  const est = useMemo(() => estimate(job), [job]);
  const unverified = est.totalWalls - est.verifiedWalls;
  // the moment the last wall gets its tape length, say so once
  const prevUnverified = useRef<{ id: string; n: number }>({ id: curId, n: unverified });
  useEffect(() => {
    const p = prevUnverified.current;
    if (p.id === curId && p.n > 0 && unverified === 0 && est.totalWalls > 0) showHud('Every wall measured. List is exact.', 2600);
    prevUnverified.current = { id: curId, n: unverified };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curId, unverified, est.totalWalls]);

  const openJob = (id: string) => {
    setCurId(id);
    setSel(null);
    setDrawer(false);
    setTab('plan');
    setTool(jobs.find((j) => j.id === id)?.rooms.length ? 'select' : 'draw');
    setAdding(false);
  };

  const addRoom = (name: string, L: number, W: number) => {
    const j0 = jobRef.current;
    const taken = new Set(j0.rooms.map((r) => r.name));
    let nm = name;
    for (let i = 2; taken.has(nm); i++) nm = `${name} ${i}`;
    const room = newRoom(nm, roomBySize(j0, L, W), true);
    room.walls = room.walls.map((w, i) => ({ ...w, lengthIn: i % 2 === 0 ? L : W }));
    commit((j) => ({ ...j, rooms: [...j.rooms, room], inPerUnit: j.scaleSet ? j.inPerUnit : 1, scaleSet: true }));
    setAdding(false);
    setTool('select');
    setSel(null);
    fit();
    toast(`${nm} added, ${fmtFtIn(L)} by ${fmtFtIn(W)}.`);
  };

  selRef.current = sel;
  tabRef.current = tab;
  const doVoice = (text: string) => {
    const out = runVoice(
      text,
      {
        job: () => jobRef.current,
        commit,
        sel: () => selRef.current,
        setSel: (x) => {
          selRef.current = x;
          setSel(x);
        },
        undo,
        redo,
        tab: () => tabRef.current,
        setTab: (t) => {
          tabRef.current = t;
          setTab(t);
          if (t === 'plan') setAdding(false);
        },
        addRoom,
        openAddRoom: () => {
          setTab('plan');
          setSel(null);
          setAdding(true);
        },
        stop: stopVoice,
        help: () => pushLines([{ text: 'Tap "What can I say?" for examples', tone: 'info' }]),
      },
      vmem.current,
    );
    pushLines([{ text: `“${text.trim()}”`, tone: "info" }, ...out.lines]);
    setVwarn(out.warn);
    if (out.warn) buzz(30);
    if (talkRef.current && out.say) speak(out.say);
  };
  heardRef.current = doVoice;
  const issues = useMemo(() => findIssues(job), [job]);
  const warnIssues = issues.filter((i) => i.level === 'warn');
  const goIssue = (i: Issue) => {
    setTab('plan');
    setTool('select');
    setAdding(false);
    if (i.room && i.wall != null) setSel({ kind: 'wall', room: i.room, wall: i.wall });
    else if (i.room) setSel({ kind: 'room', room: i.room });
    toast(i.fix);
  };

  const selRoom = sel && sel.kind !== 'opening' ? job.rooms.find((r) => r.id === sel.room) : null;
  const selOpening = sel?.kind === 'opening' ? job.openings.find((o) => o.id === sel.id) : null;

  return (
    <div className={`app ${voiceOpen ? 'voicing' : ''}`}>
      <header className="top">
        <button className="job-btn" onClick={() => setDrawer(true)} aria-label={`Jobs. Current job: ${job.name}`}>
          <Menu size={20} />
          <span className="job-title">{job.name}</span>
          <ChevronDown size={16} className="muted" />
        </button>
        <div className="tabs" role="group" aria-label="View">
          <button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')} aria-pressed={tab === 'plan'}>
            Plan
          </button>
          <button className={tab === 'list' ? 'on' : ''} onClick={() => { setTab('list'); setSel(null); }} aria-pressed={tab === 'list'} aria-label={unverified > 0 && job.rooms.length > 0 ? `List, ${unverified} walls not measured yet` : 'List'}>
            List
            {unverified > 0 && job.rooms.length > 0 && <span className="badge">{unverified}</span>}
          </button>
        </div>
        <button className={`icon-btn mic ${listening ? 'on' : voiceOpen ? 'open' : ''}`} onClick={() => (listening ? stopVoice() : startVoice())} aria-label={listening ? 'Stop listening' : 'Talk to Plumb'} aria-pressed={listening}>
          <Mic size={20} />
        </button>
        <button className="icon-btn help" onClick={() => setWelcome(true)} aria-label="How Plumb works">
          <CircleHelp size={20} />
        </button>
      </header>

      <VoicePanel
        ref={vinput}
        open={voiceOpen}
        listening={listening}
        kind={ear}
        partial={partial}
        lines={vlines}
        warn={vwarn}
        talk={talk}
        placeholder={tab === 'list' ? 'Say or type: 2 tubes of caulk, shims' : 'Say or type: 12 6, next'}
        onMic={() => (listening ? stopVoice() : startVoice())}
        onClose={() => {
          stopVoice();
          setVoiceOpen(false);
        }}
        onTalk={() => {
          const on = !talk;
          setTalk(on);
          setTalkBack(on);
          if (!on) stopSpeaking();
        }}
        onRun={doVoice}
        onKeep={() => doVoice('keep it')}
        onUndo={() => doVoice('undo')}
      />

      {tab === 'plan' ? (
        <div className="main" ref={mainRef}>
          <PlanCanvas
            job={job}
            sel={sel}
            setSel={setSel}
            tool={tool}
            setTool={setTool}
            commit={commit}
            view={view}
            setView={setView}
            allow45={allow45}
            onUndo={undo}
            onRedo={redo}
            onFit={() => {
              fit();
              showHud('Whole plan');
            }}
            onDrawn={() => {
              if (sketchLock) return;
              setTool('select');
              if (!seenTip('pan')) {
                markTip('pan');
                toast('Room drawn. Drag with one finger to look around. Two-finger tap undoes.');
              }
            }}
          />

          {hud && (
            <div key={hud.n} className={`hud ${hud.ms > 900 ? 'win' : ''}`} style={{ animationDuration: `${hud.ms}ms` }} role="status" aria-live="polite">
              {hud.text}
            </div>
          )}

          {job.rooms.length === 0 && !adding && (tool === 'draw' || tool === 'rect') && (
            <div className="empty-plan" aria-hidden="true">
              <svg width="168" height="128" viewBox="0 0 168 128">
                <path id="emptyPath" d="M24 22 H144 V106 H24 Z" fill="none" stroke="var(--pencil)" strokeWidth="1.5" strokeDasharray="5 6" strokeLinejoin="round" opacity="0.7" />
                <path d="M24 22 H144 V106 H24 Z" pathLength="100" fill="none" stroke="var(--wall)" strokeWidth="2" strokeLinejoin="round" strokeDasharray="100 100" strokeDashoffset="100">
                  <animate attributeName="stroke-dashoffset" dur="3.2s" repeatCount="indefinite" values="100;0;0;100" keyTimes="0;0.75;0.97;1" />
                </path>
                <circle r="9" fill="var(--accent)" opacity="0.28">
                  <animateMotion dur="3.2s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.75;1" calcMode="linear">
                    <mpath href="#emptyPath" />
                  </animateMotion>
                </circle>
                <circle r="4.5" fill="var(--accent)">
                  <animateMotion dur="3.2s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.75;1" calcMode="linear">
                    <mpath href="#emptyPath" />
                  </animateMotion>
                </circle>
              </svg>
              <p>Draw your first room here</p>
            </div>
          )}

          <div className="view-ctl" style={{ bottom: `calc(var(--safe-b) + ${sheetH + 8}px)` }}>
            <button className="vbtn" onClick={undo} disabled={!H().past.length} aria-label="Undo">
              <Undo2 size={20} />
            </button>
            <button className="vbtn" onClick={redo} disabled={!H().future.length} aria-label="Redo">
              <Redo2 size={20} />
            </button>
            <button className="vbtn" onClick={() => fit()} aria-label="Fit to screen">
              <Maximize size={19} />
            </button>
          </div>

          {!sel && !adding && (
            <div className="hintbar" aria-live="polite">
              {job.rooms.length === 0 ? (
                <>
                  <span className="strip-hint">{tool === 'draw' ? 'Draw a room with your finger. Corners snap square.' : HINTS[tool]}</span>
                  <button className="mini" onClick={() => setAdding(true)}>
                    Type a size
                  </button>
                </>
              ) : tool === 'door' || tool === 'window' ? (
                <>
                  <span className="strip-hint">{HINTS[tool]}</span>
                  <button className="mini on" onClick={() => setTool('select')}>
                    Done
                  </button>
                </>
              ) : (
                <>
                  <div className="strip-main">
                    <span className="strip-line">
                      {unverified > 0 ? (
                        <>
                          <b>{est.verifiedWalls}</b> of {est.totalWalls} {mainSize.w < 380 ? 'measured' : 'walls measured'}
                        </>
                      ) : (
                        <>{mainSize.w < 380 ? 'All measured' : `All ${est.totalWalls} walls measured`}</>
                      )}
                    </span>
                    <span className="tape-progress" role="img" aria-label={`${est.verifiedWalls} of ${est.totalWalls} walls measured`}>
                      <span style={{ width: `${est.totalWalls ? (est.verifiedWalls / est.totalWalls) * 100 : 0}%` }} />
                    </span>
                  </div>
                  {(tool === 'draw' || tool === 'rect') && (
                    <button className={`mini ${allow45 ? 'on' : ''}`} onClick={() => {
                        setAllow45(!allow45);
                        toast(allow45 ? 'Corners snap square again.' : '45° walls on. A slanted stroke stays slanted, for bays and angled corners.');
                      }} aria-pressed={allow45} aria-label="Allow 45 degree walls">
                      45°
                    </button>
                  )}
                  {warnIssues.length > 0 && (
                    <button className="mini warn" onClick={() => goIssue(warnIssues[0])} aria-label={`${warnIssues.length} ${warnIssues.length === 1 ? 'thing' : 'things'} to check: ${warnIssues[0].text}`}>
                      <TriangleAlert size={15} /> {warnIssues.length}
                    </button>
                  )}
                  {unverified > 0 ? (
                    <button
                      className="mini on"
                      onClick={() => {
                        const f = firstUnverified();
                        if (f) setSel({ kind: 'wall', ...f });
                      }}
                    >
                      Measure
                    </button>
                  ) : (
                    <button className="mini on" onClick={() => setTab('list')}>
                      See list
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <nav className="rail" aria-label="Drawing tools">
            {TOOLS.map(({ t, icon: Icon, label }) => (
              <button
                key={t}
                className={`tool ${(t === 'add' ? adding : tool === t && !adding) ? 'on' : ''}`}
                title={HINTS[t === 'add' ? 'rect' : t]}
                onClick={() => {
                  if (t === 'add') {
                    setSel(null);
                    setAdding(true);
                  } else if (t === 'draw' && tool === 'draw' && !adding) {
                    // tap Sketch again to keep it on for room after room
                    const on = !sketchLock;
                    setSketchLock(on);
                    setSel(null);
                    toast(on ? 'Sketch stays on. Draw room after room, then pick Select.' : 'Sketch goes back to Select after each room.');
                  } else {
                    setAdding(false);
                    setSel(null);
                    if (t !== 'draw') setSketchLock(false);
                    setTool(t);
                  }
                }}
                aria-label={t === 'add' ? 'Add a room by its size' : label}
                aria-pressed={t === 'add' ? adding : tool === t && !adding}
              >
                <Icon size={22} strokeWidth={2.1} />
                <span>{label}</span>
                {t === 'draw' && sketchLock && (
                  <i className="tool-lock" aria-label="stays on">
                    <Lock size={10} strokeWidth={2.6} />
                  </i>
                )}
              </button>
            ))}
          </nav>

          {sel?.kind === 'wall' && selRoom && sel.wall < wallCount(selRoom) && (
            <WallSheet
              job={job}
              room={selRoom}
              wall={sel.wall}
              commit={commit}
              onSelectWall={(room, wall) => setSel({ kind: 'wall', room, wall })}
              onMeasured={(before, after, room, wall, inches) => {
                const w = lengthWarning(before, after, room, wall, inches);
                if (w) {
                  buzz(30);
                  toast(w.replace(/Say "no" and the right number(, or "keep it")?\.?/, 'Undo to fix it.').replace(/Say "no" and the number, or "keep it"\./, 'Undo if that is a slip.'), true);
                }
              }}
              onClose={() => setSel(null)}
              onDelete={() => {
                const eff = deleteWallEffect(selRoom, sel.wall);
                const id = selRoom.id,
                  w = sel.wall;
                commit((j) => deleteWall(j, id, w));
                setSel(null);
                toast(eff === 'opens' ? `Line deleted. ${selRoom.name} is open there now.` : eff === 'splits' ? 'Line deleted. The run is in two parts now.' : eff === 'room' ? `${selRoom.name} deleted.` : 'Line deleted.', true);
              }}
              onAddCorner={() => {
                const id = selRoom.id,
                  w = sel.wall;
                commit((j) => splitWall(j, id, w));
                setSel({ kind: 'corner', room: id, idx: w + 1 });
                toast('Corner added in the middle. Drag it to bend the line.');
              }}
            />
          )}
          {sel?.kind === 'corner' &&
            selRoom &&
            selRoom.pts[sel.idx] &&
            (() => {
              const p = selRoom.pts[sel.idx];
              const sx = p.x * view.k + view.x,
                sy = p.y * view.k + view.y;
              const W = 236;
              const left = Math.max(8, Math.min(mainSize.w - W - 8, sx - W / 2));
              const top = sy - 70 < 8 ? sy + 26 : sy - 70;
              const ok = canDeleteCorner(selRoom);
              return (
                <div className="bubble" style={{ left, top, width: W }} role="toolbar" aria-label="Corner">
                  <button
                    className="bub-btn danger"
                    disabled={!ok}
                    title={ok ? 'Delete this corner' : 'A room needs at least three corners'}
                    onClick={() => delCorner(selRoom.id, sel.idx)}
                  >
                    <Trash2 size={17} /> Delete corner
                  </button>
                  <button className="bub-btn" onClick={() => setSel({ kind: 'room', room: selRoom.id })}>
                    <Settings2 size={17} /> Room
                  </button>
                </div>
              );
            })()}
          {sel?.kind === 'room' && selRoom && (
            <RoomSheet
              job={job}
              room={selRoom}
              commit={commit}
              onClose={() => setSel(null)}
              onMeasure={() => {
                let w = 0;
                for (let i = 0; i < wallCount(selRoom); i++)
                  if (!isVerified(selRoom, i)) {
                    w = i;
                    break;
                  }
                setTool('select');
                setSel({ kind: 'wall', room: selRoom.id, wall: w });
              }}
              onDelete={() => delRoom(selRoom.id)}
              onCloseRun={() => {
                const id = selRoom.id;
                commit((j) => closeRun(j, id));
                toast('Closed into a room. The new wall needs a tape length.', true);
              }}
            />
          )}
          {adding && (
            <AddRoomSheet
              defaultName={`Room ${job.rooms.filter((r) => r.closed).length + 1}`}
              onAdd={addRoom}
              onSketch={() => {
                setAdding(false);
                setTool('draw');
              }}
              onClose={() => setAdding(false)}
            />
          )}
          {selOpening && <OpeningSheet job={job} o={selOpening} commit={commit} onClose={() => setSel(null)} onDelete={() => delOpening(selOpening.id)} />}
        </div>
      ) : (
        <div className="main scroll">
          <Materials
            job={job}
            commit={commit}
            toast={toast}
            issues={issues}
            onIssue={goIssue}
            listening={listening}
            onVoice={() => (listening ? stopVoice() : startVoice())}
            onVerify={() => {
              const f = firstUnverified();
              setTab('plan');
              setTool('select');
              if (f) setSel({ kind: 'wall', ...f });
            }}
          />
        </div>
      )}

      {drawer && (
        <Jobs
          jobs={jobs}
          current={curId}
          toast={toast}
          onClose={() => setDrawer(false)}
          onOpen={openJob}
          onNew={() => {
            const j = newJob(`Job ${jobs.length + 1}`);
            setJobs((js) => [...js, j]);
            setCurId(j.id);
            setSel(null);
            setTool('draw');
            setTab('plan');
            setDrawer(false);
          }}
          onSample={() => {
            const j = sampleJob();
            setJobs((js) => [...js, j]);
            setCurId(j.id);
            setSel(null);
            setTool('select');
            setTab('plan');
            setDrawer(false);
          }}
          onDelete={(id) => {
            setJobs((js) => {
              let next = js.filter((j) => j.id !== id);
              if (!next.length) next = [newJob('My first job')];
              if (id === curId) setCurId(next[0].id);
              return next;
            });
          }}
          onRename={(id, name) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, name, updatedAt: Date.now() } : j)))}
          onWipe={() => {
            wipeAll();
            const j = newJob('My first job');
            hist.current = {};
            setJobs([j]);
            setCurId(j.id);
            setSel(null);
            setTool('draw');
            setTab('plan');
            setDrawer(false);
            toast('Everything was erased from this phone');
          }}
          onImport={(list) => {
            setJobs((js) => [...js, ...list]);
            setCurId(list[0].id);
            setDrawer(false);
            setTab('plan');
          }}
        />
      )}

      {welcome && (
        <Welcome
          onStart={() => {
            markWelcome();
            setWelcome(false);
            setTab('plan');
            if (!job.rooms.length) setTool('draw');
          }}
          onSample={() => {
            markWelcome();
            setWelcome(false);
            const j = sampleJob();
            setJobs((js) => [...js, j]);
            setCurId(j.id);
            setSel(null);
            setTool('select');
            setTab('plan');
          }}
        />
      )}

      {toastMsg && (
        <div className="toast" role="status" aria-live="polite" style={{ top: 'auto', bottom: `calc(var(--safe-b) + ${tab === 'plan' ? sheetH + 66 : 98}px)` }}>
          <span>{toastMsg}</span>
          {toastUndo && (
            <button
              className="toast-undo"
              onClick={() => {
                undo();
                setToastMsg(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
