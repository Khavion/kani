export interface CustomerIdentity {
  phone: string;
  name: string;
}

const KEY_CUSTOMER = 'kani.customer';
const KEY_TENANT = 'kani.tenant';
const KEY_SEEN = 'kani.seen';
export const KEY_THEME = 'kani.theme';

export function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function randomDigits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

export function loadCustomer(): CustomerIdentity {
  const raw = readLS(KEY_CUSTOMER);
  if (raw) {
    try {
      const v = JSON.parse(raw) as Partial<CustomerIdentity>;
      if (v && typeof v.phone === 'string' && typeof v.name === 'string' && v.phone) {
        return { phone: v.phone, name: v.name || 'Cliente Demo' };
      }
    } catch {
      /* fall through */
    }
  }
  const fresh = { phone: '+55 11 9' + randomDigits(8), name: 'Cliente Demo' };
  saveCustomer(fresh);
  return fresh;
}

export function saveCustomer(c: CustomerIdentity): void {
  writeLS(KEY_CUSTOMER, JSON.stringify(c));
}

export function loadTenantId(): string | null {
  return readLS(KEY_TENANT);
}

export function saveTenantId(id: string): void {
  writeLS(KEY_TENANT, id);
}

export function loadSeen(): Record<string, number> {
  try {
    const v = JSON.parse(readLS(KEY_SEEN) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function saveSeen(seen: Record<string, number>): void {
  writeLS(KEY_SEEN, JSON.stringify(seen));
}
