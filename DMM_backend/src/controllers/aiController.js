import asyncHandler from 'express-async-handler';
import { hasKey, modelName, complete, provider, keyVarName } from '../services/aiService.js';
import { TOOL_DEFINITIONS, runTool } from '../services/aiTools.js';
import { readHistory, readPostingRate, projectBaseline, reconcile } from '../services/goalSuggestion.js';
import Organization from '../models/Organization.js';
import { PLATFORMS, ROLES } from '../config/constants.js';

// Human label for the role names used across the platform.
const roleLabel = (user) =>
  user.role === 'ADMIN' ? 'Super Admin' : user.role === 'CEO' ? 'Admin — head of their organization' : 'User — content creator';

// The assistant can run on OpenAI or Anthropic, so these messages name whichever
// one is configured rather than hard-coding a provider the user may not be using.
const NOT_CONFIGURED = 'AI assistant is not configured yet - add OPENAI_API_KEY (or ANTHROPIC_API_KEY) to the backend .env';
const keyRejected = () => `The configured ${keyVarName()} was rejected - check it in the backend .env`;
const noAccess = () => `The ${keyVarName()} is valid but has no access to ${modelName()} - check the account has credit and the model enabled`;

// Numbers are always written in full with separators (see the system prompt).
const nf = (n) => Number(n || 0).toLocaleString('en-US');

const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY = 20;

const systemPrompt = (user) => `You are Tago, the built-in AI assistant of "t@g", a digital-marketing management platform used by the Nagarjuna group of institutions (engineering, management, degree and PU colleges) and partner organizations to run their social media. Your name is Tago — refer to yourself as Tago when you introduce yourself or are asked who you are.

The person talking to you is ${user.name} (${roleLabel(user)}${user.organization?.name ? `, organization: ${user.organization.name}` : ''}). Today's date is ${new Date().toISOString().slice(0, 10)}.

You have read-only tools over the platform's LIVE database covering the WHOLE app: organizations, social media analytics (LinkedIn, Instagram, YouTube, Facebook), growth goals, content approvals, post plans, the template repository and asset library (templates_and_assets), the brand library, events, campus signage (banner stands + history), team members, the website inventory, premium pack purchases, the social handlers directory and the activity log. If a question is about anything stored in the app, there is a tool for it — pick the closest one rather than saying you have no access.

Rules:
- ALWAYS use tools to answer questions about data — never invent numbers. If a tool returns no data, say so plainly.
- Write numbers in full with thousands separators (e.g. 11,148 — never "11k").
- Be concise and direct: answer first, then at most a few supporting points. Use short bullet lists or compact tables when comparing.
- If an organization name is ambiguous or unknown, check list_organizations before answering.
- You cannot create, edit, approve or delete anything yet — if asked to, explain the steps to do it in the app instead (e.g. "Post Planner page → New plan").
- Only discuss this platform and the marketing work around it. Politely decline unrelated requests.`;

// @route GET /api/ai/status — is the assistant configured? (never exposes the key)
export const aiStatus = asyncHandler(async (req, res) => {
  res.json({ success: true, configured: hasKey(), model: hasKey() ? modelName() : null, provider: provider() });
});

// @route POST /api/ai/chat — { messages: [{ role: 'user'|'assistant', content: string }] }
// Runs an agentic loop: the model may call data tools, we execute them and feed
// results back until it produces a final text answer.
export const aiChat = asyncHandler(async (req, res) => {
  if (!hasKey()) {
    res.status(503);
    throw new Error(NOT_CONFIGURED);
  }
  const history = Array.isArray(req.body.messages) ? req.body.messages : [];
  const clean = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!clean.length || clean[clean.length - 1].role !== 'user') {
    res.status(400);
    throw new Error('Send at least one user message');
  }

  const messages = [...clean];
  const toolsUsed = [];
  let reply = '';

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await complete({ system: systemPrompt(req.user), messages, tools: TOOL_DEFINITIONS, cache: true });
      if (process.env.AI_LOG_USAGE === '1' && result.usage) {
        const u = result.usage;
        console.log(`[ai/chat] in=${u.input_tokens} cacheWrite=${u.cache_creation_input_tokens || 0} cacheRead=${u.cache_read_input_tokens || 0} out=${u.output_tokens}`);
      }
      const toolCalls = (result.content || []).filter((b) => b.type === 'tool_use');
      const text = (result.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

      if (result.stop_reason !== 'tool_use' || !toolCalls.length || round === MAX_TOOL_ROUNDS) {
        reply = text || 'Sorry — I could not produce an answer. Please try rephrasing.';
        break;
      }

      messages.push({ role: 'assistant', content: result.content });
      const toolResults = await Promise.all(toolCalls.map(async (call) => {
        toolsUsed.push(call.name);
        const output = await runTool(call.name, call.input, req.user);
        return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output) };
      }));
      messages.push({ role: 'user', content: toolResults });
    }
  } catch (err) {
    if (err.code === 'BAD_KEY') { res.status(503); throw new Error(keyRejected()); }
    if (err.code === 'NO_ACCESS') { res.status(503); throw new Error(noAccess()); }
    if (err.code === 'RATE_LIMIT') { res.status(429); throw new Error('The AI service is rate-limited right now — try again in a moment'); }
    throw err;
  }

  res.json({ success: true, reply, toolsUsed: [...new Set(toolsUsed)] });
});

// Platform-specific copy guidance so a draft reads native to where it will run.
const PLATFORM_VOICE = {
  LinkedIn: 'Professional and credible. 3–6 short sentences, a clear hook first line, one insight or achievement, a warm call to action. Sparing emojis. 5–8 focused hashtags.',
  Instagram: 'Warm, energetic and visual. 1–3 punchy lines with a strong hook, tasteful emojis, and a question or CTA. 8–12 discoverable hashtags mixing broad and college-specific tags.',
  YouTube: 'A compelling caption/description for the video: a one-line hook, then 2–3 lines of context and what viewers will see. 5–8 hashtags.',
  Facebook: 'Friendly and community-minded. 2–4 approachable sentences that invite comments and shares. A few emojis. 5–8 hashtags.',
};

// The single tool we force so the model returns clean, structured copy.
const DRAFT_TOOL = {
  name: 'provide_post_content',
  description: 'Return the finished social-media post copy for the approver to review.',
  input_schema: {
    type: 'object',
    properties: {
      caption: { type: 'string', description: 'The ready-to-publish caption, written natively for the platform. No hashtags inside — put those in the hashtags array.' },
      hashtags: { type: 'array', items: { type: 'string' }, description: 'Relevant hashtags WITHOUT the # symbol, most relevant first.' },
      description: { type: 'string', description: 'A one or two line internal note for the approver: the angle taken and any suggestion (best posting time, media idea). Keep it short.' },
    },
    required: ['caption', 'hashtags', 'description'],
  },
};

// @route POST /api/ai/draft — generate on-brand post copy from a short brief.
// Structured output: we force the provide_post_content tool and return its input.
export const aiDraft = asyncHandler(async (req, res) => {
  if (!hasKey()) {
    res.status(503);
    throw new Error(NOT_CONFIGURED);
  }
  const platform = String(req.body.platform || '').trim();
  const title = String(req.body.title || '').trim();
  const brief = String(req.body.brief || req.body.description || '').trim();
  const tone = String(req.body.tone || '').trim();
  const existing = String(req.body.caption || '').trim();
  if (!PLATFORMS.includes(platform)) {
    res.status(400);
    throw new Error(`platform must be one of ${PLATFORMS.join(', ')}`);
  }
  if (!title && !brief && !existing) {
    res.status(400);
    throw new Error('Add a title or a short brief so Tago has something to work from');
  }

  // Light, single-read org context keeps the copy on-brand without ballooning tokens.
  let org = null;
  if (req.body.organization) {
    org = await Organization.findById(req.body.organization).select('name description').lean().catch(() => null);
  }

  const system = `You are Tago, the in-house content copywriter for "t@g", the marketing platform of the Nagarjuna group of institutions (engineering, management, degree and PU colleges) and partner organizations. You write social media copy that is authentic, specific and never generic or spammy. You avoid clichés, empty hype and overused phrases. You never invent facts, statistics, names or dates — if a detail is not given, keep the copy general rather than fabricating. You always call the provide_post_content tool with your answer.`;

  const orgLine = org ? `Organization: ${org.name}${org.description ? ` — ${org.description}` : ''}.` : 'Organization: a Nagarjuna group institution.';
  const prompt = [
    `Write a ${platform} post.`,
    orgLine,
    `Platform style — ${PLATFORM_VOICE[platform] || 'Clear, engaging and platform-appropriate.'}`,
    title && `Topic / title: ${title}`,
    brief && `Brief / details: ${brief}`,
    tone && `Requested tone: ${tone}`,
    existing && `Improve and build on this existing draft rather than starting over:\n"""${existing}"""`,
    'Return the result via the provide_post_content tool.',
  ].filter(Boolean).join('\n\n');

  try {
    const result = await complete({
      system,
      messages: [{ role: 'user', content: prompt }],
      tools: [DRAFT_TOOL],
      toolChoice: { type: 'tool', name: 'provide_post_content' },
      maxTokens: 800,
    });
    const call = (result.content || []).find((b) => b.type === 'tool_use' && b.name === 'provide_post_content');
    const out = call?.input || {};
    const hashtags = Array.isArray(out.hashtags)
      ? out.hashtags.map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean)
      : [];
    res.json({
      success: true,
      caption: String(out.caption || '').trim(),
      hashtags: hashtags.join(', '),
      description: String(out.description || '').trim(),
      model: modelName(),
    });
  } catch (err) {
    if (err.code === 'BAD_KEY') { res.status(503); throw new Error(keyRejected()); }
    if (err.code === 'NO_ACCESS') { res.status(503); throw new Error(noAccess()); }
    if (err.code === 'RATE_LIMIT') { res.status(429); throw new Error('The AI service is busy right now — try again in a moment'); }
    throw err;
  }
});

// ---- Analytics Insights ----------------------------------------------------
// A plain-English read of an organization's live numbers. Results are cached in
// memory per organization so repeated dashboard views cost nothing — the copy
// only regenerates after the TTL or when the caller asks for a refresh.
const INSIGHTS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const insightsCache = new Map(); // orgId -> { at: ms, payload }

const INSIGHTS_TOOL = {
  name: 'provide_insights',
  description: 'Return the analytics read-out for the organization.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One punchy sentence summarising how this organization is doing right now.' },
      highlights: {
        type: 'array', description: 'What is going well — 2 to 4 items grounded in the numbers.',
        items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title', 'detail'] },
      },
      watchOuts: {
        type: 'array', description: 'Opportunities — 1 to 3 growth openings framed positively (an underused platform, a metric worth tracking). Constructive, not critical. Empty array if none.',
        items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title', 'detail'] },
      },
      recommendations: { type: 'array', description: '2 to 4 concrete, specific next actions.', items: { type: 'string' } },
    },
    required: ['headline', 'highlights', 'watchOuts', 'recommendations'],
  },
};

// Assemble a compact, token-light snapshot of one org from the read-only tools.
const gatherSnapshot = async (orgName, user) => {
  const [overviewAll, goals, approvals] = await Promise.all([
    runTool('social_media_overview', {}, user),
    runTool('growth_goals', { organization: orgName }, user),
    runTool('approvals_summary', { organization: orgName }, user),
  ]);
  const audience = Array.isArray(overviewAll)
    ? overviewAll.filter((r) => r.organization === orgName).map((r) => ({ platform: r.platform, audience: r.audience, engagementRate: r.engagementRate }))
    : [];
  // 28-day growth per platform (only where there is data).
  const perPlatform = await Promise.all(PLATFORMS.map((p) => runTool('platform_metrics', { organization: orgName, platform: p, days: 28 }, user)));
  const growth = perPlatform
    .filter((m) => m && !m.note && !m.error)
    .map((m) => ({
      platform: m.platform,
      audience: m.audience?.current,
      gained28d: m.audience?.gained,
      engagementPct: m.engagementRatePct,
      periodTotals: m.periodTotals,
    }));
  return { organization: orgName, audience, growth, goals, approvals };
};

// Merge the snapshot into a flat, chart-ready view: one row per platform with
// audience, engagement and 28-day change, plus roll-up totals. Real numbers
// only — this is what the dashboard visualises (no AI involved).
const computeMetrics = (snapshot) => {
  const byPlatform = {};
  for (const a of snapshot.audience || []) {
    byPlatform[a.platform] = { platform: a.platform, audience: a.audience || 0, engagementPct: a.engagementRate || 0, gained28d: null };
  }
  for (const g of snapshot.growth || []) {
    const prev = byPlatform[g.platform] || {};
    byPlatform[g.platform] = {
      platform: g.platform,
      audience: g.audience ?? prev.audience ?? 0,
      engagementPct: g.engagementPct ?? prev.engagementPct ?? 0,
      gained28d: g.gained28d ?? prev.gained28d ?? null,
    };
  }
  const platforms = Object.values(byPlatform).sort((a, b) => (b.audience || 0) - (a.audience || 0));
  const totalAudience = platforms.reduce((s, p) => s + (p.audience || 0), 0);
  const gained28d = platforms.reduce((s, p) => s + (p.gained28d || 0), 0);
  return {
    platforms,
    totalAudience,
    gained28d,
    platformCount: platforms.length,
    topPlatform: platforms[0]?.platform || null,
  };
};

// @route POST /api/ai/insights — { organization?, refresh? }
export const aiInsights = asyncHandler(async (req, res) => {
  if (!hasKey()) {
    res.status(503);
    throw new Error(NOT_CONFIGURED);
  }
  // Scope: CEO/USER are locked to their own org; ADMIN must name one.
  let orgId = req.body.organization;
  if (req.user.role !== ROLES.ADMIN) orgId = req.user.organization?._id || req.user.organization || orgId;
  if (!orgId) { res.status(400); throw new Error('An organization is required for insights'); }
  const org = await Organization.findById(orgId).select('name').lean().catch(() => null);
  if (!org) { res.status(404); throw new Error('Organization not found'); }

  const key = String(orgId);
  const cached = insightsCache.get(key);
  const fresh = cached && Date.now() - cached.at < INSIGHTS_TTL_MS;
  if (fresh && !req.body.refresh) {
    res.json({ success: true, ...cached.payload, cached: true, generatedAt: new Date(cached.at).toISOString() });
    return;
  }

  const snapshot = await gatherSnapshot(org.name, req.user);
  // No data at all — don't spend a call, return a clear empty state.
  if (!snapshot.audience.length && !snapshot.growth.length) {
    res.status(200).json({ success: true, empty: true, message: `No analytics recorded yet for ${org.name}.` });
    return;
  }

  const metrics = computeMetrics(snapshot);

  const system = `You are Tago, the analytics advisor inside "t@g", the marketing platform of the Nagarjuna group of colleges. You turn social-media numbers into a clear, encouraging read-out for a busy college marketing head. Lead with what is going well and always keep a positive, motivating tone — but stay honest and grounded in the numbers. Never invent figures; if data is thin, frame it as an opportunity to start tracking rather than a failure. Where a platform is underused, phrase it as untapped potential and a clear next move, not as criticism. Write plainly, no jargon. Numbers in full with thousands separators (e.g. 11,148). Always answer through the provide_insights tool.`;
  const prompt = `Here is the latest data for ${org.name} (audience is followers, or subscribers on YouTube; gained28d is change over the last 28 days):\n\n${JSON.stringify(snapshot, null, 2)}\n\nGive the read-out via the provide_insights tool. Keep each detail to one or two crisp sentences.`;

  try {
    const result = await complete({
      system,
      messages: [{ role: 'user', content: prompt }],
      tools: [INSIGHTS_TOOL],
      toolChoice: { type: 'tool', name: 'provide_insights' },
      maxTokens: 1100,
    });
    const call = (result.content || []).find((b) => b.type === 'tool_use' && b.name === 'provide_insights');
    const out = call?.input || {};
    const payload = {
      organization: org.name,
      headline: String(out.headline || '').trim(),
      highlights: Array.isArray(out.highlights) ? out.highlights : [],
      watchOuts: Array.isArray(out.watchOuts) ? out.watchOuts : [],
      recommendations: Array.isArray(out.recommendations) ? out.recommendations : [],
      metrics,
      model: modelName(),
    };
    insightsCache.set(key, { at: Date.now(), payload });
    res.json({ success: true, ...payload, cached: false, generatedAt: new Date().toISOString() });
  } catch (err) {
    if (err.code === 'BAD_KEY') { res.status(503); throw new Error(keyRejected()); }
    if (err.code === 'NO_ACCESS') { res.status(503); throw new Error(noAccess()); }
    if (err.code === 'RATE_LIMIT') { res.status(429); throw new Error('The AI service is busy right now — try again in a moment'); }
    throw err;
  }
});

// ---- Approval Review Assist ------------------------------------------------
// A quick quality check for the approver before they hit Approve/Reject: reads
// the post's copy and flags tone, clarity, hashtags, brand-safety and CTA
// issues, with specific fixes. Text only — the reviewer still eyeballs the media.
const REVIEW_TOOL = {
  name: 'provide_review',
  description: 'Return the pre-approval quality review of the post copy.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['ready', 'minor', 'needs_work'], description: 'ready = publish as-is; minor = small tweaks suggested; needs_work = should be revised before approval.' },
      summary: { type: 'string', description: 'One sentence overall assessment.' },
      checks: {
        type: 'array', description: 'Per-dimension checks. Cover the ones that are relevant.',
        items: {
          type: 'object',
          properties: {
            area: { type: 'string', description: 'e.g. Tone, Clarity, Hashtags, Brand safety, Call to action, Length' },
            status: { type: 'string', enum: ['good', 'warn', 'fix'] },
            note: { type: 'string', description: 'Short, specific observation.' },
          },
          required: ['area', 'status', 'note'],
        },
      },
      suggestions: { type: 'array', description: 'Concrete, specific fixes (empty if none needed).', items: { type: 'string' } },
      revisedCaption: { type: 'string', description: 'Optional improved caption the approver can use. Omit or leave empty if the caption is already good.' },
    },
    required: ['verdict', 'summary', 'checks', 'suggestions'],
  },
};

// @route POST /api/ai/review — { approvalId }. Reviewers (Admin/CEO) only.
export const aiReview = asyncHandler(async (req, res) => {
  if (!hasKey()) {
    res.status(503);
    throw new Error(NOT_CONFIGURED);
  }
  if (![ROLES.ADMIN, ROLES.CEO].includes(req.user.role)) {
    res.status(403);
    throw new Error('Only approvers can run a review');
  }
  const { default: ApprovalRequest } = await import('../models/ApprovalRequest.js');
  const request = await ApprovalRequest.findById(req.body.approvalId).populate('organization', 'name').lean();
  if (!request) { res.status(404); throw new Error('Approval request not found'); }
  // CEOs may only review their own organization's requests.
  if (req.user.role === ROLES.CEO) {
    const ownOrg = String(req.user.organization?._id || req.user.organization);
    if (String(request.organization?._id || request.organization) !== ownOrg) {
      res.status(403);
      throw new Error('You can only review requests for your organization');
    }
  }

  const hashtags = Array.isArray(request.hashtags) ? request.hashtags : [];
  const post = {
    organization: request.organization?.name,
    platform: request.platform,
    type: request.type,
    title: request.title,
    caption: request.caption || '(none provided)',
    description: request.description || '(none)',
    hashtags: hashtags.length ? hashtags.join(', ') : '(none)',
    hashtagCount: hashtags.length,
    aspectRatio: request.aspectRatio || undefined,
  };

  const system = `You are Tago, the pre-publish reviewer inside "t@g", the marketing platform of the Nagarjuna group of colleges. You give the approver a fast, honest quality check on a social post before they approve it. Judge it as content that represents an educational institution to students, parents and the public. Check tone and professionalism, clarity, hashtag relevance and count for the platform, brand safety (nothing off-brand, misleading, or inappropriate), a clear call to action, and length fit for the platform. Be specific and constructive — quote the exact wording you would change. You cannot see the attached image or video, so never comment on visuals; if the caption depends on the media, note that the approver should confirm it matches. Never invent facts. Always answer through the provide_review tool.`;
  const prompt = `Review this ${request.platform} ${String(request.type).toLowerCase()} for ${request.organization?.name || 'the college'}:\n\n${JSON.stringify(post, null, 2)}\n\nReturn your review via the provide_review tool.`;

  try {
    const result = await complete({
      system,
      messages: [{ role: 'user', content: prompt }],
      tools: [REVIEW_TOOL],
      toolChoice: { type: 'tool', name: 'provide_review' },
      maxTokens: 900,
    });
    const call = (result.content || []).find((b) => b.type === 'tool_use' && b.name === 'provide_review');
    const out = call?.input || {};
    res.json({
      success: true,
      verdict: ['ready', 'minor', 'needs_work'].includes(out.verdict) ? out.verdict : 'minor',
      summary: String(out.summary || '').trim(),
      checks: Array.isArray(out.checks) ? out.checks : [],
      suggestions: Array.isArray(out.suggestions) ? out.suggestions : [],
      revisedCaption: String(out.revisedCaption || '').trim(),
      model: modelName(),
    });
  } catch (err) {
    if (err.code === 'BAD_KEY') { res.status(503); throw new Error(keyRejected()); }
    if (err.code === 'NO_ACCESS') { res.status(503); throw new Error(noAccess()); }
    if (err.code === 'RATE_LIMIT') { res.status(429); throw new Error('The AI service is busy right now — try again in a moment'); }
    throw err;
  }
});

// ---- Goal suggestion --------------------------------------------------------
// "What should this quarter's follower target be?" — answered from the
// organization's own history rather than a guess.
//
// The number is arithmetic, not generation: services/goalSuggestion.js measures
// the real growth rate and projects it across the requested period. The model's
// job is to weigh that against engagement and posting cadence and recommend a
// figure with a reason a human can argue with. Its answer is then clamped to a
// band around the projection, so a hallucination can never reach the form — and
// if there is no AI key at all, the projection is returned on its own.
const GOAL_TOOL = {
  name: 'provide_goal_suggestion',
  description: 'Return the recommended growth target for this organization and platform.',
  input_schema: {
    type: 'object',
    properties: {
      followerGain: {
        type: 'number',
        description: 'How many NEW followers/subscribers to aim for across the whole period. A whole number. Base it on the projection you were given — stay close to it unless the engagement or cadence data justifies otherwise.',
      },
      targetPosts: {
        type: 'number',
        description: 'How many posts to publish across the period, based on the observed posting rate. A whole number.',
      },
      rationale: {
        type: 'string',
        description: 'Two or three plain sentences: what the recent numbers show, and why this target follows from them. Quote the figures you used. No hype.',
      },
      stretch: {
        type: 'string',
        description: 'One sentence on what it would take to beat this target — a concrete lever, not encouragement.',
      },
    },
    required: ['followerGain', 'targetPosts', 'rationale'],
  },
};

// @route POST /api/ai/goal-suggestion  (ADMIN) — { organization, platform, startDate, endDate }
export const aiGoalSuggestion = asyncHandler(async (req, res) => {
  const { organization, platform } = req.body;
  if (!organization) { res.status(400); throw new Error('organization is required'); }
  if (!PLATFORMS.includes(platform)) {
    res.status(400); throw new Error(`platform must be one of ${PLATFORMS.join(', ')}`);
  }
  const start = new Date(req.body.startDate);
  const end = new Date(req.body.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    res.status(400); throw new Error('Valid startDate and endDate are required');
  }
  if (end <= start) { res.status(400); throw new Error('endDate must be after startDate'); }

  const org = await Organization.findById(organization).select('name').lean().catch(() => null);
  if (!org) { res.status(404); throw new Error('Organization not found'); }

  const periodDays = Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)));
  const periodMonths = Math.round((periodDays / 30) * 10) / 10;

  const [history, posting] = await Promise.all([
    readHistory(organization, platform),
    readPostingRate(organization, platform),
  ]);
  const baseline = projectBaseline(history, periodDays);
  const audienceLabel = platform === 'YouTube' ? 'subscribers' : 'followers';
  const observedPosts = Math.max(1, Math.round(posting.perMonth * (periodDays / 30)));

  const respond = (extra) => res.json({
    success: true,
    organization: org.name,
    platform,
    audienceLabel,
    period: { startDate: req.body.startDate, endDate: req.body.endDate, days: periodDays, months: periodMonths },
    currentAudience: history.currentAudience,
    history: {
      hasTrend: history.hasTrend,
      sampleFrom: history.sampleFrom || null,
      sampleTo: history.sampleTo || null,
      sampleDays: history.sampleDays || 0,
      gainedInSample: history.gainedInSample || 0,
      perMonth: history.hasTrend ? Math.round(history.monthlyRate) : null,
      recentPerMonth: history.recentMonthlyRate == null ? null : Math.round(history.recentMonthlyRate),
      trendDirection: history.trendDirection || 'unknown',
      engagementRate: history.engagementRate,
      postsPerMonth: Math.round(posting.perMonth * 10) / 10,
    },
    projection: {
      method: baseline.method,
      perMonth: Math.round(baseline.dailyRate * 30),
      gain: baseline.suggestedGain,
      target: baseline.suggestedTarget,
      confidence: baseline.confidence,
    },
    ...extra,
  });

  // Nothing recorded at all — no audience and no trend to reason from.
  if (!history.currentAudience && !history.hasTrend) {
    respond({
      suggestion: null,
      note: `No analytics recorded yet for ${org.name} on ${platform}, so there is nothing to base a target on. Import or sync the numbers first.`,
    });
    return;
  }

  // The projection alone still answers the question, so a missing key degrades
  // the feature instead of breaking it.
  const projectionOnly = (note) => respond({
    suggestion: {
      followerGain: baseline.suggestedGain,
      targetFollowers: baseline.suggestedTarget,
      targetPosts: observedPosts,
      rationale: history.hasTrend
        ? `Based on ${org.name}'s own trend: about ${nf(Math.round(baseline.dailyRate * 30))} ${audienceLabel} a month over the last ${history.sampleDays} days, which comes to ${nf(baseline.suggestedGain)} across ${periodMonths} months.`
        : `There is not enough history to measure a trend, so this is a conservative estimate on the current ${nf(history.currentAudience)} ${audienceLabel}.`,
      source: 'projection',
      aiUsed: false,
      confidence: baseline.confidence,
    },
    note,
  });

  if (!hasKey()) { projectionOnly(NOT_CONFIGURED); return; }

  const system = `You are Tago, the analytics advisor inside "t@g", the marketing platform of the Nagarjuna group of colleges. You set growth targets a team can actually hit: grounded in that organization's own measured trend, never round-number wishful thinking. A target nobody can reach is worse than no target. You have been given a projection computed from real snapshots — treat it as the anchor and stay close to it, adjusting only where the engagement rate or posting cadence gives you a concrete reason. Never invent figures beyond the ones supplied. Always answer through the provide_goal_suggestion tool.`;

  const facts = {
    organization: org.name,
    platform,
    audienceMeasure: audienceLabel,
    currentAudience: history.currentAudience,
    periodMonths,
    periodDays,
    measuredTrend: history.hasTrend ? {
      window: `${history.sampleFrom} to ${history.sampleTo} (${history.sampleDays} days)`,
      gainedInWindow: history.gainedInSample,
      perMonthAverage: Math.round(history.monthlyRate),
      perMonthRecent: history.recentMonthlyRate == null ? null : Math.round(history.recentMonthlyRate),
      direction: history.trendDirection,
    } : 'not enough snapshots to measure a trend',
    engagementRatePct: history.engagementRate,
    postsPerMonth: Math.round(posting.perMonth * 10) / 10,
    projectionForThisPeriod: {
      method: baseline.method,
      gain: baseline.projectedGain,
      confidence: baseline.confidence,
    },
  };

  const prompt = `Recommend the ${platform} growth target for ${org.name} over the next ${periodMonths} month${periodMonths === 1 ? '' : 's'} (${periodDays} days).

Here is everything measured from the platform's own records:

${JSON.stringify(facts, null, 2)}

followerGain must be the number of NEW ${audienceLabel} to gain across the whole period — not the total to reach. Anchor it to projectionForThisPeriod.gain. Answer via the provide_goal_suggestion tool.`;

  try {
    const result = await complete({
      system,
      messages: [{ role: 'user', content: prompt }],
      tools: [GOAL_TOOL],
      toolChoice: { type: 'tool', name: 'provide_goal_suggestion' },
      maxTokens: 700,
    });
    const call = (result.content || []).find((b) => b.type === 'tool_use' && b.name === 'provide_goal_suggestion');
    const out = call?.input || {};

    const settled = reconcile({ history, baseline, aiGain: out.followerGain });
    // Posting cadence is a straight multiplication, so the observed rate wins
    // whenever the model strays far from it.
    const aiPosts = Number(out.targetPosts);
    const targetPosts = Number.isFinite(aiPosts) && aiPosts > 0 && aiPosts <= observedPosts * 3
      ? Math.round(aiPosts)
      : observedPosts;

    respond({
      suggestion: {
        followerGain: settled.gain,
        targetFollowers: settled.target,
        targetPosts,
        rationale: String(out.rationale || '').trim(),
        stretch: String(out.stretch || '').trim(),
        source: settled.source,
        // Surfaced so the UI can say the figure was pulled back to something
        // reachable, rather than silently rewriting what the model said.
        clamped: !!settled.clamped,
        band: settled.band || null,
        aiUsed: true,
        confidence: baseline.confidence,
        model: modelName(),
      },
    });
  } catch (err) {
    if (err.code === 'BAD_KEY' || err.code === 'NO_ACCESS' || err.code === 'RATE_LIMIT') {
      projectionOnly(err.code === 'RATE_LIMIT'
        ? 'The AI service is busy, so this is the projection from your own numbers.'
        : keyRejected());
      return;
    }
    throw err;
  }
});
