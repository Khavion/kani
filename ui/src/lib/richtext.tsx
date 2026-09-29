import type { ReactNode } from 'react';

const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+)/g;
const TRAILING = /[.,;:!?)\]}'"]+$/;

function formatInline(text: string, keyBase: string): ReactNode[] {
  // Chat style emphasis: *bold* and _italic_.
  const out: ReactNode[] = [];
  const re = /\*([^*\n]+)\*|_([^_\n]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${keyBase}b${i++}`}>{m[1]}</strong>);
    else out.push(<em key={`${keyBase}i${i++}`}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Renders message text with clickable links and simple emphasis. Line breaks are kept via CSS pre-wrap. */
export function RichText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let idx = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trail = TRAILING.exec(url)?.[0] ?? '';
    if (trail) url = url.slice(0, url.length - trail.length);
    if (start > last) nodes.push(...formatInline(text.slice(last, start), `t${idx}`));
    const href = url.startsWith('http') ? url : `https://${url}`;
    nodes.push(
      <a key={`u${idx}`} href={href} target="_blank" rel="noopener noreferrer" className="msg-link" onClick={(e) => e.stopPropagation()}>
        {url}
      </a>,
    );
    last = start + url.length;
    idx++;
  }
  if (last < text.length) nodes.push(...formatInline(text.slice(last), `e${idx}`));
  return <>{nodes}</>;
}
