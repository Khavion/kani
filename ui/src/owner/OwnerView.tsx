import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../lib/mobile.ts';
import { api } from '../api/client.ts';
import type { ConversationDTO, ConversationDetailDTO, ServerEvent, TenantDTO } from '../api/types.ts';
import { PersonAvatar, TenantAvatar } from '../components/Avatar.tsx';
import { IconCamera, IconChevronDown, IconMic, IconSearch } from '../components/Icons.tsx';
import { fmtDuration, fmtListTimeEn } from '../lib/format.ts';
import { OwnerThread } from './OwnerThread.tsx';
import { upsertMessage } from '../customer/types.ts';

export function StatusPill({ status, testId }: { status: ConversationDTO['status']; testId?: string }) {
  const label = status === 'bot' ? 'Bot' : status === 'human' ? 'Human' : 'Closed';
  return (
    <span className={`pill pill-${status}`} data-testid={testId}>
      {label}
    </span>
  );
}

function previewOf(c: ConversationDTO) {
  const m = c.lastMessage;
  if (!m) return <span className="muted">No messages yet</span>;
  const who = m.role === 'assistant' ? 'Kani: ' : m.role === 'owner' ? 'You: ' : '';
  if (m.type === 'audio')
    return (
      <>
        {who}
        <IconMic size={15} className="pv-icon" />
        <span>Voice message{m.meta.durationS ? ` (${fmtDuration(m.meta.durationS)})` : ''}</span>
      </>
    );
  if (m.type === 'image')
    return (
      <>
        {who}
        <IconCamera size={15} className="pv-icon" />
        <span>{m.text?.trim() || 'Photo'}</span>
      </>
    );
  return (
    <span>
      {who}
      {(m.text ?? '').split('\n')[0]}
    </span>
  );
}

export function OwnerView(props: { tenants: TenantDTO[]; tenantId: string | null; onSelectTenant: (id: string) => void; active: boolean }) {
  const { tenants, tenantId, active } = props;
  const tenant = tenants.find((t) => t.id === tenantId) ?? null;
  const [convs, setConvs] = useState<ConversationDTO[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const mobile = useIsMobile();
  const [threadOpen, setThreadOpen] = useState(false);
  const [detail, setDetail] = useState<ConversationDetailDTO | null>(null);
  const [typing, setTyping] = useState<Record<number, boolean>>({});
  const [filter, setFilter] = useState('');
  const tenantRef = useRef(tenantId);
  const selectedRef = useRef(selectedId);
  tenantRef.current = tenantId;
  selectedRef.current = selectedId;
  const listTimer = useRef<number | null>(null);
  const detailTimer = useRef<number | null>(null);

  const loadList = useCallback(async () => {
    const tid = tenantRef.current;
    if (!tid) return;
    try {
      const list = await api.conversations(tid);
      if (tenantRef.current !== tid) return;
      setConvs(list);
      setListError(null);
      setSelectedId((cur) => (cur !== null && list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? null)));
    } catch (err) {
      setListError(String(err));
    }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const d = await api.conversation(id);
      if (selectedRef.current === id) setDetail(d);
    } catch (err) {
      console.error('[kani] load conversation failed', err);
    }
  }, []);

  useEffect(() => {
    setConvs([]);
    setSelectedId(null);
    setDetail(null);
    void loadList();
  }, [tenantId, loadList]);

  useEffect(() => {
    if (active) void loadList();
  }, [active, loadList]);

  useEffect(() => {
    setDetail((d) => (d && d.conversation.id === selectedId ? d : null));
    if (selectedId !== null) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    const scheduleList = () => {
      if (listTimer.current) window.clearTimeout(listTimer.current);
      listTimer.current = window.setTimeout(() => void loadList(), 300);
    };
    const scheduleDetail = () => {
      const id = selectedRef.current;
      if (id === null) return;
      if (detailTimer.current) window.clearTimeout(detailTimer.current);
      detailTimer.current = window.setTimeout(() => void loadDetail(id), 700);
    };
    const handler = (e: ServerEvent) => {
      if (e.type === 'clock') return;
      if (e.tenantId !== tenantRef.current) return;
      if (e.type === 'typing') {
        setTyping((p) => ({ ...p, [e.conversationId]: e.on }));
        return;
      }
      if (e.type === 'message.created' || e.type === 'conversation.updated' || e.type === 'escalation.created') scheduleList();
      const convId = e.type === 'conversation.updated' ? e.conversation.id : e.conversationId;
      if (convId !== selectedRef.current) return;
      if (e.type === 'message.created' || e.type === 'message.updated') {
        setDetail((d) => (d && d.conversation.id === convId ? { ...d, messages: upsertMessage(d.messages, e.message) } : d));
        if (e.type === 'message.created') {
          if (e.message.role !== 'customer') setTyping((p) => ({ ...p, [convId]: false }));
          scheduleDetail();
        }
      } else if (e.type === 'conversation.updated') {
        setDetail((d) => (d && d.conversation.id === convId ? { ...d, conversation: e.conversation } : d));
      } else if (e.type === 'escalation.created') {
        scheduleDetail();
      }
    };
    return api.subscribe(handler);
  }, [loadList, loadDetail]);

  const refreshAll = useCallback(() => {
    void loadList();
    if (selectedRef.current !== null) void loadDetail(selectedRef.current);
  }, [loadList, loadDetail]);

  const shown = convs.filter((c) => {
    const q = filter.trim().toLowerCase();
    return !q || c.contact.waName.toLowerCase().includes(q) || c.contact.phone.includes(q);
  });

  return (
    <div className={`owner-view${mobile && threadOpen ? ' mobile-thread' : ''}`} lang="en">
      <aside className="side-panel owner-side">
        <header className="side-header owner-side-header">
          <div className="owner-tenant">
            {tenant ? <TenantAvatar tenant={tenant} size={40} /> : null}
            <div className="owner-tenant-text">
              <span className="owner-kicker">Business inbox</span>
              <label className="select-wrap">
                <select
                  data-testid="owner-tenant-select"
                  value={tenantId ?? ''}
                  onChange={(e) => props.onSelectTenant(e.target.value)}
                  aria-label="Business"
                >
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <IconChevronDown size={18} />
              </label>
            </div>
          </div>
        </header>
        <div className="side-search">
          <label className="search-box">
            <span className="search-icon">
              <IconSearch size={20} />
            </span>
            <input type="text" placeholder="Search contacts" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search contacts" />
          </label>
        </div>
        <div className="owner-list-meta">
          <span>{convs.length} conversations</span>
          <span>
            {convs.filter((c) => c.status === 'human').length} with a human · {convs.filter((c) => c.openEscalations.length).length} escalated
          </span>
        </div>
        <div className="chat-list" data-testid="owner-conversation-list" role="list">
          {listError ? <div className="chat-list-empty">Could not load conversations.</div> : null}
          {shown.map((c) => {
            const name = c.contact.waName || c.contact.phone;
            return (
              <button
                type="button"
                role="listitem"
                key={c.id}
                className={`chat-row${c.id === selectedId ? ' selected' : ''}`}
                data-testid={`owner-conversation-${c.id}`}
                onClick={() => {
                  setSelectedId(c.id);
                  setThreadOpen(true);
                }}
              >
                <span className="chat-row-avatar">
                  <PersonAvatar name={name} size={49} />
                  {c.openEscalations.length ? <span className="esc-dot" title="Open escalation" /> : null}
                </span>
                <span className="chat-row-main">
                  <span className="chat-row-top">
                    <span className="chat-row-name">{name}</span>
                    <span className="chat-row-time">{c.lastMsgAt ? fmtListTimeEn(c.lastMsgAt) : ''}</span>
                  </span>
                  <span className="chat-row-bottom">
                    <span className="chat-row-preview">{typing[c.id] ? <span className="typing-text">Kani is typing...</span> : previewOf(c)}</span>
                    <StatusPill status={c.status} />
                  </span>
                </span>
              </button>
            );
          })}
          {!listError && convs.length === 0 ? <div className="chat-list-empty">No conversations yet for this business.</div> : null}
        </div>
      </aside>
      <main className="chat-panel owner-panel">
        {detail && tenant ? (
          <OwnerThread key={detail.conversation.id} detail={detail} tenant={tenant} typing={!!typing[detail.conversation.id]} onChanged={refreshAll} onDetail={setDetail} onBack={() => setThreadOpen(false)} />
        ) : (
          <div className="chat-empty">
            <p>{selectedId === null ? 'Select a conversation' : 'Loading conversation...'}</p>
          </div>
        )}
      </main>
    </div>
  );
}
