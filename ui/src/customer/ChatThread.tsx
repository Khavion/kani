import { Fragment, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { TenantDTO } from '../api/types.ts';
import type { CustomerIdentity } from '../lib/storage.ts';
import { TenantAvatar } from '../components/Avatar.tsx';
import { IconBot, IconKebab, IconSearch } from '../components/Icons.tsx';
import { Menu } from '../components/Menu.tsx';
import { Lightbox } from '../components/Lightbox.tsx';
import { dayKey, fmtDayChip } from '../lib/format.ts';
import { Bubble, TypingBubble } from './Bubble.tsx';
import { Composer } from './Composer.tsx';
import { ImagePreview } from './ImagePreview.tsx';
import { ContactInfo } from './ContactInfo.tsx';
import type { Chat, OutgoingPayload } from './types.ts';

export function ChatThread(props: {
  tenant: TenantDTO;
  chat: Chat | undefined;
  typing: boolean;
  customer: CustomerIdentity;
  onSend: (p: OutgoingPayload) => void;
  onReset: () => void;
}) {
  const { tenant, chat, typing } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; caption: string | null } | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const messages = chat?.messages ?? [];
  const lastKey = messages.length ? `${messages[messages.length - 1]!.id}:${messages.length}` : '0';

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    scrollToBottom();
  }, [lastKey, typing, scrollToBottom]);

  const onMediaLoad = useCallback(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 400) scrollToBottom();
  }, [scrollToBottom]);

  let prevDay = '';
  let prevSide = '';

  return (
    <div className="thread-wrap">
      <div className="thread">
        <header className="thread-header">
          <button type="button" className="thread-header-who" onClick={() => setInfoOpen(true)} aria-label="Dados do contato">
            <TenantAvatar tenant={tenant} size={40} />
            <span className="thread-header-text">
              <span className="thread-title" data-testid="chat-header-title">
                {tenant.name}
              </span>
              <span className={`thread-subtitle${typing ? ' typing-text' : ''}`} data-testid="chat-header-subtitle">
                {typing ? 'digitando...' : 'online'}
              </span>
            </span>
          </button>
          <div className="thread-actions">
            <button type="button" className="icon-btn" aria-label="Pesquisar" title="Pesquisar">
              <IconSearch />
            </button>
            <div className="menu-anchor">
              <button
                type="button"
                className={`icon-btn${menuOpen ? ' pressed' : ''}`}
                aria-label="Mais opções"
                title="Mais opções"
                data-testid="menu-button"
                onClick={() => setMenuOpen((v) => !v)}
              >
                <IconKebab />
              </button>
              <Menu open={menuOpen} onClose={() => setMenuOpen(false)}>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  data-testid="menu-contact-info"
                  onClick={() => {
                    setMenuOpen(false);
                    setInfoOpen(true);
                  }}
                >
                  Dados do contato
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  data-testid="menu-clear"
                  onClick={() => {
                    setMenuOpen(false);
                    props.onReset();
                  }}
                >
                  Limpar conversa
                </button>
              </Menu>
            </div>
          </div>
        </header>

        <div className="thread-body wallpaper">
          <div className="message-list" data-testid="message-list" ref={listRef}>
            <div className="message-list-inner">
              <div className="notice-row">
                <div className="notice-chip">
                  <IconBot size={14} />
                  <span>As mensagens são respondidas por um assistente virtual (Kani).</span>
                </div>
              </div>
              {chat && !chat.loaded ? <div className="thread-loading">Carregando mensagens...</div> : null}
              {chat?.error && messages.length === 0 ? <div className="thread-error">Não foi possível carregar a conversa.</div> : null}
              {messages.map((m) => {
                const day = dayKey(m.createdAt);
                const side = m.role === 'customer' ? 'out' : 'in';
                const newDay = day !== prevDay;
                const tail = newDay || side !== prevSide;
                prevDay = day;
                prevSide = side;
                return (
                  <Fragment key={m.clientKey ?? m.id}>
                    {newDay ? (
                      <div className="day-row">
                        <span className="day-chip">{fmtDayChip(m.createdAt)}</span>
                      </div>
                    ) : null}
                    <Bubble
                      m={m}
                      tail={tail}
                      tenant={tenant}
                      customer={props.customer}
                      onOpenImage={(src, caption) => setLightbox({ src, caption })}
                      onMediaLoad={onMediaLoad}
                    />
                  </Fragment>
                );
              })}
              {typing ? <TypingBubble /> : null}
            </div>
          </div>
        </div>

        <Composer onSend={props.onSend} onPickImage={setPendingImage} />

        {pendingImage ? (
          <ImagePreview
            file={pendingImage}
            tenant={tenant}
            onClose={() => setPendingImage(null)}
            onSend={(caption) => {
              props.onSend({ type: 'image', file: pendingImage, fileName: pendingImage.name, text: caption || undefined });
              setPendingImage(null);
            }}
          />
        ) : null}
      </div>
      {infoOpen ? <ContactInfo tenant={tenant} onClose={() => setInfoOpen(false)} /> : null}
      {lightbox ? <Lightbox src={lightbox.src} caption={lightbox.caption} title={tenant.name} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}
