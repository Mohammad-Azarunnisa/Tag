import { useQuery } from '@tanstack/react-query';
import { Linkedin, Instagram, Youtube, Facebook } from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { analyticsApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/authStore.js';
import CountUp from './CountUp.jsx';

const CONFIG = {
  LinkedIn: { icon: Linkedin, color: '#0A66C2', metrics: [['followers', 'Followers'], ['impressions', 'Impressions'], ['engagementRate', 'Engagement', '%']] },
  Instagram: { icon: Instagram, color: '#E1306C', metrics: [['followers', 'Followers'], ['reach', 'Reach'], ['engagementRate', 'Engagement', '%']] },
  YouTube: { icon: Youtube, color: '#FF0000', metrics: [['subscribers', 'Subscribers'], ['views', 'Views'], ['watchHours', 'Watch Hrs']] },
  Facebook: { icon: Facebook, color: '#1877F2', metrics: [['followers', 'Followers'], ['newFollowers', 'New'], ['interactions', 'Interactions']] },
};

export default function SocialCards({ social, orgId: orgIdProp }) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  // Admin dashboards pass the picked org; everyone else falls back to their own.
  const orgId = orgIdProp || user?.organization?._id || user?.organization;

  // LinkedIn values come from the 15-day pulse (same numbers as the LinkedIn
  // view / LinkedIn itself) instead of a single day's snapshot.
  const { data: pulseData } = useQuery({ queryKey: ['analytics-pulse'], queryFn: analyticsApi.pulse, enabled: !!orgId });
  const pulse = (pulseData?.organizations || []).find((o) => String(o.organization._id) === String(orgId));
  const linkedin = pulse?.hasData
    ? { followers: pulse.followers, impressions: pulse.impressions, engagementRate: pulse.engagementRate }
    : social?.LinkedIn;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Object.entries(CONFIG).map(([platform, cfg], i) => {
        const Icon = cfg.icon;
        const data = platform === 'LinkedIn' ? linkedin : social?.[platform];
        const hasData = !!data;
        return (
          <motion.div
            key={platform}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            onClick={() => navigate('/social-analytics')}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/social-analytics'); } }}
            className="card cursor-pointer overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          >
            <div className="mb-4 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: `${cfg.color}15` }}>
                <Icon className="h-5 w-5" style={{ color: cfg.color }} />
              </div>
              <span className="font-bold text-slate-700 dark:text-slate-200">{platform}</span>
            </div>
            {hasData ? (
              <div className="grid grid-cols-3 gap-2">
                {cfg.metrics.map(([key, label, suffix]) => (
                  <div key={key}>
                    <p className="text-lg font-extrabold tabular-nums text-slate-800 dark:text-white">
                      <CountUp value={data[key] ?? 0} decimals={suffix === '%' ? 1 : 0} />{suffix || ''}
                    </p>
                    <p className="text-[11px] text-slate-400">{label}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No metrics yet. An admin can add these under <span className="font-medium text-slate-500">Social Analytics</span>.</p>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
