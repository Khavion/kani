import { useMemo, useRef, useState } from 'react';
import type { TenantDTO } from '../api/types.ts';
import type { CustomerIdentity } from '../lib/storage.ts';
import { TenantAvatar } from '../components/Avatar.tsx';
import { IconCamera, IconKebab, IconMic, IconNewChat, IconSearch, IconBack, Ticks } from '../components/Icons.tsx';
import { Menu } from '../components/Menu.tsx';
import { fmtDuration, fmtListTime } from '../lib/format.ts';
import type { Chat, UIMessage } from './types.ts';
import { ProfileDialog } from './ProfileDialog.tsx';

const CHIPS = ['Tudo', 'Não lidas', 'Favoritas', 'Grupos'];

function Preview({ m }: { m: UIMessage }) {
  const out = m.role === 'customer';
  const status = m.uiStatus ?? m.status;
  let body;
  if (m.type === 'audio') {
    const d = m.meta.durationS;
    body = (
      <>
        <IconMic size={16} className={`pv-icon${out && m.status === 'read' ? ' pv-blue' : ''}`} />
        <span>{d ? fmtDuration(d) : 'Áudio'}</span>
      </>
    );
  } else if (m.type === 'image') {
    body = (
      <>
        <IconCamera size={16} className="pv-icon" />
        <span>{m.text?.trim() ? m.text : 'Foto'}</span>
      </>
    );
  } else {
    body = <span>{(m.text ?? '').split('\n').find((l) => l.trim()) ?? ''}</span>;
  }
  return (
    <>
      {out ? <Ticks status={status} /> : null}
      {body}
    </>
  );
}

export function ChatList(props: {
  tenants: TenantDTO[];
  chats: Record<string, Chat>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  unread: Record<string, number>;
  isTyping: (t: TenantDTO) => boolean;
  customer: CustomerIdentity;
  onCustomerChange: (c: CustomerIdentity) => void;
}) {
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchFocus, setSearchFocus] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = props.tenants
      .map((t, i) => {
        const msgs = props.chats[t.id]?.messages ?? [];
        const last = msgs[msgs.length - 1] ?? null;
        return { t, i, last };
      })
      .filter((r) => !q || r.t.name.toLowerCase().includes(q));
    list.sort((a, b) => {
      const ta = a.last ? Date.parse(a.last.createdAt) : 0;
      const tb = b.last ? Date.parse(b.last.createdAt) : 0;
      return tb - ta || a.i - b.i;
    });
    return list;
  }, [props.tenants, props.chats, query]);

  return (
    <aside className="side-panel">
      <header className="side-header">
        <h1 className="side-title">Conversas</h1>
        <div className="side-actions">
          <button type="button" className="icon-btn" aria-label="Nova conversa" title="Nova conversa" onClick={() => searchRef.current?.focus()}>
            <IconNewChat />
          </button>
          <div className="menu-anchor">
            <button type="button" className={`icon-btn${menuOpen ? ' pressed' : ''}`} aria-label="Menu" title="Menu" onClick={() => setMenuOpen((v) => !v)}>
              <IconKebab />
            </button>
            <Menu open={menuOpen} onClose={() => setMenuOpen(false)}>
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                data-testid="menu-profile"
                onClick={() => {
                  setMenuOpen(false);
                  setProfileOpen(true);
                }}
              >
                Meu perfil
              </button>
            </Menu>
          </div>
        </div>
      </header>
      <div className="side-search">
        <label className={`search-box${searchFocus ? ' focus' : ''}`}>
          <span className="search-icon">{searchFocus ? <IconBack size={20} /> : <IconSearch size={20} />}</span>
          <input
            ref={searchRef}
            type="text"
            placeholder="Pesquisar ou começar uma nova conversa"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setSearchFocus(false)}
            aria-label="Pesquisar"
          />
        </label>
      </div>
      <div className="chips" role="tablist">
        {CHIPS.map((c, i) => (
          <button type="button" key={c} className={`chip${i === 0 ? ' active' : ''}`} role="tab" aria-selected={i === 0} tabIndex={i === 0 ? 0 : -1}>
            {c}
          </button>
        ))}
      </div>
      <div className="chat-list" data-testid="chat-list" role="list">
        {rows.map(({ t, last }) => {
          const unread = props.unread[t.id] ?? 0;
          const typing = props.isTyping(t);
          const selected = t.id === props.selectedId;
          return (
            <button
              type="button"
              role="listitem"
              key={t.id}
              className={`chat-row${selected ? ' selected' : ''}`}
              data-testid={`chat-item-${t.id}`}
              onClick={() => props.onSelect(t.id)}
            >
              <span className="chat-row-avatar">
                <TenantAvatar tenant={t} size={49} />
              </span>
              <span className="chat-row-main">
                <span className="chat-row-top">
                  <span className="chat-row-name">{t.name}</span>
                  <span className={`chat-row-time${unread ? ' unread' : ''}`}>{last ? fmtListTime(last.createdAt) : ''}</span>
                </span>
                <span className="chat-row-bottom">
                  <span className="chat-row-preview">
                    {typing ? <span className="typing-text">digitando...</span> : last ? <Preview m={last} /> : <span className="muted">{t.packName}</span>}
                  </span>
                  {unread > 0 ? <span className="unread-badge">{unread}</span> : null}
                </span>
              </span>
            </button>
          );
        })}
        {rows.length === 0 ? <div className="chat-list-empty">Nenhuma conversa encontrada</div> : null}
      </div>
      {profileOpen ? (
        <ProfileDialog
          customer={props.customer}
          onClose={() => setProfileOpen(false)}
          onSave={(c) => {
            props.onCustomerChange(c);
            setProfileOpen(false);
          }}
        />
      ) : null}
    </aside>
  );
}
