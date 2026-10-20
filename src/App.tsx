import { createContext, useContext, useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import type { CraftContext } from './engine/context';
import { formatDate, useT } from './i18n';
import { useCraftContext, useDataset } from './store/dataset';
import { updateSettings, useStore } from './store/store';
import { loadPublishedPrices } from './store/publishedPrices';
import type { Dataset } from './data/types';
import { ConfirmProvider } from './components/confirm';
import { BuilderPage } from './pages/BuilderPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ImportPage } from './pages/ImportPage';
import { ProjectPage } from './pages/ProjectPage';
import { CalculatorPage } from './pages/CalculatorPage';
import { SimulatorPage } from './pages/SimulatorPage';
import { ComparatorPage } from './pages/ComparatorPage';
import { ModsPage } from './pages/ModsPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';

const Ctx = createContext<CraftContext | null>(null);

export function useCtx(): CraftContext {
  const c = useContext(Ctx);
  if (!c) throw new Error('CraftContext ausente');
  return c;
}

const NAV = [
  { to: '/', key: 'nav.builder', icon: '⚒' },
  { to: '/import', key: 'nav.import', icon: '📷' },
  { to: '/projects', key: 'nav.projects', icon: '📜' },
  { to: '/calculator', key: 'nav.calculator', icon: '∑' },
  { to: '/simulator', key: 'nav.simulator', icon: '🎲' },
  { to: '/comparator', key: 'nav.comparator', icon: '⚖' },
  { to: '/mods', key: 'nav.mods', icon: '📖' },
  { to: '/history', key: 'nav.history', icon: '⌛' },
  { to: '/settings', key: 'nav.settings', icon: '⚙' },
];

function Shell({ data }: { data: Dataset }) {
  const ctx = useCraftContext(data);
  const { t, lang } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();
  const league = useStore((s) => s.settings.league);
  useEffect(() => {
    loadPublishedPrices();
  }, [league]);
  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <header className="topbar">
          <button className="ghost menu-btn" aria-label="menu" onClick={() => setMenuOpen(!menuOpen)}>
            ☰
          </button>
          <div className="brand">
            <span className="brand-mark">◆</span>
            <div>
              <div className="brand-title">{t('app.title')}</div>
              <div className="brand-sub">{t('app.subtitle')}</div>
            </div>
          </div>
          <div className="lang">
            <button className={lang === 'pt-BR' ? 'active' : 'ghost'} onClick={() => updateSettings({ lang: 'pt-BR' })}>
              PT
            </button>
            <button className={lang === 'en' ? 'active' : 'ghost'} onClick={() => updateSettings({ lang: 'en' })}>
              EN
            </button>
          </div>
        </header>
        <nav className={`sidebar ${menuOpen ? 'open' : ''}`} key={loc.pathname} onClick={() => setMenuOpen(false)}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="nav-icon" aria-hidden>
                {n.icon}
              </span>
              {t(n.key)}
            </NavLink>
          ))}
          <div className="sidebar-foot">
            {t('app.dataInfo', { version: data.meta.gameVersion, date: formatDate(data.meta.importedAt, lang) })}
            <br />
            {t('app.disclaimer')}
          </div>
        </nav>
        <main className="content">
          <Routes>
            <Route path="/" element={<BuilderPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectPage />} />
            <Route path="/calculator" element={<CalculatorPage />} />
            <Route path="/simulator" element={<SimulatorPage />} />
            <Route path="/comparator" element={<ComparatorPage />} />
            <Route path="/mods" element={<ModsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </Ctx.Provider>
  );
}

export default function App() {
  const { data, error } = useDataset();
  const { t } = useT();
  if (error) return <div className="splash error">{t('app.loadError', { error })}</div>;
  if (!data) return <div className="splash">{t('app.loading')}</div>;
  return (
    <HashRouter>
      <ConfirmProvider>
        <Shell data={data} />
      </ConfirmProvider>
    </HashRouter>
  );
}
