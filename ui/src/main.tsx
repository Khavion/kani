import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { AdminPage } from './admin/AdminPage.tsx';
import './styles/base.css';
import './styles/customer.css';
import './styles/owner.css';
import './styles/admin.css';

function isAdminPath(p: string): boolean {
  return p.replace(/\/+$/, '') === '/admin';
}

function Root() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return isAdminPath(path) ? <AdminPage /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
