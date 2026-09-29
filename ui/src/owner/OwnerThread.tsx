import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { ConversationDetailDTO, MessageDTO, TenantDTO } from '../api/types.ts';
import { PersonAvatar } from '../components/Avatar.tsx';
import { AudioPlayer } from '../components/AudioPlayer.tsx';
import { IconAlert, IconBot, IconSend, IconShield, IconSidebar, IconUser, IconBack } from '../components/Icons.tsx';
import { Lightbox } from '../components/Lightbox.tsx';
import { dayKey, fmtDayChipEn, fmtRelative, fmtTime } from '../lib/format.ts';
import { RichText } from '../lib/richtext.tsx';
import { Tail } from '../customer/Bubble.tsx';
import { upsertMessage } from '../customer/types.ts';
import { StatusPill } from './OwnerView.tsx';
import { InfoPanel } from './InfoPanel.tsx';

function OwnerBubble({ m, tail, label, onImage }: { m: MessageDTO; tail: boolean; label: string | null; onImage: (src: string, cap: string | null) => void }) {
  const right = m.role !== 'customer';
  const side = right ? 'out' : 'in';
  const meta = (
    <span className="meta">
      <span className="meta-time">{fmtTime(m.createdAt)}</span>
    </span>
  );
  let body;
  if (m.type === 'audio') {
    body = (
      <>
        <AudioPlayer id={m.id} src={m.mediaUrl} durationS={m.meta.durationS} side={side} />
        <div className="transcript-box">
          {m.transcript ? (
            <span data-testid="transcript">
              <b>Transcript:</b> {m.transcript}
            </span>
          ) : (
            <span data-testid="transcript" className="pending-line">
              <span className="spinner" /> Transcribing...
            </span>
          )}
          {m.meta.simulatedAudio ? <span className="sim-tag">(simulated audio)</span> : null}
        </div>
        {meta}
      </>
    );
  } else if (m.type === 'image') {
    const caption = m.text?.trim() ? m.text : null;
    body = (
      <>
        <div className="img-wrap">
          {m.mediaUrl ? <img src={m.mediaUrl} alt={caption ?? 'Photo'} className="bubble-img" onClick={() => m.mediaUrl && onImage(m.mediaUrl, caption)} /> : null}
        </div>
        {caption ? (
          <div className="bubble-text caption">
            <RichText text={caption} />
          </div>
        ) : null}
        <div className="vision-box">
          {m.meta.imageDescription ? (
            <span data-testid="vision-description">
              <b>Vision:</b> {m.meta.imageDescription}
            </span>
          ) : (
            <span data-testid="vision-description" className="pending-line">
              <span className="spinner" /> Describing image...
            </span>
          )}
        </div>
        {meta}
      </>
    );
  } else {
    body = (
      <div className="bubble-text">
        <RichText text={m.text ?? ''} />
        <span className="meta-spacer in" />
        {meta}
      </div>
    );
  }
  const chips: string[] = m.role === 'assistant' ? (m.meta.tools ?? []) : [];
  const showExtras = m.role === 'assistant' && (chips.length > 0 || m.meta.guard || m.meta.kind || m.latencyMs);
  return (
    <div className={`msg-row ${side}${tail ? ' first' : ''} owner-row`}>
      {label ? (
        <div className={`sender-label ${m.role}`}>
          {m.role === 'assistant' ? <IconBot size={13} /> : <IconUser size={13} />}
          {label}
        </div>
      ) : null}
      <div
        className={`bubble bubble-${side} type-${m.type}${tail ? ' has-tail' : ''}${m.role === 'owner' ? ' by-owner' : ''}`}
        data-testid="message"
        data-role={m.role}
        data-type={m.type}
        data-status={m.status}
        data-message-id={m.id}
      >
        {tail ? <Tail side={side} /> : null}
        {body}
      </div>
      {showExtras || m.meta.error ? (
        <div className="msg-extras">
          {m.meta.kind ? <span className="chip-kind">{m.meta.kind.replace(/_/g, ' ')}</span> : null}
          {m.meta.guard ? (
            <span className="chip-guard" title="Reply was replaced by the price guard">
              <IconShield size={13} /> price guard
            </span>
          ) : null}
          {chips.map((t, i) => (
            <span key={`${t}${i}`} className="chip-tool">
              {t}
            </span>
          ))}
          {m.latencyMs ? <span className="chip-latency">{(m.latencyMs / 1000).toFixed(1)}s</span> : null}
          {m.meta.error ? <span className="chip-error">{m.meta.error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function OwnerThread(props: {
  detail: ConversationDetailDTO;
  tenant: TenantDTO;
  typing: boolean;
  onChanged: () => void;
  onDetail: (d: ConversationDetailDTO) => void;
  onBack?: () => void;
}) {
  const { detail, typing } = props;
  const conv = detail.conversation;
  const [infoOpen, setInfoOpen] = useState(() => !window.matchMedia('(max-width: 760px)').matches);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; caption: string | null } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const name = conv.contact.waName || conv.contact.phone;
  const lastKey = `${detail.messages.length}:${detail.messages[detail.messages.length - 1]?.id ?? 0}`;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastKey, typing]);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    // A hidden textarea (e.g. mounted behind the phone list view) measures 0: keep 'auto' instead of pinning 0px.
    if (ta.scrollHeight > 0) ta.style.height = `${Math.min(ta.scrollHeight, 118)}px`;
  }, [text]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      console.error('[kani] owner action failed', err);
    } finally {
      setBusy(false);
      props.onChanged();
    }
  }

  async function sendOwner() {
    const v = text.trim();
    if (!v || conv.status !== 'human') return;
    setText('');
    try {
      const res = await api.ownerMessage(conv.id, v);
      props.onDetail({ ...detail, messages: upsertMessage(detail.messages, res.message) });
    } catch (err) {
      console.error('[kani] owner send failed', err);
      setText(v);
    }
  }

  let prevDay = '';
  let prevRole = '';
  let prevSide = '';

  return (
    <div className="thread-wrap">
      <div className="thread">
        <header className="thread-header owner-thread-header">
          {props.onBack ? (
            <button type="button" className="icon-btn mobile-back" aria-label="Back" data-testid="mobile-back" onClick={props.onBack}>
              <IconBack />
            </button>
          ) : null}
          <div className="thread-header-who static">
            <PersonAvatar name={name} size={40} />
            <span className="thread-header-text">
              <span className="thread-title">{name}</span>
              <span className="thread-subtitle">{conv.contact.phone}</span>
            </span>
            <StatusPill status={conv.status} testId="owner-status" />
          </div>
          <div className="thread-actions">
            {conv.status === 'bot' || conv.status === 'closed' ? (
              <button type="button" className="btn-primary btn-sm" data-testid="takeover-button" disabled={busy} onClick={() => void act(() => api.takeover(conv.id))}>
                Take over
              </button>
            ) : null}
            {conv.status === 'human' ? (
              <button type="button" className="btn-outline btn-sm" data-testid="resume-button" disabled={busy} onClick={() => void act(() => api.resume(conv.id))}>
                <IconBot size={16} /> Resume bot
              </button>
            ) : null}
            <button
              type="button"
              className={`icon-btn${infoOpen ? ' pressed' : ''}`}
              aria-label="Toggle details"
              title="Details"
              onClick={() => setInfoOpen((v) => !v)}
            >
              <IconSidebar />
            </button>
          </div>
        </header>
        {conv.openEscalations.map((e) => (
          <div key={e.id} className="esc-banner" data-testid="escalation-banner">
            <IconAlert size={18} />
            <span className="esc-text">
              <b>Escalated:</b> {e.reason}
            </span>
            <span className="esc-time">{fmtRelative(e.createdAt)}</span>
            <button type="button" className="btn-danger btn-sm" data-testid="resolve-escalation-button" disabled={busy} onClick={() => void act(() => api.resolveEscalation(e.id))}>
              Mark resolved
            </button>
          </div>
        ))}
        <div className="thread-body wallpaper">
          <div className="message-list" data-testid="message-list" ref={listRef}>
            <div className="message-list-inner">
              {detail.messages.map((m) => {
                const day = dayKey(m.createdAt);
                const side = m.role === 'customer' ? 'in' : 'out';
                const newDay = day !== prevDay;
                const tail = newDay || side !== prevSide;
                const label = m.role !== 'customer' && (newDay || m.role !== prevRole) ? (m.role === 'assistant' ? 'Kani bot' : 'You (owner)') : null;
                prevDay = day;
                prevSide = side;
                prevRole = m.role;
                return (
                  <Fragment key={m.id}>
                    {newDay ? (
                      <div className="day-row">
                        <span className="day-chip">{fmtDayChipEn(m.createdAt)}</span>
                      </div>
                    ) : null}
                    <OwnerBubble m={m} tail={tail} label={label} onImage={(src, caption) => setLightbox({ src, caption })} />
                  </Fragment>
                );
              })}
              {typing ? (
                <div className="msg-row out first owner-row">
                  <div className="sender-label assistant">
                    <IconBot size={13} />
                    Kani bot
                  </div>
                  <div className="bubble bubble-out has-tail typing-bubble" data-testid="typing-indicator">
                    <Tail side="out" />
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {conv.status !== 'human' ? (
          <div className="owner-notice" data-testid="owner-notice">
            <IconBot size={18} />
            <span>{conv.status === 'closed' ? 'This conversation is closed. Take over to reply.' : 'Kani bot is handling this conversation. Take over to reply.'}</span>
          </div>
        ) : null}
        <footer className={`composer owner-composer${conv.status !== 'human' ? ' disabled' : ''}`}>
          <div className="composer-input">
            <textarea
              ref={taRef}
              rows={1}
              placeholder="Reply as the owner..."
              value={text}
              disabled={conv.status !== 'human'}
              data-testid="owner-composer-input"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void sendOwner();
                }
              }}
            />
          </div>
          <button
            type="button"
            className="send-circle"
            aria-label="Send"
            data-testid="owner-send-button"
            disabled={conv.status !== 'human' || !text.trim()}
            onClick={() => void sendOwner()}
          >
            <IconSend size={22} />
          </button>
        </footer>
      </div>
      {infoOpen ? <InfoPanel detail={detail} busy={busy} onAction={(fn) => void act(fn)} onClose={() => setInfoOpen(false)} /> : null}
      {lightbox ? <Lightbox src={lightbox.src} caption={lightbox.caption} title={name} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}
