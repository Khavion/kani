import type { ReactNode } from 'react';
import { IconAuto, IconChart, IconChats, IconMoon, IconStore, IconSun } from './Icons.tsx';
import { KaniLogo } from './KaniLogo.tsx';
import type { ThemeMode } from '../lib/theme.ts';

export type Tab = 'customer' | 'owner';

function RailButton(props: { label: string; active?: boolean; onClick: () => void; testId: string; children: ReactNode; badge?: number }) {
  return (
    <button
      type="button"
      className={`rail-btn${props.active ? ' active' : ''}`}
      onClick={props.onClick}
      data-testid={props.testId}
      aria-label={props.label}
      aria-pressed={props.active}
      data-tip={props.label}
    >
      {props.children}
      {props.badge ? <span className="rail-badge">{props.badge > 99 ? '99+' : props.badge}</span> : null}
    </button>
  );
}

export function ThemeToggleButton({ mode, cycle, className }: { mode: ThemeMode; cycle: () => void; className?: string }) {
  const label = mode === 'auto' ? 'Theme: auto' : mode === 'light' ? 'Theme: light' : 'Theme: dark';
  return (
    <button type="button" className={className ?? 'rail-btn'} onClick={cycle} data-testid="theme-toggle" aria-label={label} data-tip={label} data-mode={mode}>
      {mode === 'auto' ? <IconAuto /> : mode === 'light' ? <IconSun /> : <IconMoon />}
    </button>
  );
}

export function NavRail(props: {
  tab: Tab;
  onTab: (t: Tab) => void;
  onAdmin: () => void;
  theme: { mode: ThemeMode; cycle: () => void };
  unread: number;
}) {
  return (
    <nav className="rail" aria-label="Kani">
      <div className="rail-top">
        <RailButton label="Cliente" testId="nav-customer" active={props.tab === 'customer'} onClick={() => props.onTab('customer')} badge={props.unread}>
          <IconChats />
        </RailButton>
        <RailButton label="Owner" testId="nav-owner" active={props.tab === 'owner'} onClick={() => props.onTab('owner')}>
          <IconStore />
        </RailButton>
        <RailButton label="Admin" testId="nav-admin" onClick={props.onAdmin}>
          <IconChart />
        </RailButton>
      </div>
      <div className="rail-bottom">
        <ThemeToggleButton mode={props.theme.mode} cycle={props.theme.cycle} />
        <div className="rail-logo" data-tip="Kani">
          <KaniLogo size={34} title="Kani" />
        </div>
      </div>
    </nav>
  );
}
