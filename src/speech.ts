// Hearing and talking back. Uses whatever the phone or browser offers:
// Claude's dictation inside the Claude app on a computer, the browser's own speech service (Chrome, Safari),
// or, where neither works, the keyboard's own mic button. Plumb sends no audio and no job anywhere itself.

type DictState = { state: string; reason?: string };
interface Dictation {
  start(): Promise<void>;
  stop(): Promise<void>;
  onPartial(fn: (e: { text: string }) => void): void;
  onFinal(fn: (e: { text: string }) => void): void;
  onState(fn: (e: DictState) => void): void;
}
interface WebRec {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

export type EarKind = 'claude' | 'web' | 'keyboard';
export interface EarEvents {
  partial: (t: string) => void;
  final: (t: string) => void;
  state: (listening: boolean, why?: string) => void;
}

let dict: Dictation | null = null;
let dictTried = false;
let dictDenied = false;
let webDenied = false;

/** ask the Claude app once, early, so a tap can start it straight away */
export function prepareEars() {
  if (dictTried) return;
  dictTried = true;
  try {
    const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    c?.use?.('dictation')
      .then((d) => {
        dict = (d as Dictation) || null;
      })
      .catch(() => {
        dict = null;
      });
  } catch {
    dict = null;
  }
}

const WebCtor = () => {
  const w = window as unknown as { SpeechRecognition?: new () => WebRec; webkitSpeechRecognition?: new () => WebRec };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

export function earKind(): EarKind {
  if (dict && !dictDenied) return 'claude';
  if (WebCtor() && !webDenied) return 'web';
  return 'keyboard';
}

/** a listener that keeps going until stop(), restarting when the phone pauses it after a silence */
export function makeEar(ev: EarEvents) {
  let want = false;
  let rec: WebRec | null = null;
  let kind: EarKind = 'keyboard';
  let wired = false;

  const startWeb = () => {
    const C = WebCtor();
    if (!C) return false;
    rec = new C();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e) => {
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) ev.final(r[0].transcript);
        else partial += r[0].transcript;
      }
      ev.partial(partial);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        webDenied = true;
        want = false;
        ev.state(false, 'denied');
      }
    };
    rec.onend = () => {
      if (want) {
        try {
          rec?.start();
          return;
        } catch {
          /* fell through */
        }
      }
      ev.state(false);
    };
    try {
      rec.start();
      ev.state(true);
      return true;
    } catch {
      return false;
    }
  };

  return {
    /** call straight from the tap: the Claude app and browsers only start a mic from a tap */
    start(): EarKind {
      want = true;
      kind = earKind();
      if (kind === 'claude' && dict) {
        const d = dict;
        if (!wired) {
          wired = true;
          d.onPartial(({ text }) => want && ev.partial(text));
          d.onFinal(({ text }) => want && ev.final(text));
          d.onState(({ state, reason }) => {
            if (state === 'listening') ev.state(true);
            else if (state === 'idle') {
              want = false;
              ev.state(false, reason);
            }
          });
        }
        d.start().catch((err: { code?: string }) => {
          if (err?.code === 'not_granted') dictDenied = true;
          want = false;
          ev.state(false, err?.code === 'not_granted' ? 'denied' : 'failed');
        });
        ev.state(true);
        return kind;
      }
      if (kind === 'web' && startWeb()) return kind;
      want = false;
      return 'keyboard';
    },
    stop() {
      want = false;
      if (kind === 'claude' && dict) dict.stop().catch(() => undefined);
      try {
        rec?.stop();
      } catch {
        /* already stopped */
      }
      ev.state(false);
    },
  };
}

// ---- talking back, with the phone's own voice ----
let speakingUntil = 0;
let lastSaid = '';
export function speak(text: string) {
  try {
    const s = window.speechSynthesis;
    if (!s || !text) return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.08;
    u.pitch = 1;
    lastSaid = text.toLowerCase();
    // roughly how long it talks, so we don't hear ourselves and write it down
    speakingUntil = Date.now() + 900 + text.length * 70;
    u.onend = () => {
      speakingUntil = Date.now() + 500;
    };
    s.speak(u);
  } catch {
    /* no voice on this phone */
  }
}
export function stopSpeaking() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* none */
  }
  speakingUntil = 0;
}
/** true when what we just heard is our own voice coming back through the mic */
export function isEcho(heard: string) {
  if (Date.now() > speakingUntil) return false;
  const h = heard.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const l = lastSaid.replace(/[^a-z0-9 ]/g, '');
  return !h || l.includes(h) || h.split(' ').filter((w) => l.includes(w)).length >= Math.max(1, h.split(' ').length * 0.6);
}

const TALK = 'plumb.voice.talk';
export function talkBackOn() {
  try {
    return localStorage.getItem(TALK) !== '0';
  } catch {
    return true;
  }
}
export function setTalkBack(on: boolean) {
  try {
    localStorage.setItem(TALK, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}
