import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { IconPause, IconPlay } from './Icons.tsx';
import { fmtDuration, hashNum } from '../lib/format.ts';

const BARS = 40;
const STOP_OTHERS = 'kani-audio-play';

export function waveform(seed: string | number): number[] {
  const base = hashNum(seed);
  const out: number[] = [];
  for (let i = 0; i < BARS; i++) {
    const h = hashNum(`${base}:${i}`);
    const envelope = 0.45 + 0.55 * Math.abs(Math.sin((i / BARS) * Math.PI * (1.3 + (base % 5) * 0.35) + (base % 7)));
    const v = 0.18 + ((h % 1000) / 1000) * 0.82 * envelope;
    out.push(Math.max(0.14, Math.min(1, v)));
  }
  return out;
}

export function AudioPlayer(props: {
  id: string | number;
  src: string | null;
  durationS?: number;
  side: 'in' | 'out';
  avatar?: ReactNode;
  avatarRight?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [played, setPlayed] = useState(false);
  const bars = useMemo(() => waveform(props.id), [props.id]);
  const duration = props.durationS && props.durationS > 0 ? props.durationS : (mediaDuration ?? 0);
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent).detail !== audioRef.current) audioRef.current?.pause();
    };
    window.addEventListener(STOP_OTHERS, onOther);
    return () => window.removeEventListener(STOP_OTHERS, onOther);
  }, []);

  function toggle() {
    const a = audioRef.current;
    if (!a || !props.src) return;
    if (a.paused) {
      window.dispatchEvent(new CustomEvent(STOP_OTHERS, { detail: a }));
      void a.play().catch(() => setPlaying(false));
    } else {
      a.pause();
    }
  }

  function seek(e: MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
    setCurrent(a.currentTime);
  }

  const avatar = props.avatar ? <span className="ptt-avatar">{props.avatar}</span> : null;

  return (
    <div className={`ptt ptt-${props.side}${played ? ' ptt-played' : ''}`} data-testid="audio-player">
      {!props.avatarRight && avatar}
      <button type="button" className="ptt-play" onClick={toggle} aria-label={playing ? 'Pausar' : 'Reproduzir'} disabled={!props.src}>
        {playing ? <IconPause size={26} /> : <IconPlay size={26} />}
      </button>
      <div className="ptt-body">
        <div className="ptt-wave" onClick={seek} role="slider" aria-label="Progresso" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          {bars.map((h, i) => (
            <span key={i} className={`ptt-bar${i / BARS < progress ? ' on' : ''}`} style={{ height: `${Math.round(h * 22) + 3}px` }} />
          ))}
          <span className="ptt-dot" style={{ left: `calc(${(progress * 100).toFixed(2)}% - 6px)` }} />
        </div>
        <div className="ptt-time">{fmtDuration(playing || current > 0 ? current : duration)}</div>
      </div>
      {props.avatarRight && avatar}
      {props.src ? (
        <audio
          ref={audioRef}
          src={props.src}
          preload="metadata"
          style={{ display: 'none' }}
          onPlay={() => {
            setPlaying(true);
            setPlayed(true);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setCurrent(0);
          }}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            if (a.currentTime > 1e6) return;
            setCurrent(a.currentTime);
          }}
          onLoadedMetadata={(e) => {
            const a = e.currentTarget;
            if (Number.isFinite(a.duration)) {
              setMediaDuration(a.duration);
            } else {
              // MediaRecorder webm files report Infinity until fully scanned.
              const fix = () => {
                a.removeEventListener('durationchange', fix);
                if (Number.isFinite(a.duration)) setMediaDuration(a.duration);
                a.currentTime = 0;
              };
              a.addEventListener('durationchange', fix);
              a.currentTime = 1e7;
            }
          }}
        />
      ) : null}
    </div>
  );
}
