import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  Database,
  FileCheck2,
  LayoutDashboard,
  Mail,
  Radio,
  RefreshCw,
  Send,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { getDashboardStats, hasLocalServer, type DashboardStats } from './lib/database';
import FundingFeed from './FundingFeed';
import UpdateNotice from './UpdateNotice';
import Contacts from './Contacts';
import Outreach from './Outreach';
import FollowUps from './FollowUps';

/** Sections with a real page; the rest still show the scaffold placeholder. */
const pages: Record<string, ComponentType> = { '/contacts': Contacts, '/outreach': Outreach, '/follow-ups': FollowUps };

const sections: { path: string; label: string; icon: LucideIcon; group: string; description: string; next: string }[] =
  [
    {
      path: '/',
      label: 'Dashboard',
      icon: LayoutDashboard,
      group: 'WORKSPACE',
      description: 'A clear view of your next opportunity.',
      next: '',
    },
    {
      path: '/companies',
      label: 'Companies',
      icon: Building2,
      group: 'DISCOVER',
      description: 'Build a focused list of companies worth reaching out to.',
      next: 'Add company profiles, product notes, and hiring signals.',
    },
    {
      path: '/contacts',
      label: 'Contacts',
      icon: Users,
      group: 'DISCOVER',
      description: 'Find the people closest to the work you want to do.',
      next: 'Save founders and product leaders with verified contact sources.',
    },
    {
      path: '/outreach',
      label: 'Outreach CRM',
      icon: Send,
      group: 'CONNECT',
      description: 'Keep every conversation and next step in one place.',
      next: 'Track opportunities from research to outreach, conversations, and offers.',
    },
    {
      path: '/email',
      label: 'Cold Email Generator',
      icon: Sparkles,
      group: 'CONNECT',
      description: 'Turn company research into a thoughtful introduction.',
      next: 'Draft short, personalized emails grounded in company and candidate context.',
    },
    {
      path: '/matching',
      label: 'Resume / Project matching',
      icon: FileCheck2,
      group: 'CONNECT',
      description: 'Connect your strongest work to each opportunity.',
      next: 'Match resumes and portfolio projects to roles, with a reason for each match.',
    },
    {
      path: '/follow-ups',
      label: 'Follow-up tracker',
      icon: Bell,
      group: 'CONNECT',
      description: 'Make the next touchpoint a deliberate one.',
      next: 'Schedule follow-ups and track completed or dismissed reminders.',
    },
  ];

function Sidebar() {
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label="Signal home">
        <span className="brand-icon">
          <Activity size={23} />
        </span>
        <span>
          signal<span className="brand-period">.</span>
        </span>
      </NavLink>
      <div className="workspace-switch">
        <span className="workspace-avatar">
          <BriefcaseBusiness size={17} />
        </span>
        <div>
          <strong>My job search</strong>
          <small>Personal workspace</small>
        </div>
        <span className="workspace-label">V1</span>
      </div>
      <nav aria-label="Main navigation">
        {['WORKSPACE', 'DISCOVER', 'CONNECT'].map(group => (
          <div className="nav-group" key={group}>
            <p className="nav-label">{group}</p>
            {sections
              .filter(section => section.group === group)
              .map(({ path, label, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  end={path === '/'}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </NavLink>
              ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="local-note">
          <span className="status-dot" />
          <span>Local-first workspace</span>
          <Database size={14} />
        </div>
        <div className="profile">
          <span className="avatar">ME</span>
          <div>
            <strong>Your next chapter</strong>
            <small>One conversation at a time</small>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Dashboard() {
  const serverAvailable = hasLocalServer();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!serverAvailable) return;
    let current = true;
    setStats(null);
    setError(false);
    getDashboardStats()
      .then(value => {
        if (current) setStats(value);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [serverAvailable, attempt]);
  const metrics: {
    label: string;
    key: Exclude<keyof DashboardStats, 'pipeline'>;
    icon: LucideIcon;
    detail: string;
    path: string;
  }[] = [
    {
      label: 'Companies saved',
      key: 'companies',
      icon: Building2,
      detail: 'Your target company list',
      path: '/companies',
    },
    {
      label: 'Funding signals',
      key: 'funding_rounds',
      icon: Radio,
      detail: 'Rounds in your funding feed',
      path: '/companies',
    },
    {
      label: 'Active outreach',
      key: 'active_outreach',
      icon: Send,
      detail: 'Conversations in progress',
      path: '/outreach',
    },
    {
      label: 'Follow-ups due',
      key: 'due_follow_ups',
      icon: Bell,
      detail: 'Your next touchpoints',
      path: '/follow-ups',
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR SEARCH, WITH INTENTION</div>
          <h1>A little focus. A lot of possibility.</h1>
          <p>Your workspace for finding the right teams and starting better conversations.</p>
        </div>
        <span className="phase-badge">
          <span className="status-dot" />
          Companies · v0.3.5
        </span>
      </div>
      <div className={`runtime-notice ${error ? 'notice-error' : ''}`} role="status">
        <Database size={16} />
        <span>
          {error
            ? 'Could not read your local database. Your data has not been changed.'
            : serverAvailable
              ? stats
                ? 'Connected to your local SQLite database.'
                : 'Opening your local database…'
              : 'Offline layout preview · Start the local website to connect to SQLite.'}
        </span>
        {error && (
          <button onClick={() => setAttempt(value => value + 1)}>
            <RefreshCw size={14} />
            Retry
          </button>
        )}
      </div>
      <section className="metrics" aria-label="Search statistics">
        {metrics.map(({ label, key, icon: Icon, detail, path }) => (
          <NavLink to={path} className="metric-card" key={key}>
            <div className="metric-top">
              <span>{label}</span>
              <Icon size={18} />
            </div>
            <strong>{stats ? stats[key] : '—'}</strong>
            <div className="metric-foot">
              <span>{detail}</span>
              <ArrowUpRight size={15} />
            </div>
          </NavLink>
        ))}
      </section>
      <div className="dashboard-grid">
        <section className="start-card">
          <div className="section-kicker">
            <span className="small-icon">
              <Sparkles size={17} />
            </span>{' '}
            MAKE YOUR NEXT MOVE
          </div>
          <h2>
            Good opportunities start
            <br />
            with a little signal.
          </h2>
          <p>
            Discover a team building something you care about.
            <br className="wide-only" /> Find your angle. Start a conversation.
          </p>
          <NavLink to="/funding" className="primary-button">
            Find eligible companies <ArrowRight size={16} />
          </NavLink>
          <div className="target-tags">
            <span>AI & fintech</span>
            <span>Seed → Series B</span>
            <span>Product · GTM · Data</span>
          </div>
        </section>
        <section className="panel checklist">
          <div className="panel-title">
            <h2>Your workspace, taking shape</h2>
            <span className="muted-badge">FIRST STEPS</span>
          </div>
          <p className="panel-description">A focused foundation for your search.</p>
          <div className="checklist-row">
            <span className="check-circle">
              <Check size={14} />
            </span>
            <div>
              <strong>Make room for your next chapter</strong>
              <small>Funding research and company profiles are in place</small>
            </div>
          </div>
          <div className="checklist-row">
            <span className={stats ? 'check-circle' : 'step-circle'}>{stats ? <Check size={14} /> : '2'}</span>
            <div>
              <strong>Keep your research close</strong>
              <small>{stats ? 'Local SQLite database connected' : 'SQLite connects through the local website'}</small>
            </div>
          </div>
          <div className="checklist-row">
            <span className="step-circle">3</span>
            <div>
              <strong>Build your target list</strong>
              <small>Funding research and company profiles are screened in the background</small>
            </div>
          </div>
        </section>
      </div>
      <section className="panel pipeline-panel">
        <div className="panel-title">
          <div>
            <h2>A place for every conversation</h2>
            <p className="panel-description">From a first signal to a real opportunity.</p>
          </div>
          <NavLink to="/outreach" className="text-link">
            View outreach <ArrowRight size={15} />
          </NavLink>
        </div>
        <div className="pipeline">
          {(
            [
              ['research', 'Research'],
              ['ready', 'Ready to reach out'],
              ['contacted', 'Contacted'],
              ['in_conversation', 'In conversation'],
              ['interviewing', 'Interviewing'],
            ] as const
          ).map(([key, stage], index) => (
            <div className="pipeline-stage" key={key}>
              <span className={`stage-dot stage-${index}`} />
              <span>{stage}</span>
              {stats?.pipeline && <strong className="stage-count">{stats.pipeline[key] ?? 0}</strong>}
              {index < 4 && <ChevronRight size={15} />}
            </div>
          ))}
        </div>
        {!Object.values(stats?.pipeline ?? {}).some(Boolean) && (
          <div className="empty-inline">
            <Mail size={21} />
            <span>Your next conversation belongs here.</span>
            <small>Add a company to Outreach CRM to start tracking it.</small>
          </div>
        )}
      </section>
      <div className="dashboard-footer">
        <CircleHelp size={14} />
        <span>Built for thoughtful outreach. Nothing is sent automatically.</span>
        <span className="footer-right">Your data. Your device.</span>
      </div>
    </>
  );
}

function SectionPage({ section }: { section: (typeof sections)[number] }) {
  const Icon = section.icon;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{section.group}</div>
          <h1>{section.label}</h1>
          <p>{section.description}</p>
        </div>
        <span className="phase-badge">Planned for V1</span>
      </div>
      <section className="panel placeholder">
        <span className="placeholder-icon">
          <Icon size={30} />
        </span>
        <span className="eyebrow">FOUNDATION IN PLACE</span>
        <h2>A home for your {section.path === '/matching' ? 'best work' : section.label.toLowerCase()}.</h2>
        <p>{section.next}</p>
        <div className="scope-note">
          This section is scaffolded. Entry, import, and automation workflows will be built in later steps.
        </div>
        <NavLink className="text-link" to="/">
          Back to Dashboard <ArrowRight size={16} />
        </NavLink>
      </section>
    </>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar />
      <div className="main-shell">
        <header className="topbar">
          <span>
            My workspace <ChevronRight size={14} /> Job search
          </span>
          <span className="topbar-note">
            <span className="status-dot" />
            Personal & local
          </span>
        </header>
        <main id="main-content" tabIndex={-1}>
          <UpdateNotice />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/funding" element={<Navigate to="/companies" replace />} />
            <Route path="/companies" element={<FundingFeed />} />
            {sections.slice(2).map(section => {
              const Page = pages[section.path];
              return (
                <Route
                  key={section.path}
                  path={section.path}
                  element={Page ? <Page /> : <SectionPage section={section} />}
                />
              );
            })}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
