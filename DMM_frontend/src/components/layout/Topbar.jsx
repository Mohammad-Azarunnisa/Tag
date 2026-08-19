import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Bell, Sun, Moon, LogOut, Camera } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authStore.js';
import { useThemeStore } from '../../store/themeStore.js';
import { notificationApi } from '../../api/endpoints.js';
import { Avatar } from '../ui/primitives.jsx';
import { roleLabel } from '../../lib/utils.js';
import TagoWidget from '../TagoWidget.jsx';

export default function Topbar({ onMenu }) {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { theme, toggle } = useThemeStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // This header sets `backdrop-blur`, and backdrop-filter makes an element the
  // containing block for its fixed-position descendants. So the click-catcher
  // that used to sit here as `fixed inset-0` was clipped to the 64px header
  // strip instead of covering the viewport, and clicks anywhere in the page
  // below never reached it — the account menu just stayed open. Listening on
  // the document sidesteps the containing block entirely, and (unlike an
  // overlay) it lets the click through, so hitting another toolbar button both
  // closes this menu and does what the button says.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationApi.list({ unread: 'true' }),
    refetchInterval: 30_000,
  });
  const unread = data?.unreadCount || 0;

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 px-4 backdrop-blur-xl lg:px-6">
      <button onClick={onMenu} aria-label="Open navigation menu" className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden">
        <Menu className="h-5 w-5" />
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        {/* Tago — assistant pill + its chat panel (PAM-AI-style) */}
        <TagoWidget />

        <button onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} className="rounded-xl p-2.5 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800" title="Toggle theme">
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <button onClick={() => navigate('/notifications')} aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} className="relative rounded-xl p-2.5 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        <div className="relative ml-1" ref={menuRef}>
          <button onClick={() => setMenuOpen((v) => !v)} aria-label="Account menu" aria-haspopup="menu" aria-expanded={menuOpen} className="flex items-center gap-2 rounded-xl p-1 pr-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
            <Avatar src={user?.avatar} name={user?.name} size="md" className="h-9 w-9" />
            <div className="hidden text-left sm:block">
              <p className="text-xs font-semibold leading-tight text-slate-700 dark:text-slate-200">{user?.name}</p>
              <p className="text-[11px] text-slate-400">{roleLabel(user)}</p>
            </div>
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 z-30 mt-2 w-48 origin-top-right animate-fade-in rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-card">
              {/* Straight to where the profile picture is set */}
              <button onClick={() => { setMenuOpen(false); navigate('/profile'); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
                <Camera className="h-4 w-4" /> {user?.avatar ? 'Change photo' : 'Add profile photo'}
              </button>
              <button onClick={() => { setMenuOpen(false); navigate('/settings'); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
                Settings
              </button>
              <button onClick={() => { logout(); navigate('/login'); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-600 transition-colors hover:bg-rose-50 dark:hover:bg-rose-500/10">
                <LogOut className="h-4 w-4" /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
