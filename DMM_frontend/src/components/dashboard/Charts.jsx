import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { Card } from '../ui/primitives.jsx';
import { CHART_COLORS } from '../../lib/utils.js';

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

export function FollowerTrendChart({ data }) {
  return (
    <ChartCard title="Audience Growth" subtitle="Followers / subscribers across platforms">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={(d) => d?.slice(5)} minTickGap={24} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
          <Tooltip {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="LinkedIn" stroke="#0A66C2" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="Instagram" stroke="#E1306C" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="Facebook" stroke="#1877F2" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="YouTube" stroke="#FF0000" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
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
