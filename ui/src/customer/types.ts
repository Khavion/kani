import type { ConversationDTO, MessageDTO, MsgStatus } from '../api/types.ts';

export interface UIMessage extends MessageDTO {
  clientKey?: string;
  uiStatus?: 'pending' | 'failed';
}

export interface Chat {
  conversation: ConversationDTO | null;
  messages: UIMessage[];
  loaded: boolean;
  error: string | null;
}

export interface OutgoingPayload {
  type: 'text' | 'audio' | 'image';
  text?: string;
  file?: Blob;
  fileName?: string;
  durationS?: number;
}

const RANK: Record<MsgStatus, number> = { sent: 0, delivered: 1, read: 2 };

/** Insert or replace a server message, reconciling optimistic placeholders. */
export function upsertMessage(list: UIMessage[], m: MessageDTO, clientKey?: string): UIMessage[] {
  const idx = list.findIndex((x) => x.id === m.id);
  if (idx >= 0) {
    const prev = list[idx]!;
    const status = RANK[prev.status] > RANK[m.status] ? prev.status : m.status;
    const copy = list.slice();
    copy[idx] = { ...m, status };
    // Drop a leftover placeholder for the same send, if any.
    return clientKey ? copy.filter((x) => x.clientKey !== clientKey) : copy;
  }
  let t = clientKey ? list.findIndex((x) => x.clientKey === clientKey) : -1;
  if (t < 0 && m.role === 'customer') {
    t = list.findIndex((x) => x.uiStatus === 'pending' && x.type === m.type && (m.type !== 'text' || (x.text ?? '') === (m.text ?? '')));
  }
  if (t >= 0) {
    const copy = list.slice();
    copy[t] = { ...m };
    return copy;
  }
  return [...list, { ...m }];
}
