import { useCallback, useEffect, useState } from 'react';
import { api, isMock } from './api/client.ts';
import type { TenantDTO } from './api/types.ts';
import { NavRail, type Tab } from './components/NavRail.tsx';
import { KaniLogo } from './components/KaniLogo.tsx';
import { CustomerView, useCustomerStore } from './customer/CustomerView.tsx';
import { OwnerView } from './owner/OwnerView.tsx';
import { useTheme } from './lib/theme.ts';
import { loadCustomer, loadTenantId, saveCustomer, saveTenantId, type CustomerIdentity } from './lib/storage.ts';
import { navigate } from './lib/nav.ts';
import { setServerNow } from './lib/clock.ts';

const NO_TENANTS: TenantDTO[] = [];

export function App() {
  const theme = useTheme();
  const [tenants, setTenants] = useState<TenantDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(loadTenantId);
  const [tab, setTab] = useState<Tab>('customer');
  const [customer, setCustomer] = useState<CustomerIdentity>(loadCustomer);
  const store = useCustomerStore(tenants ?? NO_TENANTS, tenantId, customer, tab === 'customer');
  const unread = store.totalUnread;

  const loadTenants = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await api.tenants();
      setTenants(list);
      setTenantId((cur) => (cur && list.some((t) => t.id === cur) ? cur : (list[0]?.id ?? null)));
    } catch (err) {
      setLoadError(String(err));
    }
  }, []);

  useEffect(() => {
    void loadTenants();
    api.health().then(
      (h) => setServerNow(h.now),
      () => undefined,
    );
    return api.subscribe((e) => {
      if (e.type === 'clock') setServerNow(e.now);
    });
  }, [loadTenants]);

  useEffect(() => {
    if (tenantId) saveTenantId(tenantId);
  }, [tenantId]);

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Kani` : 'Kani';
  }, [unread]);

  const selectTab = (t: Tab) => setTab(t);

  const onCustomerChange = (c: CustomerIdentity) => {
    saveCustomer(c);
    setCustomer(c);
  };

  return (
    <div className="app">
      <NavRail tab={tab} onTab={selectTab} onAdmin={() => navigate('/admin')} theme={theme} unread={tab === 'customer' ? 0 : unread} />
      <div className="app-body">
        {tenants === null ? (
          <div className="splash">
            <KaniLogo size={72} />
            <div className="splash-title">Kani</div>
            {loadError ? (
              <>
                <p className="splash-error">Não foi possível conectar ao servidor Kani.</p>
                <button type="button" className="btn-primary" onClick={() => void loadTenants()}>
                  Tentar novamente
                </button>
                {!isMock ? (
                  <p className="splash-hint">
                    Dica: abra com <code>?mock=1</code> para usar dados de demonstração.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="splash-bar">
                <span />
              </div>
            )}
          </div>
        ) : (
          <div className="tab-pane">
            {tab === 'customer' ? (
              <CustomerView
                store={store}
                tenants={tenants}
                tenantId={tenantId}
                onSelectTenant={setTenantId}
                customer={customer}
                onCustomerChange={onCustomerChange}
              />
            ) : (
              <OwnerView tenants={tenants} tenantId={tenantId} onSelectTenant={setTenantId} active />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
