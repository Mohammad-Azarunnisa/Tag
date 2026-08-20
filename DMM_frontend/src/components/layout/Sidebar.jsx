import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, FileImage, Images, CheckSquare, BarChart3, CalendarDays,
  FileText, Bell, Settings, X, TrendingUp, Palette, Share2, ShoppingBag, Camera, ClipboardList, Sparkles, Flag, CircleUser, BriefcaseBusiness,
  UsersRound, MessageSquarePlus, Send,
} from 'lucide-react';
import { cn, roleLabel } from '../../lib/utils.js';
import { useAuthStore } from '../../store/authStore.js';

// Navigation grouped by what people are doing: making content, moving it
// through the workflow, reading results, managing the org, and their account.
const NAV_SECTIONS = [
  {
    title: null,
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/assistant', label: 'Tago AI', icon: Sparkles },
    ],
  },
  {
    title: 'Content',
    items: [
      { to: '/templates', label: 'Templates', icon: FileImage },
      { to: '/assets', label: 'Assets', icon: Images },
      { to: '/brand-library', label: 'Brand Library', icon: Palette },
      { to: '/events', label: 'Events', icon: Camera },
      { to: '/signage', label: 'Signage', icon: Flag },
    ],
  },
  {
    title: 'Workflow',
    items: [
      { to: '/approvals', label: 'Approvals', icon: CheckSquare },
      // The design → post pipeline a college request travels through. Designers
      // and handlers each see their own board; a coordinator sees their own asks
      // coming back to them for review; admins monitor both.
      { to: '/workflow/designs', label: 'Designs to be Done', icon: Palette, roles: ['CEO'], userTypes: ['DESIGNER', 'COORDINATOR'] },
      { to: '/workflow/to-be-posted', label: 'To Be Posted', icon: Send, roles: ['CEO'], userTypes: ['SOCIAL_HANDLER', 'COORDINATOR'] },
      { to: '/my-assigned-work', label: 'My Assigned Work', icon: BriefcaseBusiness },
      // Handing work out and signing it off belongs to the Admin, across the
      // institutions they hold. A coordinator raises a request instead and the
      // Admin allocates it; a designer or handler only has their own list.
      { to: '/team-work', label: 'Team Work', icon: UsersRound, roles: ['CEO'] },
      // What the college has asked for. It goes straight to Designs to be Done,
      // so this is no longer a request "to the admin".
      { to: '/requests', label: 'Raise a Request', icon: MessageSquarePlus, userTypes: ['COORDINATOR'] },
      { to: '/planner', label: 'Post Planner', icon: ClipboardList },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays },
      // Who you work with and how to reach them. Everyone gets this; the server
      // decides whose details each role may see.
      { to: '/people', label: 'People', icon: UsersRound },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/social-analytics', label: 'Social Analytics', icon: TrendingUp },
      { to: '/approval-analytics', label: 'Approval Analytics', icon: BarChart3 },
      { to: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    // Management info — only useful to the org head (CEO), hidden from regular users.
    title: 'Management',
    items: [
      { to: '/social-handlers', label: 'Social Handlers', icon: Share2, roles: ['CEO'] },
      { to: '/premium-packs', label: 'Premium Packs', icon: ShoppingBag, roles: ['CEO'] },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/notifications', label: 'Notifications', icon: Bell },
      { to: '/profile', label: 'My Profile', icon: CircleUser },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

// What a coordinator actually has: their college's content and numbers, and the
// requests they raise. The backend enforces the college boundary
// (middleware/auth.js); this keeps the UI honest about the rest.
// The Workflow boards are here so they can find what came back from their own
// requests and confirm it or ask for changes. The approvals pages are not theirs.
// Team Work is absent by design: a coordinator does not assign work to anyone
// directly — they raise a request and the Admin allocates it.
const COORDINATOR_PATHS = [
  '/dashboard', '/notifications', '/profile', '/settings',
  '/templates', '/assets', '/brand-library', '/events', '/signage',
  '/social-analytics', '/calendar', '/planner', '/requests',
  '/people', '/workflow/designs', '/workflow/to-be-posted',
];

export default function Sidebar({ open, onClose }) {
  const { user } = useAuthStore();
  const org = user?.organization;
  const isCoordinator = user?.role === 'USER' && user?.userType === 'COORDINATOR';

  const linkClass = ({ isActive }) => cn('sidebar-link', isActive && 'sidebar-link-active');

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden" onClick={onClose} />}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-white/5 bg-gradient-to-b from-[#0b2350] to-[#08152e] transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand block — the same transparent lockup as the login page, with room to breathe */}
        <div className="relative border-b border-white/5 px-5 pb-4 pt-5">
          <button onClick={onClose} aria-label="Close menu" className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-white/10 lg:hidden">
            <X className="h-5 w-5" />
          </button>
          {org?.logo ? (
            // The college's own logo keeps a white chip (arbitrary images need it on navy)
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm">
                <img src={org.logo} alt={org.name} className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-extrabold leading-tight text-white">{org.name}</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Digital Pulse of NGI</p>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <img src="/logo-light.png" alt="t@g" className="h-12 w-auto" />
              {org?.name && <p className="mt-2.5 truncate text-sm font-bold leading-tight text-white">{org.name}</p>}
              <p className={org?.name ? 'mt-0.5 truncate text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400' : 'mt-2 truncate text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400'}>
                Digital Pulse of NGI
              </p>
            </div>
          )}
        </div>

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-4 py-4">
          {NAV_SECTIONS.map((section, si) => {
            const items = section.items
              // An item may be opened to a role, or to a particular user type
              // within the USER role (a coordinator is not a plain user).
              .filter((i) => (!i.roles && !i.userTypes)
                || (i.roles || []).includes(user?.role)
                || (i.userTypes || []).includes(user?.userType))
              .filter((i) => !isCoordinator || COORDINATOR_PATHS.includes(i.to));
            if (!items.length) return null;
            return (
              <div key={section.title || si}>
                {section.title && (
                  <p className={cn('px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500', si > 0 && 'pt-4')}>
                    {section.title}
                  </p>
                )}
                <div className="space-y-1">
                  {items.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to} onClick={onClose} className={linkClass}>
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-2.5 rounded-xl bg-white/5 p-3">
            {user?.avatar ? (
              <img src={user.avatar} alt={user?.name || ''}
                className="h-8 w-8 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/20 text-xs font-bold text-brand-300">
                {user?.name?.[0]}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">{user?.name}</p>
              <p className="text-[11px] text-slate-400">{roleLabel(user)}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
