// Original line icons drawn for Kani. All take currentColor.
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function S({ size = 24, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconChats = (p: P) => (
  <S {...p}>
    <path d="M4.5 18.8 5.6 15.4A7.9 7.9 0 1 1 8.7 18.3Z" />
    <path d="M9 10.2h6.2M9 13.3h4" />
  </S>
);
export const IconStore = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="7.5" width="17" height="12" rx="2.2" />
    <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 12.5h17M11 12.5v1.6h2v-1.6" />
  </S>
);
export const IconChart = (p: P) => (
  <S {...p}>
    <path d="M4 20h16" />
    <rect x="5.5" y="11" width="3" height="6.5" rx="1" />
    <rect x="10.5" y="6.5" width="3" height="11" rx="1" />
    <rect x="15.5" y="13.5" width="3" height="4" rx="1" />
  </S>
);
export const IconSun = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4" />
  </S>
);
export const IconMoon = (p: P) => (
  <S {...p}>
    <path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1Z" />
  </S>
);
export const IconAuto = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
  </S>
);
export const IconNewChat = (p: P) => (
  <S {...p}>
    <path d="M12.5 4.5H7a2.5 2.5 0 0 0-2.5 2.5v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-5.5" />
    <path d="M17.6 3.9a1.6 1.6 0 0 1 2.3 2.3l-7.3 7.3-3.1.8.8-3.1Z" />
  </S>
);
export const IconKebab = (p: P) => (
  <S {...p} fill="currentColor" stroke="none">
    <circle cx="12" cy="5.5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="18.5" r="1.8" />
  </S>
);
export const IconSearch = (p: P) => (
  <S {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m15.6 15.6 4.6 4.6" />
  </S>
);
export const IconSmile = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M8.3 14.2c.9 1.5 2.2 2.3 3.7 2.3s2.8-.8 3.7-2.3" />
    <circle cx="9" cy="9.8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="9.8" r="1.1" fill="currentColor" stroke="none" />
  </S>
);
export const IconPlus = (p: P) => (
  <S {...p} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </S>
);
export const IconMic = (p: P) => (
  <S {...p}>
    <rect x="9" y="3.2" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
    <path d="M6 11.2a6 6 0 0 0 12 0M12 17.2v3.4" />
  </S>
);
export const IconSend = (p: P) => (
  <S {...p} strokeWidth={0} fill="currentColor">
    <path d="M4.2 4.6c-.5-.3-1.1.2-.9.8l2.2 5.8c.1.3.4.5.7.5l7.2.3-7.2.3c-.3 0-.6.2-.7.5l-2.2 5.8c-.2.6.4 1.1.9.8l15.6-7.5c.5-.3.5-1 0-1.3Z" />
  </S>
);
export const IconTrash = (p: P) => (
  <S {...p}>
    <path d="M5 7h14M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M7 7l.8 11.3c.1 1 .9 1.7 1.9 1.7h4.6c1 0 1.8-.7 1.9-1.7L17 7" />
  </S>
);
export const IconPlay = (p: P) => (
  <S {...p} stroke="none" fill="currentColor">
    <path d="M8 5.3v13.4c0 .8.9 1.3 1.6.8l10-6.7a1 1 0 0 0 0-1.6l-10-6.7C8.9 4 8 4.5 8 5.3Z" />
  </S>
);
export const IconPause = (p: P) => (
  <S {...p} stroke="none" fill="currentColor">
    <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
  </S>
);
export const IconCamera = (p: P) => (
  <S {...p}>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" />
    <circle cx="12" cy="12.8" r="3.3" />
  </S>
);
export const IconPhoto = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="9.5" r="1.7" />
    <path d="m4 17 5-4.8 3.4 3.1 2.6-2.3 5 4.3" />
  </S>
);
export const IconHeadphones = (p: P) => (
  <S {...p}>
    <path d="M4.5 16v-3.5a7.5 7.5 0 0 1 15 0V16" />
    <rect x="3.5" y="13.5" width="4" height="6.5" rx="1.6" />
    <rect x="16.5" y="13.5" width="4" height="6.5" rx="1.6" />
  </S>
);
export const IconClose = (p: P) => (
  <S {...p} strokeWidth={2}>
    <path d="M6 6l12 12M18 6 6 18" />
  </S>
);
export const IconBack = (p: P) => (
  <S {...p} strokeWidth={2}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </S>
);
export const IconChevronDown = (p: P) => (
  <S {...p} strokeWidth={2}>
    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
  </S>
);
export const IconInfo = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.2M12 7.6v.1" strokeWidth={2.2} />
  </S>
);
export const IconShield = (p: P) => (
  <S {...p}>
    <path d="M12 3.5 5 6.2v5.3c0 4.4 3 7.7 7 9 4-1.3 7-4.6 7-9V6.2Z" />
    <path d="m9 12 2.2 2.2L15.3 10" />
  </S>
);
export const IconBot = (p: P) => (
  <S {...p}>
    <rect x="4.5" y="8" width="15" height="11" rx="3" />
    <path d="M12 8V4.8M9 13h.01M15 13h.01M9.5 16.2h5" strokeWidth={2.2} />
    <circle cx="12" cy="4.2" r="1" fill="currentColor" />
  </S>
);
export const IconUser = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6" />
  </S>
);
export const IconSidebar = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M14.5 4.5v15" />
  </S>
);
export const IconExternal = (p: P) => (
  <S {...p}>
    <path d="M13.5 4.5h6v6M19.5 4.5l-8 8M17.5 14v4a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4" />
  </S>
);
export const IconClockSmall = (p: P) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" />
    <path d="M8 4.9V8l2 1.3" />
  </svg>
);
export const IconAlert = (p: P) => (
  <S {...p}>
    <path d="M12 4 2.8 19.5h18.4Z" />
    <path d="M12 10v4.2M12 16.9v.1" strokeWidth={2.2} />
  </S>
);
export const IconLock = (p: P) => (
  <S {...p}>
    <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </S>
);

/** Message status ticks (16x11). */
export function Ticks({ status }: { status: 'sent' | 'delivered' | 'read' | 'pending' | 'failed' }) {
  if (status === 'pending') {
    return (
      <span className="ticks ticks-pending" aria-label="Enviando">
        <IconClockSmall size={15} />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="ticks ticks-failed" aria-label="Falha no envio">
        <IconAlert size={15} />
      </span>
    );
  }
  return (
    <span className={`ticks ticks-${status}`} aria-label={status === 'sent' ? 'Enviada' : status === 'delivered' ? 'Entregue' : 'Lida'}>
      <svg width="16" height="11" viewBox="0 0 16 11" fill="none" stroke="currentColor" strokeWidth={1.45} strokeLinecap="round" strokeLinejoin="round">
        {status === 'sent' ? (
          <path d="M3.2 5.9 6 8.7l6.3-7.2" />
        ) : (
          <>
            <path d="M1 6.1l2.9 2.8 6.4-7.4" />
            <path d="M7.4 8.2l.8.7 6.4-7.4" />
          </>
        )}
      </svg>
    </span>
  );
}
