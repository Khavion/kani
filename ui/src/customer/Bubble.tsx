import type { TenantDTO } from '../api/types.ts';
import type { CustomerIdentity } from '../lib/storage.ts';
import { fmtTime } from '../lib/format.ts';
import { RichText } from '../lib/richtext.tsx';
import { Ticks, IconMic } from '../components/Icons.tsx';
import { AudioPlayer } from '../components/AudioPlayer.tsx';
import { PersonAvatar, TenantAvatar } from '../components/Avatar.tsx';
import type { UIMessage } from './types.ts';

export function Tail({ side }: { side: 'in' | 'out' }) {
  return (
    <span className="tail" aria-hidden="true">
      <svg viewBox="0 0 8 13" width="8" height="13">
        {side === 'in' ? <path d="M8 0H2.3C.5 0-.4 2 .8 3.4L8 12.2Z" /> : <path d="M0 0h5.7c1.8 0 2.7 2 1.5 3.4L0 12.2Z" />}
      </svg>
    </span>
  );
}

function Meta({ m, out, overlay }: { m: UIMessage; out: boolean; overlay?: boolean }) {
  return (
    <span className={`meta${overlay ? ' meta-overlay' : ''}`}>
      <span className="meta-time">{fmtTime(m.createdAt)}</span>
      {out ? <Ticks status={m.uiStatus ?? m.status} /> : null}
    </span>
  );
}

export function Bubble(props: {
  m: UIMessage;
  tail: boolean;
  tenant: TenantDTO;
  customer: CustomerIdentity;
  onOpenImage: (src: string, caption: string | null) => void;
  onMediaLoad?: () => void;
}) {
  const { m, tail } = props;
  const out = m.role === 'customer';
  const side = out ? 'out' : 'in';
  const status = m.uiStatus ?? m.status;

  let content;
  if (m.type === 'audio') {
    const avatar = (
      <span className="ptt-avatar-inner">
        {out ? <PersonAvatar name={props.customer.name} size={46} /> : <TenantAvatar tenant={props.tenant} size={46} />}
        <span className="ptt-mic">
          <IconMic size={14} />
        </span>
      </span>
    );
    content = (
      <>
        <AudioPlayer id={m.id} src={m.mediaUrl} durationS={m.meta.durationS} side={side} avatar={avatar} avatarRight={out} />
        <Meta m={m} out={out} />
      </>
    );
  } else if (m.type === 'image') {
    const caption = m.text?.trim() ? m.text : null;
    content = (
      <>
        <div className="img-wrap">
          {m.mediaUrl ? (
            <img
              src={m.mediaUrl}
              alt={caption ?? 'Foto'}
              className="bubble-img"
              onLoad={props.onMediaLoad}
              onClick={() => m.mediaUrl && props.onOpenImage(m.mediaUrl, caption)}
            />
          ) : (
            <div className="bubble-img placeholder" />
          )}
          {!caption ? <Meta m={m} out={out} overlay /> : null}
        </div>
        {caption ? (
          <div className="bubble-text caption">
            <RichText text={caption} />
            <span className={`meta-spacer ${side}`} />
            <Meta m={m} out={out} />
          </div>
        ) : null}
      </>
    );
  } else {
    content = (
      <div className="bubble-text">
        <RichText text={m.text ?? ''} />
        <span className={`meta-spacer ${side}`} />
        <Meta m={m} out={out} />
      </div>
    );
  }

  return (
    <div className={`msg-row ${side}${tail ? ' first' : ''}`}>
      <div
        className={`bubble bubble-${side} type-${m.type}${tail ? ' has-tail' : ''}`}
        data-testid="message"
        data-role={m.role}
        data-type={m.type}
        data-status={status}
        data-message-id={m.id}
      >
        {tail ? <Tail side={side} /> : null}
        {content}
      </div>
    </div>
  );
}

export function TypingBubble() {
  return (
    <div className="msg-row in first">
      <div className="bubble bubble-in has-tail typing-bubble" data-testid="typing-indicator" aria-label="digitando">
        <Tail side="in" />
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
    </div>
  );
}
