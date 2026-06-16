import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import TinManIcon from './TinManIcon.jsx';
import {
  ChatIcon, ProgressIcon, SavesIcon, PricingIcon,
  LibraryIcon, WinsIcon, SettingsIcon, RefreshIcon, LogoutIcon,
} from './Icons.jsx';
import { YBR_STEPS } from '../lib/ybrSteps.js';
import './Sidebar.css';

function NavItem({ to, icon: Icon, label, badge }) {
  return (
    <NavLink to={to} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
      <Icon className="nav-icon" />
      <span className="nav-label">{label}</span>
      {badge > 0 && <span className="nav-badge">{badge}</span>}
    </NavLink>
  );
}

export default function Sidebar({
  user,
  projects = [],
  activeProjectId = null,
  activeProjectCount = 0,
  onSelectProject,
  savesCount = 0,
  onStartFresh,
  onSignOut,
}) {
  const name = user?.name || 'Guest';
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'G';

  const progressTotal = YBR_STEPS.length;
  const progressPct = progressTotal ? Math.round((activeProjectCount / progressTotal) * 100) : 0;

  // The selected project is driven by the active id, never by list order.
  const selected = projects.find((p) => p.id === activeProjectId) || null;

  const [projectsExpanded, setProjectsExpanded] = useState(true);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <TinManIcon size={36} className="brand-icon" />
        <div className="brand-text">
          <span className="brand-title">Tin Man Metal Works</span>
          <span className="brand-sub">Sales Mentor 3.0</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Main</div>
        <NavItem to="/chat" icon={ChatIcon} label="Chat" />
        <NavItem to="/pricing" icon={PricingIcon} label="Pricing" />

        <NavLink
          to="/progress"
          className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
          onClick={() => setProjectsExpanded((v) => !v)}
        >
          <ProgressIcon className="nav-icon" />
          <span className="nav-label">My Projects</span>
          {projects.length > 0 && (
            <span className={'nav-caret' + (projectsExpanded ? ' open' : '')} aria-hidden="true">▾</span>
          )}
        </NavLink>

        {selected && (
          <div className="nav-progress" title={`${selected.name}: ${activeProjectCount} of ${progressTotal} steps complete`}>
            <span className="nav-progress-name">{selected.name}</span>
            <div className="nav-progress-row">
              <div className="nav-progress-track">
                <div className="nav-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="nav-progress-count">{activeProjectCount}/{progressTotal}</span>
            </div>
          </div>
        )}

        {projectsExpanded && projects.length > 0 && (
          <ul className="nav-projects">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={'nav-project' + (p.id === activeProjectId ? ' active' : '')}
                  onClick={() => onSelectProject?.(p)}
                  title={p.name}
                >
                  <span className="nav-project-dot" />
                  <span className="nav-project-name">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <NavItem to="/saves" icon={SavesIcon} label="My Saves" badge={savesCount} />

        <div className="nav-section-label">Resources</div>
        <NavItem to="/niche-library" icon={LibraryIcon} label="Niche Library" />
        <NavItem to="/win-wall" icon={WinsIcon} label="Win Wall" />
        <NavItem to="/settings" icon={SettingsIcon} label="Settings" />
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="start-fresh-btn" onClick={onStartFresh}>
          <RefreshIcon className="nav-icon" />
          <span>Start Fresh</span>
        </button>

        <div className="user-card">
          <div className="user-avatar">{initials}</div>
          <div className="user-meta">
            <span className="user-name">{name}</span>
            <span className="user-status"><span className="status-dot" /> Active</span>
          </div>
          <button type="button" className="signout-btn" onClick={onSignOut} title="Sign out" aria-label="Sign out">
            <LogoutIcon className="nav-icon" />
          </button>
        </div>
      </div>
    </aside>
  );
}
