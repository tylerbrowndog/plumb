import { forwardRef, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX, X, Keyboard, CornerDownLeft } from 'lucide-react';
import type { EarKind } from './speech';

export interface VLine {
  id: number;
  text: string;
  tone: 'ok' | 'warn' | 'info' | 'bad';
}

const EXAMPLES: { say: string; does: string }[] = [
  { say: '12 foot 6, next', does: 'tapes the wall you are on and moves on' },
  { say: 'kitchen north wall 14 2', does: 'a wall by room and side' },
  { say: 'no, 12 foot', does: 'fixes the last one' },
  { say: '32 door / window 36 by 48', does: 'on the wall you are on' },
  { say: 'cabinets here', does: 'no baseboard on this wall' },
  { say: 'LVP / shoe / crown / paint the walls', does: 'for the room you are in' },
  { say: 'new room laundry 8 by 6', does: 'adds a room' },
  { say: 'add 2 tubes of caulk and shims', does: 'goes on the list' },
  { say: 'got the caulk', does: 'checks it off' },
  { say: 'read it back', does: 'what is left and what looks wrong' },
  { say: 'undo / stop', does: '' },
];

interface Props {
  open: boolean;
  listening: boolean;
  kind: EarKind;
  partial: string;
  lines: VLine[];
  warn: boolean;
  talk: boolean;
  onMic: () => void;
  onClose: () => void;
  onTalk: () => void;
  onRun: (t: string) => void;
  onKeep: () => void;
  onUndo: () => void;
  placeholder: string;
}

/** the strip under the header while you talk to Plumb: what it heard, what it did, and a way to fix it */
const VoicePanel = forwardRef<HTMLInputElement, Props>(function VoicePanel(p, inputRef) {
  const [txt, setTxt] = useState('');
  const [help, setHelp] = useState(false);
  const [typing, setTyping] = useState(false);
  const last = p.lines[p.lines.length - 1];
  const showInput = typing || p.kind === 'keyboard' || !p.listening;
  return (
    <div className={`voice ${p.open ? 'open' : ''}`} role="region" aria-label="Voice" aria-hidden={!p.open}>
      <div className="v-row">
        <button className={`v-mic ${p.listening ? 'on' : ''}`} onClick={p.onMic} aria-label={p.listening ? 'Stop listening' : 'Start listening'} aria-pressed={p.listening} tabIndex={p.open ? 0 : -1}>
          {p.listening ? <Mic size={22} /> : <MicOff size={21} />}
          {p.listening && <i className="v-pulse" aria-hidden />}
        </button>
        <div className="v-said" aria-live="polite">
          {p.partial ? (
            <span className="v-partial">{p.partial}</span>
          ) : last ? (
            <span className={`v-line ${last.tone}`}>{last.text}</span>
          ) : p.listening ? (
            <span className="v-hint">Listening. Say a length, like 12 foot 6</span>
          ) : p.kind === 'keyboard' ? (
            <span className="v-hint">Tap the keyboard's mic and talk, then Go</span>
          ) : (
            <span className="v-hint">Tap the mic and call it out</span>
          )}
        </div>
        <button className="v-ic" onClick={p.onTalk} aria-label={p.talk ? 'Stop reading back out loud' : 'Read back out loud'} aria-pressed={p.talk} tabIndex={p.open ? 0 : -1}>
          {p.talk ? <Volume2 size={19} /> : <VolumeX size={19} />}
        </button>
        <button className="v-ic" onClick={p.onClose} aria-label="Close voice" tabIndex={p.open ? 0 : -1}>
          <X size={20} />
        </button>
      </div>
      {p.warn && (
        <div className="v-fix">
          <span>Say "no" and the right number, or</span>
          <button className="mini" onClick={p.onKeep} tabIndex={p.open ? 0 : -1}>
            Keep it
          </button>
          <button className="mini on" onClick={p.onUndo} tabIndex={p.open ? 0 : -1}>
            Undo
          </button>
        </div>
      )}
      <form
        className={`v-type ${showInput ? '' : 'min'}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (txt.trim()) p.onRun(txt);
          setTxt('');
        }}
      >
        {showInput ? (
          <>
            <input
              ref={inputRef}
              value={txt}
              onChange={(e) => setTxt(e.target.value)}
              placeholder={p.placeholder}
              aria-label="Say or type what to do"
              enterKeyHint="go"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              tabIndex={p.open ? 0 : -1}
            />
            <button className="v-go" type="submit" aria-label="Do it" disabled={!txt.trim()} tabIndex={p.open ? 0 : -1}>
              <CornerDownLeft size={18} />
            </button>
          </>
        ) : (
          <button type="button" className="v-link" onClick={() => setTyping(true)} tabIndex={p.open ? 0 : -1}>
            <Keyboard size={15} /> Type instead
          </button>
        )}
        <button type="button" className="v-link" onClick={() => setHelp(!help)} aria-expanded={help} tabIndex={p.open ? 0 : -1}>
          What can I say?
        </button>
      </form>
      {help && (
        <ul className="v-help">
          {EXAMPLES.map((e) => (
            <li key={e.say}>
              <button
                className="v-eg"
                onClick={() => {
                  setTxt(e.say.split(' / ')[0]);
                  setTyping(true);
                  setHelp(false);
                }}
                tabIndex={p.open ? 0 : -1}
              >
                “{e.say}”
              </button>
              {e.does && <span> {e.does}</span>}
            </li>
          ))}
        </ul>
      )}
      {p.lines.length > 1 && !help && (
        <ol className="v-log" aria-label="What Plumb did">
          {p.lines.slice(-4, -1).reverse().map((l) => (
            <li key={l.id} className={l.tone}>
              {l.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});

export default VoicePanel;
