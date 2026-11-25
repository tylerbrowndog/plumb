import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MousePointer2, PenLine, SquarePlus, DoorOpen, AppWindow, Undo2, Redo2, Maximize, Menu, ChevronDown, CircleHelp, Trash2, Settings2 } from 'lucide-react';
import { canDeleteCorner, closeRun, deleteCorner, deleteWall, deleteWallEffect, splitWall } from './edit';

/** a short tick under the thumb, where the phone allows it */
const buzz = (ms = 10) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not on this phone */
  }
};
import type { Job, Selection, Tool } from './types';
import PlanCanvas, { type View } from './PlanCanvas';
import { AddRoomSheet, OpeningSheet, RoomSheet, WallSheet } from './Sheets';
import Materials from './Materials';
import Jobs from './Jobs';
import { loadCurrent, loadJobs, markWelcome, newJob, newRoom, sampleJob, saveCurrent, saveJobs, seenWelcome, wipeAll } from './store';
import Welcome from './Welcome';
import { bounds, isVerified, wallCount, wallEnds, lerp, roomBySize } from './geometry';
import { fmtFtIn } from './units';
import { estimate } from './estimate';

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

  const toast = useCallback((s: string, undoable = false) => {
    setToastMsg(s);
    setToastUndo(undoable);
    if (undoable) buzz(14);
    window.clearTimeout((toast as unknown as { t?: number }).t);
    (toast as unknown as { t?: number }).t = window.setTimeout(() => setToastMsg(null), undoable ? 4500 : 1800);
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
    RIGHT = 64;
  const sheetH = sel ? (sel.kind === 'wall' ? 236 : sel.kind === 'room' ? 270 : sel.kind === 'opening' ? 300 : 70) : adding ? 236 : 70;
  const fit = useCallback(
    (j: Job = jobRef.current) => {
      const b = bounds(j);
      const availW = mainSize.w - RAIL - RIGHT - 16;
      const availH = mainSize.h - 40 - 92;
      if (!b) {
        const k = (mainSize.w * 0.55) / 144;
        setView({ k, x: mainSize.w / 2 - 72 * k, y: mainSize.h * 0.4 - 60 * k });
        return;
      }
      const bw = Math.max(24, b.maxX - b.minX),
        bh = Math.max(24, b.maxY - b.minY);
      const k = Math.min(availW / bw, availH / bh, 8);
      setView({ k, x: RAIL + 8 + (availW - bw * k) / 2 - b.minX * k, y: 40 + (availH - bh * k) / 2 - b.minY * k });
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
      const top = 24,
        bottom = mainSize.h - sheetH - 30;
      if (sy > top && sy < bottom && sx > RAIL + 10 && sx < mainSize.w - RIGHT - 10) return v;
      const tx = RAIL + (mainSize.w - RAIL - RIGHT) / 2,
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
  // the moment the last wall gets its tape length, say so once
  const prevUnverified = useRef<{ id: string; n: number }>({ id: curId, n: unverified });
  useEffect(() => {
    const p = prevUnverified.current;
    if (p.id === curId && p.n > 0 && unverified === 0 && est.totalWalls > 0) toast('Every wall is measured. Your list is exact.');
    prevUnverified.current = { id: curId, n: unverified };
  }, [curId, unverified, est.totalWalls, toast]);

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

  const selRoom = sel && sel.kind !== 'opening' ? job.rooms.find((r) => r.id === sel.room) : null;
  const selOpening = sel?.kind === 'opening' ? job.openings.find((o) => o.id === sel.id) : null;

  return (
    <div className="app">
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
        <button className="icon-btn help" onClick={() => setWelcome(true)} aria-label="How Plumb works">
          <CircleHelp size={20} />
        </button>
      </header>

      {tab === 'plan' ? (
        <div className="main" ref={mainRef}>
          <PlanCanvas job={job} sel={sel} setSel={setSel} tool={tool} setTool={setTool} commit={commit} view={view} setView={setView} allow45={allow45} />

          <div className="view-ctl">
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
              ) : (
                <>
                  <div className="strip-main">
                    <span className="strip-line">
                      {unverified > 0 ? (
                        <>
                          <b>{est.verifiedWalls}</b> of {est.totalWalls} walls measured
                        </>
                      ) : (
                        <>All {est.totalWalls} walls measured</>
                      )}
                    </span>
                    <span className="tape-progress" role="img" aria-label={`${est.verifiedWalls} of ${est.totalWalls} walls measured`}>
                      <span style={{ width: `${est.totalWalls ? (est.verifiedWalls / est.totalWalls) * 100 : 0}%` }} />
                    </span>
                  </div>
                  {(tool === 'draw' || tool === 'rect') && (
                    <button className={`mini ${allow45 ? 'on' : ''}`} onClick={() => setAllow45(!allow45)} aria-pressed={allow45} aria-label="Allow 45 degree walls">
                      45°
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
                  } else {
                    setAdding(false);
                    setSel(null);
                    setTool(t);
                  }
                }}
                aria-label={t === 'add' ? 'Add a room by its size' : label}
                aria-pressed={t === 'add' ? adding : tool === t && !adding}
              >
                <Icon size={22} strokeWidth={2.1} />
                <span>{label}</span>
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
