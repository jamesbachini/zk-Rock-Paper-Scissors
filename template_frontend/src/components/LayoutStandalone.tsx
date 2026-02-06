import { WalletStandalone } from './WalletStandalone';
import './LayoutStandalone.css';

interface LayoutStandaloneProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function LayoutStandalone({ title, subtitle, children }: LayoutStandaloneProps) {
  const resolvedTitle = title || import.meta.env.VITE_GAME_TITLE || 'Stellar Game';
  const resolvedSubtitle = subtitle || import.meta.env.VITE_GAME_TAGLINE || '';

  return (
    <div className="layout-standalone">
      <header className="layout-standalone-header">
        <div className="layout-standalone-brand">
          <div className="layout-standalone-title">{resolvedTitle}</div>
          {resolvedSubtitle ? (
            <div className="layout-standalone-subtitle">{resolvedSubtitle}</div>
          ) : null}
        </div>
        <WalletStandalone />
      </header>
      <main className="layout-standalone-body">{children}</main>
    </div>
  );
}
