import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconClose, IconHeadphones, IconMic, IconPhoto, IconPlus, IconSend, IconSmile, IconTrash } from '../components/Icons.tsx';
import { fmtDuration } from '../lib/format.ts';
import type { OutgoingPayload } from './types.ts';

const EMOJIS = [
  '😀', '😂', '😊', '😍', '🥰', '😘', '😉', '😎',
  '🤩', '🤔', '😅', '😭', '😢', '😡', '😴', '🙄',
  '👍', '👎', '👏', '🙏', '🙌', '💪', '👌', '✌️',
  '🤝', '👋', '❤️', '💖', '🔥', '✨', '⭐', '🎉',
  '✅', '❌', '📅', '⏰', '📍', '📞', '💬', '🚗',
  '🔧', '💇', '🦷', '🐶', '🐱', '💅', '🌿', '☕',
];

const MAX_LINES = 5;
const LINE_H = 20;

function audioDuration(file: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    let done = false;
    const finish = (v: number | undefined) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(v);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => finish(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : undefined);
    a.onerror = () => finish(undefined);
    window.setTimeout(() => finish(undefined), 3000);
    a.src = url;
  });
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export function Composer({ onSend, onPickImage }: { onSend: (p: OutgoingPayload) => void; onPickImage: (f: File) => void }) {
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const imgInput = useRef<HTMLInputElement | null>(null);
  const audInput = useRef<HTMLInputElement | null>(null);
  const recRef = useRef<{ rec: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number; timer: number } | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_LINES * LINE_H + 18)}px`;
  }, [text, recording]);

  useEffect(() => {
    if (!emojiOpen && !attachOpen) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setEmojiOpen(false);
        setAttachOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [emojiOpen, attachOpen]);

  useEffect(
    () => () => {
      const r = recRef.current;
      if (r) {
        window.clearInterval(r.timer);
        r.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );

  function sendText() {
    const v = text.trim();
    if (!v) return;
    onSend({ type: 'text', text: v });
    setText('');
    setEmojiOpen(false);
    taRef.current?.focus();
  }

  function insertEmoji(e: string) {
    const ta = taRef.current;
    const start = ta?.selectionStart ?? text.length;
    const end = ta?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + e + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const pos = start + e.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  async function startRecording() {
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia || typeof MediaRecorder === 'undefined') {
      audInput.current?.click();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await md.getUserMedia({ audio: true });
    } catch {
      audInput.current?.click();
      return;
    }
    const mime = pickMime();
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const started = performance.now();
    const timer = window.setInterval(() => setElapsed((performance.now() - started) / 1000), 200);
    recRef.current = { rec, stream, chunks, started, timer };
    rec.start(250);
    setElapsed(0);
    setRecording(true);
  }

  function stopRecording(send: boolean) {
    const r = recRef.current;
    if (!r) return;
    recRef.current = null;
    window.clearInterval(r.timer);
    const durationS = (performance.now() - r.started) / 1000;
    r.rec.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      if (!send || r.chunks.length === 0) return;
      const type = r.rec.mimeType || 'audio/webm';
      const blob = new Blob(r.chunks, { type });
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      onSend({ type: 'audio', file: blob, fileName: `gravacao.${ext}`, durationS: Math.max(1, Math.round(durationS * 10) / 10) });
    };
    if (r.rec.state !== 'inactive') r.rec.stop();
    setRecording(false);
  }

  async function onAudioFile(f: File) {
    const d = await audioDuration(f);
    onSend({ type: 'audio', file: f, fileName: f.name, durationS: d ? Math.round(d * 10) / 10 : undefined });
  }

  const hasText = text.trim().length > 0;

  return (
    <footer className="composer" ref={popRef}>
      <input
        ref={imgInput}
        type="file"
        accept="image/*"
        hidden
        data-testid="file-input-image"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onPickImage(f);
        }}
      />
      <input
        ref={audInput}
        type="file"
        accept="audio/*,.m4a,.webm,.ogg,.mp3,.wav"
        hidden
        data-testid="file-input-audio"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void onAudioFile(f);
        }}
      />

      {recording ? (
        <div className="recorder" data-testid="recorder">
          <button type="button" className="icon-btn" aria-label="Descartar gravação" onClick={() => stopRecording(false)} data-testid="record-cancel">
            <IconTrash />
          </button>
          <span className="rec-dot" />
          <span className="rec-time">{fmtDuration(elapsed)}</span>
          <span className="rec-live" aria-hidden="true">
            {Array.from({ length: 28 }, (_, i) => (
              <span key={i} style={{ animationDelay: `${(i % 7) * 0.11}s` }} />
            ))}
          </span>
          <button type="button" className="send-circle" aria-label="Enviar áudio" data-testid="send-button" onClick={() => stopRecording(true)}>
            <IconSend size={22} />
          </button>
        </div>
      ) : (
        <>
          <div className="composer-tools">
            <button
              type="button"
              className={`icon-btn${emojiOpen ? ' pressed' : ''}`}
              aria-label="Emojis"
              title="Emojis"
              data-testid="emoji-button"
              onClick={() => {
                setEmojiOpen((v) => !v);
                setAttachOpen(false);
              }}
            >
              <IconSmile />
            </button>
            <button
              type="button"
              className={`icon-btn${attachOpen ? ' pressed rotated' : ''}`}
              aria-label="Anexar"
              title="Anexar"
              data-testid="attach-button"
              onClick={() => {
                setAttachOpen((v) => !v);
                setEmojiOpen(false);
              }}
            >
              {attachOpen ? <IconClose /> : <IconPlus />}
            </button>
          </div>
          <div className="composer-input">
            <textarea
              ref={taRef}
              rows={1}
              placeholder="Digite uma mensagem"
              value={text}
              data-testid="composer-input"
              aria-label="Digite uma mensagem"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendText();
                }
              }}
            />
          </div>
          {hasText ? (
            <button type="button" className="send-circle" aria-label="Enviar" data-testid="send-button" onClick={sendText}>
              <IconSend size={22} />
            </button>
          ) : (
            <button type="button" className="icon-btn mic-btn" aria-label="Gravar áudio" title="Gravar áudio" data-testid="mic-button" onClick={() => void startRecording()}>
              <IconMic />
            </button>
          )}
        </>
      )}

      {emojiOpen && !recording ? (
        <div className="emoji-pop" role="dialog" aria-label="Emojis" data-testid="emoji-picker">
          <div className="emoji-pop-title">Emojis frequentes</div>
          <div className="emoji-grid">
            {EMOJIS.map((e) => (
              <button type="button" key={e} className="emoji-cell" onClick={() => insertEmoji(e)}>
                {e}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {attachOpen && !recording ? (
        <div className="attach-pop" role="menu">
          <button
            type="button"
            role="menuitem"
            className="attach-item"
            data-testid="attach-image"
            onClick={() => {
              setAttachOpen(false);
              imgInput.current?.click();
            }}
          >
            <span className="attach-ic photos">
              <IconPhoto size={20} />
            </span>
            Fotos
          </button>
          <button
            type="button"
            role="menuitem"
            className="attach-item"
            data-testid="attach-audio"
            onClick={() => {
              setAttachOpen(false);
              audInput.current?.click();
            }}
          >
            <span className="attach-ic audio">
              <IconHeadphones size={20} />
            </span>
            Áudio
          </button>
        </div>
      ) : null}
    </footer>
  );
}
