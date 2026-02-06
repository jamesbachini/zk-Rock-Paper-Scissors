import { Resources } from '../components/Resources';
import '../App.css';

export function DocsPage() {
  return (
    <>
      <section className="docs-hero">
        <div className="hero-content">
          <div className="hero-actions">
            <a
              className="button primary"
              href="https://github.com/jamesbachini/Stellar-Game-Studio"
              target="_blank"
              rel="noreferrer"
            >
              Fork the repo
            </a>
            <a className="button ghost" href="#quickstart">
              Read the quickstart
            </a>
          </div>
          <div className="hero-tags">
            <span>Templates & Examples</span>
            <span>ECOSYSTEM COMPATIBLE</span>
            <span>ZK READY</span>
          </div>
        </div>
      </section>

      <Resources />
    </>
  );
}
