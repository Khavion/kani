import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { ServerEvent, TenantDTO } from '../api/types.ts';
import type { CustomerIdentity } from '../lib/storage.ts';
import { loadSeen, saveSeen } from '../lib/storage.ts';
import { serverNow } from '../lib/clock.ts';
import { ChatList } from './ChatList.tsx';
import { ChatThread } from './ChatThread.tsx';
import { upsertMessage, type Chat, type OutgoingPayload, type UIMessage } from './types.ts';
import { installWallpaper } from './wallpaper.ts';
import { KaniLogo } from '../components/KaniLogo.tsx';

installWallpaper();

let tempSeq = 0;

export interface CustomerStore {
  chats: Record<string, Chat>;
  unreadByTenant: Record<string, number>;
  totalUnread: number;
  isTyping: (t: TenantDTO) => boolean;
  send: (t: TenantDTO, p: OutgoingPayload) => Promise<void>;
  reset: (t: TenantDTO) => Promise<void>;
}

/** Customer-side chat state. Lives in App so it survives tab switches and keeps the unread badge live. */
export function useCustomerStore(tenants: TenantDTO[], tenantId: string | null, customer: CustomerIdentity, active: boolean): CustomerStore {
  const [chats, setChats] = useState<Record<string, Chat>>({});
  const [typing, setTyping] = useState<Record<number, boolean>>({});
  const [seen, setSeen] = useState<Record<string, number>>(loadSeen);
  const typingTimers = useRef(new Map<number, number>());

  const loadSession = useCallback(
    async (t: TenantDTO) => {
      try {
        const res = await api.simSession(t.id, customer.phone, customer.name);
        setChats((prev) => ({ ...prev, [t.id]: { conversation: res.conversation, messages: res.messages, loaded: true, error: null } }));
        const maxId = res.messages.reduce((a, m) => Math.max(a, m.id), 0);
        setSeen((prev) => (prev[t.id] === undefined ? { ...prev, [t.id]: maxId } : prev));
      } catch (err) {
        setChats((prev) => ({
          ...prev,
          [t.id]: { conversation: prev[t.id]?.conversation ?? null, messages: prev[t.id]?.messages ?? [], loaded: true, error: String(err) },
        }));
      }
    },
    [customer.phone, customer.name],
  );

  useEffect(() => {
    tenants.forEach((t) => void loadSession(t));
  }, [tenants, loadSession]);

  useEffect(() => {
    saveSeen(seen);
  }, [seen]);

  // Live updates.
  useEffect(() => {
    const setTypingFor = (convId: number, on: boolean) => {
      const timers = typingTimers.current;
      const old = timers.get(convId);
      if (old) window.clearTimeout(old);
      timers.delete(convId);
      if (on) timers.set(convId, window.setTimeout(() => setTyping((p) => ({ ...p, [convId]: false })), 60_000));
      setTyping((p) => (p[convId] === on ? p : { ...p, [convId]: on }));
    };
    const handler = (e: ServerEvent) => {
      if (e.type === 'message.created' || e.type === 'message.updated') {
        setChats((prev) => {
          const chat = prev[e.tenantId];
          if (!chat || chat.conversation?.id !== e.conversationId) return prev;
          return { ...prev, [e.tenantId]: { ...chat, messages: upsertMessage(chat.messages, e.message) } };
        });
        if (e.type === 'message.created' && e.message.role !== 'customer') setTypingFor(e.conversationId, false);
      } else if (e.type === 'typing') {
        setTypingFor(e.conversationId, e.on);
      } else if (e.type === 'conversation.updated') {
        setChats((prev) => {
          const chat = prev[e.tenantId];
          if (!chat || chat.conversation?.id !== e.conversation.id) return prev;
          return { ...prev, [e.tenantId]: { ...chat, conversation: e.conversation } };
        });
      }
    };
    const unsub = api.subscribe(handler);
    return () => {
      unsub();
    };
  }, []);

  const selected = tenants.find((t) => t.id === tenantId) ?? null;
  const selectedChat = selected ? chats[selected.id] : undefined;

  // Mark the open chat as read.
  useEffect(() => {
    if (!active || !selected || !selectedChat) return;
    const maxId = selectedChat.messages.reduce((a, m) => Math.max(a, m.id), 0);
    if ((seen[selected.id] ?? -1) < maxId) setSeen((p) => ({ ...p, [selected.id]: maxId }));
  }, [active, selected, selectedChat, seen]);

  const unreadByTenant = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of tenants) {
      const chat = chats[t.id];
      const s = seen[t.id];
      if (!chat || s === undefined || (active && t.id === tenantId)) {
        out[t.id] = 0;
        continue;
      }
      out[t.id] = chat.messages.filter((m) => m.role !== 'customer' && m.id > s).length;
    }
    return out;
  }, [tenants, chats, seen, active, tenantId]);

  const totalUnread = Object.values(unreadByTenant).reduce((a, b) => a + b, 0);

  const send = useCallback(
    async (t: TenantDTO, p: OutgoingPayload) => {
      const chat = chats[t.id];
      const key = `tmp-${++tempSeq}`;
      const localUrl = p.file ? URL.createObjectURL(p.file) : null;
      const temp: UIMessage = {
        id: -Date.now() - tempSeq,
        conversationId: chat?.conversation?.id ?? -1,
        role: 'customer',
        type: p.type,
        text: p.type === 'audio' ? null : (p.text ?? null),
        transcript: null,
        mediaUrl: localUrl,
        latencyMs: null,
        status: 'sent',
        createdAt: serverNow().toISOString(),
        meta: p.durationS ? { durationS: p.durationS } : {},
        clientKey: key,
        uiStatus: 'pending',
      };
      setChats((prev) => {
        const c = prev[t.id] ?? { conversation: null, messages: [], loaded: true, error: null };
        return { ...prev, [t.id]: { ...c, messages: [...c.messages, temp] } };
      });
      try {
        const res = await api.simSend({
          tenantId: t.id,
          phone: customer.phone,
          name: customer.name,
          type: p.type,
          text: p.text,
          durationS: p.durationS,
          file: p.file,
          fileName: p.fileName,
        });
        setChats((prev) => {
          const c = prev[t.id];
          if (!c) return prev;
          return { ...prev, [t.id]: { ...c, messages: upsertMessage(c.messages, res.message, key) } };
        });
      } catch (err) {
        console.error('[kani] send failed', err);
        setChats((prev) => {
          const c = prev[t.id];
          if (!c) return prev;
          return { ...prev, [t.id]: { ...c, messages: c.messages.map((m) => (m.clientKey === key ? { ...m, uiStatus: 'failed' as const } : m)) } };
        });
      }
    },
    [chats, customer.phone, customer.name],
  );

  const reset = useCallback(
    async (t: TenantDTO) => {
      try {
        await api.simReset(t.id, customer.phone);
      } catch (err) {
        console.error('[kani] reset failed', err);
      }
      setChats((prev) => ({ ...prev, [t.id]: { conversation: null, messages: [], loaded: false, error: null } }));
      await loadSession(t);
    },
    [customer.phone, loadSession],
  );

  const isTyping = useCallback(
    (t: TenantDTO) => {
      const id = chats[t.id]?.conversation?.id;
      return id !== undefined && !!typing[id];
    },
    [chats, typing],
  );

  return { chats, unreadByTenant, totalUnread, isTyping, send, reset };
}

export function CustomerView(props: {
  store: CustomerStore;
  tenants: TenantDTO[];
  tenantId: string | null;
  onSelectTenant: (id: string) => void;
  customer: CustomerIdentity;
  onCustomerChange: (c: CustomerIdentity) => void;
}) {
  const { tenants, tenantId, customer, store } = props;
  const { chats, unreadByTenant, isTyping, send, reset } = store;
  const selected = tenants.find((t) => t.id === tenantId) ?? null;
  const selectedChat = selected ? chats[selected.id] : undefined;

  return (
    <div className="customer-view">
      <ChatList
        tenants={tenants}
        chats={chats}
        selectedId={tenantId}
        onSelect={props.onSelectTenant}
        unread={unreadByTenant}
        isTyping={isTyping}
        customer={customer}
        onCustomerChange={props.onCustomerChange}
      />
      <main className="chat-panel">
        {selected ? (
          <ChatThread
            key={selected.id}
            tenant={selected}
            chat={selectedChat}
            typing={isTyping(selected)}
            customer={customer}
            onSend={(p) => void send(selected, p)}
            onReset={() => void reset(selected)}
          />
        ) : (
          <div className="chat-empty">
            <KaniLogo size={96} />
            <h1>Kani</h1>
            <p>Escolha uma conversa à esquerda para começar.</p>
          </div>
        )}
      </main>
    </div>
  );
}
