import { useEffect, useState } from 'react';
import { config } from './config';
import { Layout } from './components/Layout';
import { GamesCatalog } from './components/GamesCatalog';
import { DocsPage } from './pages/DocsPage';
import { HomePage } from './pages/HomePage';
import type { Page } from './types/navigation';

const baseUrl = import.meta.env.BASE_URL || '/';
const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
const rootPath = normalizedBase === '' ? '/' : `${normalizedBase}/`;

const resolvePageFromLocation = (): Page => {
  if (typeof window === 'undefined') return 'home';

  const hash = window.location.hash.replace('#', '');
  if (hash === 'docs' || hash === 'games') return hash as Page;

  const path = window.location.pathname;
  const relative = normalizedBase && path.startsWith(normalizedBase)
    ? path.slice(normalizedBase.length)
    : path;
  const segment = relative.replace(/^\/+/, '').split('/')[0];

  if (segment === 'docs') return 'docs';
  if (segment === 'games') return 'games';
  return 'home';
};

const buildPath = (page: Page) => {
  if (page === 'home') return rootPath;
  return `${normalizedBase}/${page}`;
};

function App() {
  const [page, setPage] = useState<Page>(() => resolvePageFromLocation());
  const hasAnyContracts = Object.keys(config.contractIds).length > 0;

  const navigate = (next: Page) => {
    const target = buildPath(next);
    if (typeof window !== 'undefined' && window.location.pathname !== target) {
      window.history.pushState(null, '', target);
    }
    setPage(next);
  };

  useEffect(() => {
    const handleRouteChange = () => {
      setPage(resolvePageFromLocation());
    };

    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      window.removeEventListener('hashchange', handleRouteChange);
    };
  }, []);

  return (
    <Layout currentPage={page} onNavigate={navigate}>
      {!hasAnyContracts && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <h3>Setup Required</h3>
          <p style={{ color: 'var(--color-ink-muted)', marginTop: '1rem' }}>
            Contract IDs not configured. Please run <code>bun run setup</code> from the repo root
            to deploy contracts and configure the studio frontend.
          </p>
        </div>
      )}

      {page === 'docs' && <DocsPage />}
      {page === 'games' && <GamesCatalog onBack={() => navigate('home')} />}
      {page === 'home' && <HomePage onNavigate={navigate} />}
    </Layout>
  );
}

export default App;
