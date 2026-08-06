import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BriefcaseBusiness, Building2, Users, Activity, BarChart3, CalendarDays, Settings, X, ShieldCheck, CheckSquare, Images, Share2, ShoppingBag, Target, Globe, Camera, ClipboardList, Sparkles, Flag, HardHat, LayoutTemplate, Package, Bell, MessageSquarePlus, FileBarChart } from 'lucide-react';
import { cn } from '../../lib/utils.js';

// Navigation grouped by admin duty: running the platform, overseeing content,
// the approval workflow, results, and org-level management data.
const NAV_SECTIONS = [
  {
    title: null,
    items: [
      { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { to: '/assistant', label: 'Tago AI', icon: Sparkles },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/organizations', label: 'Organizations', icon: Building2 },
      { to: '/users', label: 'User Management', icon: Users },
      { to: '/activity', label: 'Activity Logs', icon: Activity },
    ],
  },
  {
    title: 'Content',
    items: [
      { to: '/templates', label: 'Templates', icon: LayoutTemplate },
      { to: '/assets', label: 'Assets', icon: Package },
      { to: '/brand-library', label: 'Brand Library', icon: Images },
      { to: '/events', label: 'Events', icon: Camera },
      { to: '/signage', label: 'Signage', icon: Flag },
    ],
  },
  {
    title: 'Workflow',
    items: [
      { to: '/approvals', label: 'Approvals', icon: CheckSquare },
      { to: '/assigned-work', label: 'Assigned Work', icon: BriefcaseBusiness },
      // What the colleges have asked for and still need an answer on.
      { to: '/requests', label: 'College Requests', icon: MessageSquarePlus },
      // The five-part report management asks for, for any period.
      { to: '/reports', label: 'B&M Report', icon: FileBarChart },
      { to: '/planners', label: 'Post Planners', icon: ClipboardList },
      { to: '/calendar', label: 'Posting Calendar', icon: CalendarDays },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/analytics', label: 'Social Analytics', icon: BarChart3 },
      { to: '/goals', label: 'Growth Goals', icon: Target },
    ],
  },
  {
    title: 'Management',
    items: [
      { to: '/branding-register', label: 'Branding Register', icon: HardHat },
      { to: '/social-accounts', label: 'Social Handlers', icon: Share2 },
      { to: '/websites', label: 'Websites', icon: Globe },
      { to: '/purchases', label: 'Premium Packs', icon: ShoppingBag },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/notifications', label: 'Notifications', icon: Bell },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export default function Sidebar({ open, onClose }) {
  const linkClass = ({ isActive }) => cn('sidebar-link', isActive && 'sidebar-link-active');

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden" onClick={onClose} />}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-white/5 bg-gradient-to-b from-[#0b2350] to-[#08152e] transition-transform lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Brand block — the same transparent lockup as the login page, with room to breathe */}
        <div className="relative border-b border-white/5 px-5 pb-4 pt-5">
          <button onClick={onClose} aria-label="Close menu" className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-white/10 lg:hidden"><X className="h-5 w-5" /></button>
          <img src={`${import.meta.env.BASE_URL}logo-light.png`} alt="t@g" className="h-12 w-auto" />
          <p className="mt-2 truncate text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Digital Pulse of NGI — Admin</p>
        </div>

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-4 py-4">
          {NAV_SECTIONS.map((section, si) => (
            <div key={section.title || si}>
              {section.title && (
                <p className={cn('px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500', si > 0 && 'pt-4')}>
                  {section.title}
                </p>
              )}
              <div className="space-y-1">
                {section.items.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} onClick={onClose} className={linkClass}>
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
