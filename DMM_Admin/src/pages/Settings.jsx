import { useState } from 'react';
import toast from 'react-hot-toast';
import { User, Lock, Palette, Sun, Moon, Camera } from 'lucide-react';
import { userApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import { useThemeStore } from '../store/themeStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Card, Input, Avatar } from '../components/ui/primitives.jsx';
import { Button } from '../components/ui/Button.jsx';
import { cn } from '../lib/utils.js';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'password', label: 'Password', icon: Lock },
  { id: 'appearance', label: 'Appearance', icon: Palette },
];

export default function Settings() {
  const [tab, setTab] = useState('profile');
  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage your administrator account." />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <Card className="h-fit p-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={cn('flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition',
                tab === id ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800')}>
              <Icon className="h-[18px] w-[18px]" /> {label}
            </button>
          ))}
        </Card>
        <div>
          {tab === 'profile' && <ProfileTab />}
          {tab === 'password' && <PasswordTab />}
          {tab === 'appearance' && <AppearanceTab />}
        </div>
      </div>
    </div>
  );
}

function ProfileTab() {
  const { user, setUser } = useAuthStore();
  const [form, setForm] = useState({ name: user?.name || '', jobTitle: user?.jobTitle || '' });
  const [avatar, setAvatar] = useState(null);
  const [preview, setPreview] = useState(user?.avatar || '');
  const [loading, setLoading] = useState(false);

  const onAvatar = (e) => { const f = e.target.files?.[0]; if (f) { setAvatar(f); setPreview(URL.createObjectURL(f)); } };

  const save = async () => {
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('name', form.name); fd.append('jobTitle', form.jobTitle);
      if (avatar) fd.append('avatar', avatar);
      const res = await userApi.updateProfile(fd);
      setUser(res.user); toast.success('Profile updated');
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  return (
    <Card className="p-6">
      <h3 className="mb-5 font-bold text-slate-800 dark:text-white">Profile Information</h3>
      <div className="mb-6 flex items-center gap-4">
        <div className="relative">
          <Avatar src={preview} name={form.name} size="lg" />
          <label className="absolute -bottom-1 -right-1 cursor-pointer rounded-full bg-brand-600 p-1.5 text-white hover:bg-brand-700">
            <Camera className="h-3.5 w-3.5" />
            <input type="file" accept="image/*" className="hidden" onChange={onAvatar} />
          </label>
        </div>
        <div><p className="font-semibold text-slate-700 dark:text-slate-200">{user?.name}</p><p className="text-sm text-slate-400">{user?.email} · Administrator</p></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Job title" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
      </div>
      <Button className="mt-5" loading={loading} onClick={save}>Save changes</Button>
    </Card>
  );
}

function PasswordTab() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (form.newPassword !== form.confirm) { toast.error('Passwords do not match'); return; }
    if (form.newPassword.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await userApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Password updated'); setForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setLoading(false); }
  };

  return (
    <Card className="p-6">
      <h3 className="mb-5 font-bold text-slate-800 dark:text-white">Change Password</h3>
      <div className="max-w-md space-y-4">
        <Input label="Current password" type="password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        <Input label="New password" type="password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        <Input label="Confirm new password" type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        <Button loading={loading} onClick={save}>Update password</Button>
      </div>
    </Card>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useThemeStore();
  return (
    <Card className="p-6">
      <h3 className="mb-5 font-bold text-slate-800 dark:text-white">Appearance</h3>
      <div className="grid max-w-md grid-cols-2 gap-4">
        {[{ id: 'light', label: 'Light', icon: Sun }, { id: 'dark', label: 'Dark', icon: Moon }].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTheme(id)}
            className={cn('flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition',
              theme === id ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-slate-200 dark:border-slate-700 hover:border-brand-300')}>
            <Icon className={cn('h-8 w-8', theme === id ? 'text-brand-600' : 'text-slate-400')} />
            <span className={cn('font-medium', theme === id ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500')}>{label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
