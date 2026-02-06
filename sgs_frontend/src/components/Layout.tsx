import { WalletSwitcher } from './WalletSwitcher';
import type { Page } from '../types/navigation';
import studioLogo from '../assets/logo.svg';
import './Layout.css';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  return (
    <div className="studio">
      <div className="studio-background" aria-hidden="true">
        <div className="studio-orb orb-1" />
        <div className="studio-orb orb-2" />
        <div className="studio-orb orb-3" />
        <div className="studio-grid" />
      </div>

      <header className="studio-header">
        <div className="brand">
          <div className="brand-heading">
            <img className="brand-logo" src={studioLogo} alt="Stellar Game Studio logo" />
            <div className="brand-copy">
              <div className="brand-title">Stellar Game Studio</div>
              <div className="brand-subtitle-row">
                <p className="brand-subtitle">A DEVELOPER TOOLKIT FOR BUILDING WEB3 GAMES ON STELLAR</p>
                <span className="brand-version">v0.1.2</span>
              </div>
            </div>
          </div>
          <nav className="header-nav">
            <button
              type="button"
              className={`header-link ${currentPage === 'home' ? 'active' : ''}`}
              onClick={() => onNavigate('home')}
              aria-current={currentPage === 'home' ? 'page' : undefined}
            >
              Studio
            </button>
            <button
              type="button"
              className={`header-link ${currentPage === 'games' ? 'active' : ''}`}
              onClick={() => onNavigate('games')}
              aria-current={currentPage === 'games' ? 'page' : undefined}
            >
              Games Library
            </button>
            <button
              type="button"
              className={`header-link ${currentPage === 'docs' ? 'active' : ''}`}
              onClick={() => onNavigate('docs')}
              aria-current={currentPage === 'docs' ? 'page' : undefined}
            >
              Documentation
            </button>
          </nav>
        </div>
        <div className="header-actions">
          <div className="network-pill">Testnet</div>
          <WalletSwitcher />
        </div>
      </header>

      <main className="studio-main">{children}</main>

      <footer className="studio-footer">
        <span className="footer-meta">Built with ♥️ for Stellar game developers</span>
      </footer>
    </div>
  );
}
