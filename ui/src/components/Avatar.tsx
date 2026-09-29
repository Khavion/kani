import type { TenantDTO } from '../api/types.ts';
import { colorFor, initials } from '../lib/format.ts';

export function TenantAvatar({ tenant, size = 49 }: { tenant: Pick<TenantDTO, 'avatarColor' | 'emoji' | 'name'>; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: tenant.avatarColor, fontSize: Math.round(size * 0.5) }} aria-hidden="true">
      <span className="avatar-emoji">{tenant.emoji}</span>
    </span>
  );
}

export function PersonAvatar({ name, size = 49 }: { name: string; size?: number }) {
  return (
    <span className="avatar avatar-person" style={{ width: size, height: size, background: colorFor(name), fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
