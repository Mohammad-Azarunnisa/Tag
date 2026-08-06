import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Send, RotateCcw, KeyRound, Bot, Wrench } from 'lucide-react';
import { aiApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Card, Skeleton } from '../components/ui/primitives.jsx';
import { cn } from '../lib/utils.js';

const SUGGESTIONS = [
  'Which organization has the most followers overall?',
  'How is NCET doing on LinkedIn in the last 28 days?',
  'Which organizations are closest to their growth goals?',
  'What approvals are still waiting for review?',
  'Compare Instagram followers across all organizations.',
];

const TOOL_LABELS = {
  list_organizations: 'organizations',
  social_media_overview: 'social overview',
  platform_metrics: 'platform metrics',
  growth_goals: 'growth goals',
  approvals_summary: 'approvals',
  post_plans: 'post plans',
};

export default function Assistant() {
  const { data: status, isLoading } = useQuery({ queryKey: ['ai-status'], queryFn: aiApi.status });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Tago — AI Assistant"
        subtitle="Ask Tago anything about your organizations — analytics, goals, approvals, plans. Answers come from your live data."
      />
      {isLoading ? <Skeleton className="h-96" /> : status?.configured ? <Chat /> : <SetupCard />}
    </div>
  );
}

function SetupCard() {
  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10">
        <KeyRound className="h-7 w-7" />
      </div>
      <h3 className="mb-2 text-lg font-bold text-slate-800 dark:text-white">One step to switch the assistant on</h3>
      <p className="mx-auto mb-4 max-w-md text-sm text-slate-500 dark:text-slate-400">
        Create an API key at <span className="font-semibold text-slate-700 dark:text-slate-200">platform.openai.com → API keys</span>,
        then paste it into the backend environment file and restart the backend:
      </p>
      <pre className="mx-auto mb-4 w-fit rounded-xl bg-slate-900 px-5 py-3 text-left text-sm font-semibold text-emerald-400">
        {'# DMM_backend/.env\nOPENAI_API_KEY=sk-...'}
      </pre>
      <p className="mx-auto mb-4 max-w-md text-xs text-slate-400">
        An Anthropic key works too — set ANTHROPIC_API_KEY instead and the assistant uses that.
      </p>
      <p className="text-xs text-slate-400">The key stays on the server only — it is never sent to the browser or committed to git.</p>
    </Card>
  );
}

function Chat() {
  const { user } = useAuthStore();
  const [messages, setMessages] = useState([]); // { role, content, tools? }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const send = async (text) => {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    setInput('');
    const next = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await aiApi.chat(next.map(({ role, content }) => ({ role, content })));
      setMessages((m) => [...m, { role: 'assistant', content: res.reply, tools: res.toolsUsed }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${e.response?.data?.message || 'Something went wrong — please try again.'}` }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <Card className="flex min-h-[560px] flex-1 flex-col overflow-hidden p-0">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-5 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-soft">
              <Sparkles className="h-7 w-7" />
            </div>
            <div>
              <p className="font-bold text-slate-800 dark:text-white">Hi {user?.name?.split(' ')[0]} — I'm Tago, your marketing assistant</p>
              <p className="mt-1 text-sm text-slate-400">I read the live database: analytics, goals, approvals, events, team and more.</p>
            </div>
            <div className="flex max-w-2xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-500/50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => <Bubble key={i} msg={m} />)}

        {busy && (
          <div className="flex items-start gap-3">
            <AvatarBot />
            <div className="rounded-2xl rounded-tl-md bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
              <span className="flex gap-1.5">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-brand-400" style={{ animationDelay: `${d}ms` }} />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-100 p-4 dark:border-slate-800">
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2">
          {messages.length > 0 && (
            <button type="button" title="New conversation" onClick={() => setMessages([])}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy}
            placeholder="Ask about analytics, goals, approvals…" className="input-base h-11 flex-1" />
          <Button type="submit" disabled={!input.trim() || busy} className="shrink-0"><Send className="h-4 w-4" /> Ask</Button>
        </form>
      </div>
    </Card>
  );
}

const AvatarBot = () => (
  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white">
    <Bot className="h-4.5 w-4.5" />
  </div>
);

function Bubble({ msg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-brand-600 px-4 py-2.5 text-sm text-white shadow-soft">{msg.content}</div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <AvatarBot />
      <div className="max-w-[85%]">
        <div className="rounded-2xl rounded-tl-md bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
          <Markdown text={msg.content} />
        </div>
        {msg.tools?.length > 0 && (
          <p className="mt-1.5 flex items-center gap-1.5 pl-1 text-[11px] text-slate-400">
            <Wrench className="h-3 w-3" /> checked: {msg.tools.map((t) => TOOL_LABELS[t] || t).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}

// Minimal markdown renderer for assistant replies: bold, bullets, numbered
// lists, headings and pipe tables. Everything else renders as plain text.
// Exported so the floating TagoWidget renders replies identically.
export function Markdown({ text }) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.includes('|') && lines[i + 1]?.match(/^\s*\|?[\s:|-]+\|?\s*$/)) {
      const rows = [];
      const header = line.split('|').map((c) => c.trim()).filter(Boolean);
      i += 2;
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i].split('|').map((c) => c.trim()).filter(Boolean));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*•]\s+/, '')); i++; }
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
      blocks.push({ type: 'ol', items });
      continue;
    }
    blocks.push({ type: 'p', text: line });
    i++;
  }

  return (
    <div className="space-y-1.5">
      {blocks.map((b, k) => {
        if (b.type === 'table') {
          return (
            <div key={k} className="overflow-x-auto py-1">
              <table className="w-full min-w-[280px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left dark:border-slate-700">
                    {b.header.map((h, j) => <th key={j} className="px-2 py-1.5 font-bold"><Inline text={h} /></th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {b.rows.map((r, j) => (
                    <tr key={j}>{r.map((c, x) => <td key={x} className="px-2 py-1.5"><Inline text={c} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.type === 'ul') return <ul key={k} className="list-disc space-y-1 pl-5">{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>;
        if (b.type === 'ol') return <ol key={k} className="list-decimal space-y-1 pl-5">{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ol>;
        if (/^#{1,4}\s+/.test(b.text)) return <p key={k} className="pt-1 font-bold"><Inline text={b.text.replace(/^#{1,4}\s+/, '')} /></p>;
        if (!b.text.trim()) return null;
        return <p key={k}><Inline text={b.text} /></p>;
      })}
    </div>
  );
}

// Inline **bold** support.
function Inline({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="font-bold text-slate-800 dark:text-white">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}
