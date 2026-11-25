import { useRef, useState } from 'react';
import { Plus, Download, Upload, Trash2, X, ShieldCheck, Copy, MoreHorizontal, Pencil } from 'lucide-react';
import type { Job } from './types';
import { downloadJSON, parseImport } from './store';
import { uid } from './geometry';

export default function Jobs({
  jobs,
  current,
  onOpen,
  onNew,
  onSample,
  onDelete,
  onRename,
  onImport,
  onWipe,
  onClose,
  toast,
}: {
  jobs: Job[];
  current: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onSample: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onImport: (jobs: Job[]) => void;
  onWipe: () => void;
  onClose: () => void;
  toast: (s: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const framed = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  const backup = async (list: Job[] = jobs) => {
    const data = { app: 'plumb', version: 2, jobs: list };
    if (!framed) {
      const name = list.length === 1 ? list[0].name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'job' : 'jobs';
      downloadJSON(`plumb-${name}-${new Date().toISOString().slice(0, 10)}.json`, data);
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(data));
      toast(list.length === 1 ? 'Job copied. Paste it into Notes or a text.' : 'Backup copied. Paste it into Notes.');
    } catch {
      toast('Copy was blocked on this phone');
    }
  };
  const sorted = [...jobs].sort((a, b) => b.updatedAt - a.updatedAt);
  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Jobs" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="brand">
              <span className="logo" /> Plumb
            </div>
            <div className="muted small">Your jobs, saved on this phone</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" autoFocus>
            <X size={20} />
          </button>
        </div>
        <div className="row gap">
          <button className="btn primary grow" onClick={onNew}>
            <Plus size={18} /> New job
          </button>
          <button className="btn" onClick={onSample}>
            Sample
          </button>
        </div>
        <div className="job-list">
          {sorted.map((j) => (
            <div key={j.id} className={`job ${j.id === current ? 'cur' : ''} ${open === j.id ? 'open' : ''}`}>
              <div className="job-row">
                {editing === j.id ? (
                  <input
                    className="name-input job-edit"
                    autoFocus
                    defaultValue={j.name}
                    maxLength={80}
                    aria-label="Job name"
                    onBlur={(e) => {
                      if (e.target.value.trim()) onRename(j.id, e.target.value.trim());
                      setEditing(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <button className="job-main" onClick={() => onOpen(j.id)} aria-current={j.id === current ? 'true' : undefined}>
                    <span className="job-name">{j.name}</span>
                    <span className="muted small">
                      {j.rooms.length} {j.rooms.length === 1 ? 'room' : 'rooms'}, edited {date(j.updatedAt)}
                    </span>
                  </button>
                )}
                <button
                  className="icon-btn more"
                  aria-label={`More for ${j.name}`}
                  aria-expanded={open === j.id}
                  onClick={() => {
                    setOpen(open === j.id ? null : j.id);
                    setConfirmDel(null);
                  }}
                >
                  <MoreHorizontal size={20} />
                </button>
              </div>
              {open === j.id && (
                <div className="job-actions">
                  <button className="act" onClick={() => setEditing(j.id)}>
                    <Pencil size={17} /> Rename
                  </button>
                  <button className="act" onClick={() => backup([j])}>
                    <Download size={17} /> Export
                  </button>
                  <button className="act" onClick={() => onImport([{ ...structuredClone(j), id: uid(), name: j.name + ' copy', updatedAt: Date.now() }])}>
                    <Copy size={17} /> Duplicate
                  </button>
                  {confirmDel === j.id ? (
                    <button className="act danger" onClick={() => { onDelete(j.id); setConfirmDel(null); setOpen(null); }}>
                      <Trash2 size={17} /> Tap again to delete
                    </button>
                  ) : (
                    <button className="act" onClick={() => setConfirmDel(j.id)}>
                      <Trash2 size={17} /> Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="row gap">
          <button className="btn grow" onClick={() => backup()}>
            <Download size={17} /> Back up
          </button>
          <button className="btn grow" onClick={() => fileRef.current?.click()}>
            <Upload size={17} /> Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const list = parseImport(await f.text());
                if (!list.length) throw new Error('none');
                onImport(list);
                toast(`Imported ${list.length} job${list.length > 1 ? 's' : ''}`);
              } catch {
                toast("That file isn't a Plumb backup");
              }
              e.target.value = '';
            }}
          />
        </div>
        {confirmWipe ? (
          <div className="wipe">
            <span>This erases every job on this phone and can't be undone. Back up first if you want to keep them.</span>
            <div className="row gap">
              <button className="btn grow" onClick={() => setConfirmWipe(false)}>
                Keep
              </button>
              <button className="btn grow danger-fill" onClick={onWipe}>
                Erase all
              </button>
            </div>
          </div>
        ) : (
          <button className="link-btn" onClick={() => setConfirmWipe(true)}>
            Erase all Plumb data on this phone
          </button>
        )}
        <div className="privacy">
          <ShieldCheck size={20} />
          <div>Jobs live only on this phone. No account, no cloud, no AI, no tracking. Back up to a file whenever you want.</div>
        </div>
      </div>
    </div>
  );
}
