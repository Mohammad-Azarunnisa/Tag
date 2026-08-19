import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { Card } from '../ui/primitives.jsx';
import { cn, CHART_COLORS } from '../../lib/utils.js';

const axisStyle = { fontSize: 12, fill: '#94a3b8' };
const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13, boxShadow: '0 8px 24px -8px rgba(0,0,0,0.15)' },
};

function ChartCard({ title, subtitle, children, action }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-white">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function MonthlyTrendChart({ data }) {
  return (
    <ChartCard title="Approval Trends" subtitle="Last 6 months">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="gApproved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="month" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2.5} fill="url(#gTotal)" name="Total" />
          <Area type="monotone" dataKey="approved" stroke="#10b981" strokeWidth={2.5} fill="url(#gApproved)" name="Approved" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// Audience growth, faceted one panel per platform.
//
// It used to be four lines on a single pair of axes, which failed in three ways
// at once. LinkedIn's brand blue (#0A66C2) and Facebook's (#1877F2) are ΔE 8.4
// apart to normal vision — below the readable floor of 15, so the two lines were
// genuinely indistinguishable rather than merely similar. A shared y-axis scaled
// to LinkedIn's ~11.5k flattened YouTube's ~1.5k into a line with no visible
// movement. And because the platforms started reporting on different dates, three
// of the four series were short stubs on the right of a mostly empty plot.
//
// Faceting fixes all three: one series per panel needs no colour to be told apart
// (its heading names it), each panel scales to its own data so every platform's
// shape is legible, and each spans only the dates it actually has.
const AUDIENCE_PANELS = [
  { key: 'LinkedIn', color: '#0A66C2', unit: 'followers' },
  { key: 'Instagram', color: '#E1306C', unit: 'followers' },
  { key: 'Facebook', color: '#1877F2', unit: 'followers' },
  { key: 'YouTube', color: '#FF0000', unit: 'subscribers' },
];

const compact = (v) => {
  const n = Number(v) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
};

function AudiencePanel({ panel, rows }) {
  // Only the stretch this platform actually reported. A carried-forward series has
  // leading nulls until its first reading (see dashboardController) and plotting
  // those as a flat run would invent history it never had.
  const points = rows.filter((r) => r[panel.key] != null).map((r) => ({ date: r.date, value: r[panel.key] }));
  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: panel.color }} />
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{panel.key}</p>
        </div>
        <p className="mt-3 text-xs text-slate-400">No {panel.unit} recorded yet.</p>
      </div>
    );
  }

  const first = points[0].value;
  const latest = points[points.length - 1].value;
  const gained = latest - first;
  // Padded a little so the line never sits on the panel's edges — a tight domain
  // is what makes a small change visible at all at this size.
  const lo = Math.min(...points.map((p) => p.value));
  const hi = Math.max(...points.map((p) => p.value));
  const pad = Math.max(1, Math.round((hi - lo) * 0.15));

  return (
    <div className="rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* Identity comes from the heading, with the dot as reinforcement —
              never from the colour alone. */}
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: panel.color }} />
            <p className="truncate text-sm font-bold text-slate-700 dark:text-slate-200">{panel.key}</p>
          </div>
          <p className="mt-1 text-2xl font-extrabold tabular-nums leading-none text-slate-800 dark:text-white">
            {compact(latest)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">{panel.unit}</p>
        </div>
        {gained !== 0 && (
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums',
            gained > 0
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300')}>
            {gained > 0 ? '+' : ''}{compact(gained)}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={92}>
        <LineChart data={points} margin={{ top: 4, right: 6, bottom: 0, left: 6 }}>
          <CartesianGrid stroke="#e2e8f0" strokeWidth={1} vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis domain={[lo - pad, hi + pad]} hide />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(d) => d}
            formatter={(v) => [Number(v).toLocaleString('en-IN'), panel.unit]}
          />
          <Line
            type="monotone" dataKey="value" stroke={panel.color} strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-[11px] text-slate-400">
        {points[0].date} → {points[points.length - 1].date}
      </p>
    </div>
  );
}

export function FollowerTrendChart({ data }) {
  const rows = data || [];
  return (
    <ChartCard title="Audience Growth" subtitle="Followers / subscribers, per platform">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No audience history recorded yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {AUDIENCE_PANELS.map((panel) => <AudiencePanel key={panel.key} panel={panel} rows={rows} />)}
        </div>
      )}
    </ChartCard>
  );
}

export function PlatformBarChart({ data }) {
  return (
    <ChartCard title="Platform-wise Requests" subtitle="Total requests per platform">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="platform" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
          <Bar dataKey="count" radius={[8, 8, 0, 0]} name="Requests">
            {data?.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function StatusPieChart({ data }) {
  const colors = { PENDING: '#f59e0b', APPROVED: '#10b981', REJECTED: '#ef4444', RESUBMITTED: '#0ea5e9', POSTED: '#8b5cf6' };
  const filtered = data?.filter((d) => d.count > 0) || [];
  return (
    <ChartCard title="Status Distribution" subtitle="Breakdown of all requests">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={filtered} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3}>
            {filtered.map((d) => <Cell key={d.status} fill={colors[d.status]} />)}
          </Pie>
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
