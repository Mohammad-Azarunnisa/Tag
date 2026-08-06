import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Mail, Lock, ArrowRight, Sparkles, ChartColumn, Check, Clock3, Image as ImageIcon,
  Megaphone, Clapperboard, Linkedin, Instagram, Facebook, Youtube,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore.js';
import { Button } from '../components/ui/Button.jsx';
import { Input } from '../components/ui/primitives.jsx';
import { cn } from '../lib/utils.js';

// Entrance choreography — everything settles within ~3s; after that only the
// aurora and the card border keep moving (pure CSS, disabled by the global
// prefers-reduced-motion rule). MotionConfig handles reduced motion for the
// framer animations, which ignore that CSS rule.
const EASE = [0.22, 1, 0.36, 1];
const rise = (delay) => ({
  initial: { opacity: 0, y: 18, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.7, delay, ease: EASE },
});
const itemAt = (delay) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay, ease: EASE },
});

// Uppercase micro-labels above the fields (leading-4 keeps the icon offset
// deterministic: 16px label + 6px gap → icon top at 35px).
const LABEL_CLS = 'text-[11px] font-bold uppercase tracking-[0.14em] leading-4 text-slate-500 dark:text-slate-400';

const PLATFORMS = [
  { icon: Linkedin, name: 'LinkedIn' },
  { icon: Instagram, name: 'Instagram' },
  { icon: Facebook, name: 'Facebook' },
  { icon: Youtube, name: 'YouTube' },
];

const timeGreeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

// Rotating word in the headline — everything the platform manages, one word
// at a time. Frozen on the first word when the user prefers reduced motion.
const CYCLE_WORDS = ['digital marketing', 'analytics', 'approvals', 'content', 'designs'];
function CycleWord() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((v) => (v + 1) % CYCLE_WORDS.length), 2600);
    return () => clearInterval(t);
  }, [reduce]);
  return (
    <span className="block h-[1.08em] overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.span key={CYCLE_WORDS[i]}
          initial={{ y: '105%' }} animate={{ y: 0 }} exit={{ y: '-105%' }}
          transition={{ duration: 0.4, ease: EASE }}
          className="block bg-gradient-to-r from-brand-300 via-brand-400 to-brand-200 bg-clip-text text-transparent">
          {CYCLE_WORDS[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

// A bar chart that breathes like live data — transform-only, each bar on its
// own slow cycle so the motion feels organic, never mechanical.
const BAR_HEIGHTS = [46, 72, 58, 84, 64, 92, 76];
function LiveBars() {
  return (
    <div aria-hidden className="mt-4 flex h-20 items-end gap-2">
      {BAR_HEIGHTS.map((h, i) => (
        <motion.span key={i}
          className="flex-1 origin-bottom rounded-t-md bg-gradient-to-t from-brand-600/70 to-brand-300"
          style={{ height: `${h}%` }}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: [0.55, 1, 0.7, 0.92] }}
          transition={{ duration: 5.5 + i * 0.6, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut', delay: 0.6 + i * 0.12 }}
        />
      ))}
    </div>
  );
}

// The approval queue processing itself — items keep arriving and getting
// approved, on a loop. Static (first item, approved) under reduced motion.
const TICKER_ITEMS = [
  { icon: ImageIcon, title: 'Tech fest poster', meta: 'NCET · Instagram' },
  { icon: Clapperboard, title: 'Campus tour reel', meta: 'NDC · YouTube' },
  { icon: Megaphone, title: 'Admission banner', meta: 'NSAM · Facebook' },
];
function ApprovalTicker({ items }) {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [approved, setApproved] = useState(reduce);
  useEffect(() => {
    if (reduce) { setApproved(true); return; }
    setApproved(false);
    const t1 = setTimeout(() => setApproved(true), 2100);
    const t2 = setTimeout(() => setIdx((i) => (i + 1) % items.length), 4400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [idx, reduce, items.length]);
  const { icon: Icon, title, meta } = items[idx];
  return (
    <AnimatePresence mode="wait">
      <motion.div key={idx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.35, ease: EASE }} className="flex w-full items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/20">
          <Icon className="h-4 w-4 text-brand-300" />
        </span>
        <span className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white">{title}</p>
          <p className="text-[11px] text-white/55">{meta}</p>
        </span>
        <span className="relative ml-auto inline-flex shrink-0">
          <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition-opacity duration-300', approved && 'opacity-0')}>
            <Clock3 className="h-3 w-3" /> In review
          </span>
          <motion.span initial={false} animate={approved ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
            className="absolute right-0 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
            <Check className="h-3 w-3" /> Approved
          </motion.span>
        </span>
      </motion.div>
    </AnimatePresence>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const greeting = timeGreeting();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(form.email, form.password);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}!`);
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen">
        {/* Left brand panel — navy base + breathing aurora + hairline grid + grain */}
        <div className="relative isolate hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0b2350] via-[#0a1f44] to-[#07152e] p-12 text-white lg:flex">
          <div aria-hidden className="login-aurora login-aurora-a" />
          <div aria-hidden className="login-aurora login-aurora-b" />
          <div aria-hidden className="login-grid absolute inset-0" />
          <div aria-hidden className="login-noise absolute inset-0" />
          <div aria-hidden className="pointer-events-none absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_-1px_0_0_rgba(255,255,255,0.04)]" />

          <motion.div {...rise(0.15)} className="relative z-10 flex items-start justify-between">
            <div>
              <img src="/logo-light.png" alt="t@g" className="h-12 w-auto" />
              <p className="mt-2.5 text-[10px] font-bold uppercase tracking-[0.3em] text-white/60">Digital Pulse of NGI</p>
            </div>
            <span className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs font-medium text-white/75 backdrop-blur-md xl:inline-flex">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
              All systems live
            </span>
          </motion.div>

          <motion.div {...rise(0.24)} className="relative z-10 pb-6">
            <p className="mb-5 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-300/90">
              <Sparkles className="h-3.5 w-3.5" /> Marketing OS — Nagarjuna Group
            </p>
            <h1 className="max-w-lg text-[2.6rem] font-extrabold leading-[1.08] tracking-tight">
              Manage all your
              <CycleWord />
              in one place.
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70">
              Analytics, approvals, planning and brand assets for every campus — one login away.
            </p>

            {/* Live product preview — sparkline draws itself, an approval gets approved */}
            <div className="relative mt-10 max-w-md">
              <motion.div {...rise(0.45)} className="rounded-2xl border border-white/10 bg-white/[0.07] p-5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.65)] backdrop-blur-xl">
                <div className="flex items-center justify-between gap-3">
                  <p className="inline-flex items-center gap-2 text-xs font-semibold text-white/80">
                    <ChartColumn className="h-3.5 w-3.5 text-brand-300" /> Follower growth
                    <span aria-hidden className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    </span>
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">Preview</span>
                </div>
                <LiveBars />
                <p className="mt-2 text-[11px] font-medium text-white/55">All four platforms · last 30 days</p>
              </motion.div>

              <motion.div {...rise(0.6)} className="absolute -bottom-6 -right-2 sm:-right-4">
                <div className="login-float flex w-72 items-center rounded-2xl border border-white/10 bg-[#0d1e3d]/90 p-3.5 pr-4 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.7)] backdrop-blur-xl">
                  <ApprovalTicker items={TICKER_ITEMS} />
                </div>
              </motion.div>
            </div>
          </motion.div>

          <motion.div {...rise(0.35)} className="relative z-10 flex items-center border-t border-white/10 pt-6">
            <div className="flex items-center gap-2.5">
              {PLATFORMS.map(({ icon: Icon, name }, i) => (
                <span key={name} title={name}
                  className="login-float flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] backdrop-blur-md"
                  style={{ animationDuration: `${4.5 + i * 0.8}s`, animationDelay: `${i * 0.35}s` }}>
                  <Icon aria-label={name} className="h-[18px] w-[18px] text-white/80" />
                </span>
              ))}
            </div>
            <div className="ml-4">
              <p className="text-sm font-semibold text-white">One dashboard, four platforms</p>
              <p className="mt-0.5 text-xs text-white/55">LinkedIn · Instagram · Facebook · YouTube</p>
            </div>
          </motion.div>
        </div>

        {/* Right form side */}
        <div className="relative flex w-full items-center justify-center overflow-hidden p-6 sm:p-10 lg:w-1/2">
          <div aria-hidden className="pointer-events-none absolute -top-32 right-[-10%] h-96 w-96 rounded-full bg-brand-500/[0.07] blur-3xl dark:bg-brand-500/[0.12]" />
          <div aria-hidden className="login-dots pointer-events-none absolute inset-x-0 top-0 h-48 lg:hidden" />

          <div className="w-full max-w-md">
            {/* Brand header for mobile, where the panel is hidden */}
            <div className="mb-8 flex flex-col items-center gap-2.5 lg:hidden">
              <img src="/logo-trim.png" alt="t@g" className="h-12 w-auto dark:hidden" />
              <img src="/logo-light.png" alt="t@g" className="hidden h-12 w-auto dark:block" />
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Digital Pulse of NGI</p>
            </div>

            {/* Glass card with the living conic border (.login-card::before) */}
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.6, ease: EASE }}
              className="login-card relative w-full rounded-3xl bg-white/85 p-6 shadow-[0_24px_60px_-24px_rgba(11,35,80,0.25)] backdrop-blur-xl dark:bg-slate-900/75 dark:shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)] sm:p-10"
            >
              <motion.div {...itemAt(0.25)} className="mb-8">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-400">
                  <Sparkles className="h-3.5 w-3.5" /> Sign in
                </p>
                <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-800 dark:text-white">{greeting}.</h2>
                <div aria-hidden className="mt-4 h-px w-full bg-slate-200 dark:bg-slate-700"><div className="h-px w-10 bg-brand-500" /></div>
                <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Pick up right where you left off — your dashboards are waiting.</p>
              </motion.div>

              <form onSubmit={submit} className="space-y-4">
                <motion.div {...itemAt(0.32)} className="group relative">
                  <Mail className="pointer-events-none absolute left-3 top-[35px] h-4 w-4 text-slate-400 transition-colors duration-200 group-focus-within:text-brand-500" />
                  <Input label="Email" labelClassName={LABEL_CLS} type="email" required autoFocus autoComplete="email"
                    placeholder="you@dmm.com" className="login-input pl-9"
                    value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </motion.div>
                <motion.div {...itemAt(0.39)} className="group relative">
                  <Lock className="pointer-events-none absolute left-3 top-[35px] h-4 w-4 text-slate-400 transition-colors duration-200 group-focus-within:text-brand-500" />
                  <Input label="Password" labelClassName={LABEL_CLS} type="password" required autoComplete="current-password"
                    placeholder="••••••••" className="login-input pl-9"
                    value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </motion.div>
                <motion.div {...itemAt(0.46)} className="flex justify-end">
                  <Link to="/forgot-password"
                    className="relative text-sm font-medium text-brand-700 after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-0 after:bg-brand-700 after:transition-[width] after:duration-200 hover:text-brand-800 hover:after:w-full dark:text-brand-400 dark:hover:text-brand-300">
                    Forgot password?
                  </Link>
                </motion.div>
                <motion.div {...itemAt(0.53)}>
                  <Button type="submit" loading={loading} size="lg" className="group relative w-full overflow-hidden">
                    <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent group-hover:animate-[tag-sheen_0.9s_ease-out]" />
                    Sign in <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Button>
                </motion.div>
              </form>

              <motion.p {...itemAt(0.6)} className="mt-8 text-center text-sm">
                <span className="font-medium text-brand-700 dark:text-brand-400">New to t@g?</span>{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-200">Ask your administrator for access.</span>
              </motion.p>
            </motion.div>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
