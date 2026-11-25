import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MousePointer2, PenLine, Square, DoorOpen, AppWindow, Undo2, Redo2, Maximize, Menu, ChevronDown, CircleHelp } from 'lucide-react';
import type { Job, Selection, Tool } from './types';
import PlanCanvas, { type View } from './PlanCanvas';
import { OpeningSheet, RoomSheet, WallSheet } from './Sheets';
import Materials from './Materials';
import Jobs from './Jobs';
import { loadCurrent, loadJobs, markWelcome, newJob, sampleJob, saveCurrent, saveJobs, seenWelcome, wipeAll } from './store';
import Welcome from './Welcome';
import { bounds, isVerified, wallCount, wallEnds, lerp } from './geometry';
import { estimate } from './estimate';

const TOOLS: { t: Tool; icon: typeof PenLine; label: string }[] = [
  { t: 'select', icon: MousePointer2, label: 'Select' },
  { t: 'draw', icon: PenLine, label: 'Draw' },
  { t: 'rect', icon: Square, label: 'Box' },
  { t: 'door', icon: DoorOpen, label: 'Door' },
  { t: 'window', icon: AppWindow, label: 'Window' },
];

const HINTS: Record<Tool, string> = {
  select: 'Tap a wall to measure it. Drag corners to adjust.',
  draw: 'Draw a room with one finger. It snaps straight and square.',
  rect: 'Drag to draw a box room. Start on a corner to attach rooms.',
  door: 'Tap a wall to drop a door.',
  window: 'Tap a wall to drop a window.',
};

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

  const [tool, setTool] = useState<Tool>(job.rooms.length ? 'select' : 'draw');
  const [sel, setSel] = useState<Selection>(null);
  const [tab, setTab] = useState<'plan' | 'list'>('plan');
  const [drawer, setDrawer] = useState(false);
  const [allow45, setAllow45] = useState(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(() => !seenWelcome() && !init.jobs.some((j) => j.rooms.length));
  const hist = useRef<Record<string, { past: Job[]; future: Job[] }>>({});
  const [, bump] = useState(0);
  const mainRef = useRef<HTMLDivElement>(null);
  const [mainSize, setMainSize] = useState({ w: 390, h: 700 });
  const [view, setView] = useState<View>({ x: 60, y: 120, k: 2 });

  const toast = useCallback((s: string) => {
    setToastMsg(s);
    window.clearTimeout((toast as unknown as { t?: number }).t);
    (toast as unknown as { t?: number }).t = window.setTimeout(() => setToastMsg(null), 1800);
  }, []);

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
    if (!p) return;
    h.future.push(job);
    setJob(p);
    setSel(null);
    bump((n) => n + 1);
  };
  const redo = () => {
    const h = H();
    const f = h.future.pop();
    if (!f) return;
    h.past.push(job);
    setJob(f);
    setSel(null);
    bump((n) => n + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  const sheetH = sel ? (sel.kind === 'wall' ? mainSize.h * 0.58 : sel.kind === 'room' ? Math.min(mainSize.h * 0.8, 440) : 340) : 70;
  const fit = useCallback(
    (j: Job = jobRef.current) => {
      const b = bounds(j);
      const availW = mainSize.w - 80;
      const availH = mainSize.h - 150;
      if (!b) {
        const k = (mainSize.w * 0.55) / 144;
        setView({ k, x: mainSize.w / 2 - 72 * k + 20, y: mainSize.h * 0.42 - 60 * k });
        return;
      }
      const bw = Math.max(24, b.maxX - b.minX),
        bh = Math.max(24, b.maxY - b.minY);
      const k = Math.min(availW / bw, availH / bh, 8);
      setView({ k, x: 64 + (availW - bw * k) / 2 - b.minX * k + 8, y: 60 + (availH - bh * k) / 2 - b.minY * k });
    },
    [mainSize],
  );

  const fitted = useRef<string>('');
  useEffect(() => {
    if (tab !== 'plan') return;
    const key = curId + ':' + mainSize.w + 'x' + mainSize.h;
    if (fitted.current === key) return;
    fitted.current = key;
    fit();
  }, [curId, mainSize, fit, tab]);

  // keep the selected wall visible above the keypad
  useEffect(() => {
    if (sel?.kind !== 'wall') return;
    const r = job.rooms.find((x) => x.id === sel.room);
    if (!r) return;
    const [a, b] = wallEnds(r, sel.wall);
    const m = lerp(a, b, 0.5);
    setView((v) => {
      const sx = m.x * v.k + v.x,
        sy = m.y * v.k + v.y;
      const top = 70,
        bottom = mainSize.h - sheetH - 30;
      if (sy > top && sy < bottom && sx > 70 && sx < mainSize.w - 20) return v;
      const tx = (mainSize.w + 56) / 2,
        ty = top + (bottom - top) / 2;
      return { ...v, x: v.x + (tx - sx), y: v.y + (ty - sy) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel && sel.kind === 'wall' ? sel.room + sel.wall : null]);

  const firstUnverified = () => {
    for (const r of job.rooms) for (let i = 0; i < wallCount(r); i++) if (!isVerified(r, i)) return { room: r.id, wall: i };
    return null;
  };

  const est = useMemo(() => estimate(job), [job]);
  const unverified = est.totalWalls - est.verifiedWalls;

  const openJob = (id: string) => {
    setCurId(id);
    setSel(null);
    setDrawer(false);
    setTab('plan');
    const j = jobs.find((x) => x.id === id);
    setTool(j && j.rooms.length ? 'select' : 'draw');
  };

  const selRoom = sel && sel.kind !== 'opening' ? job.rooms.find((r) => r.id === sel.room) : null;
  const selOpening = sel?.kind === 'opening' ? job.openings.find((o) => o.id === sel.id) : null;

  return (
    <div className="app">
      <header className="top">
        <button className="job-btn" onClick={() => setDrawer(true)}>
          <Menu size={20} />
          <span className="job-title">{job.name}</span>
          <ChevronDown size={16} className="muted" />
        </button>
        <div className="tabs">
          <button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>
            Plan
          </button>
          <button className={tab === 'list' ? 'on' : ''} onClick={() => { setTab('list'); setSel(null); }}>
            List
            {unverified > 0 && job.rooms.length > 0 && <span className="badge">{unverified}</span>}
          </button>
        </div>
        <button className="icon-btn help" onClick={() => setWelcome(true)} aria-label="How Plumb works">
          <CircleHelp size={20} />
        </button>
      </header>

      {tab === 'plan' ? (
        <div className="main" ref={mainRef}>
          <PlanCanvas job={job} sel={sel} setSel={setSel} tool={tool} setTool={setTool} commit={commit} view={view} setView={setView} allow45={allow45} />

          <nav className="toolbar">
            {TOOLS.map(({ t, icon: Icon, label }) => (
              <button key={t} className={`tool ${tool === t ? 'on' : ''}`} onClick={() => setTool(t)} aria-label={label} title={label}>
                <Icon size={21} />
                <span>{label}</span>
              </button>
            ))}
            <div className="tsep" />
            <button className="tool" onClick={undo} disabled={!H().past.length} aria-label="Undo">
              <Undo2 size={20} />
            </button>
            <button className="tool" onClick={redo} disabled={!H().future.length} aria-label="Redo">
              <Redo2 size={20} />
            </button>
            <button className="tool" onClick={() => fit()} aria-label="Fit to screen">
              <Maximize size={19} />
            </button>
          </nav>

          {!sel && (
            <div className="hintbar">
              <span>{job.rooms.length === 0 && tool === 'draw' ? 'Draw your first room with one finger. Two fingers pan and zoom.' : HINTS[tool]}</span>
              {(tool === 'draw') && (
                <button className={`mini ${allow45 ? 'on' : ''}`} onClick={() => setAllow45(!allow45)}>
                  45°
                </button>
              )}
              {job.rooms.length > 0 && unverified > 0 && tool === 'select' && (
                <button
                  className="mini on"
                  onClick={() => {
                    const f = firstUnverified();
                    if (f) setSel({ kind: 'wall', ...f });
                  }}
                >
                  Measure
                </button>
              )}
            </div>
          )}

          {sel?.kind === 'wall' && selRoom && sel.wall < wallCount(selRoom) && (
            <WallSheet job={job} room={selRoom} wall={sel.wall} commit={commit} onSelectWall={(room, wall) => setSel({ kind: 'wall', room, wall })} onClose={() => setSel(null)} />
          )}
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
              onDelete={() => {
                const id = selRoom.id;
                commit((j) => ({ ...j, rooms: j.rooms.filter((r) => r.id !== id), openings: j.openings.filter((o) => o.room !== id) }));
                setSel(null);
              }}
            />
          )}
          {selOpening && <OpeningSheet job={job} o={selOpening} commit={commit} onClose={() => setSel(null)} />}
        </div>
      ) : (
        <div className="main scroll">
          <Materials
            job={job}
            commit={commit}
            toast={toast}
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
        <div className="toast" role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
