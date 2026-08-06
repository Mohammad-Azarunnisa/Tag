import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Send, X, Maximize2, RotateCcw } from 'lucide-react';
import { aiApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/authStore.js';
import { cn } from '../lib/utils.js';
import { Markdown } from '../pages/Assistant.jsx';

const QUICK_ASKS = [
  'How are we doing on Instagram?',
  'What approvals are pending?',
  'What happened this week?',
];

// Tago — the assistant button that lives in the topbar (PAM-AI-style pill).
// Opens a compact chat panel anchored under the header that shares the same
// live-data brain as the full Assistant page. Conversation survives page
// navigation (the widget lives in the layout, above the router outlet).
export default function TagoWidget() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const { data: status } = useQuery({ queryKey: ['ai-status'], queryFn: aiApi.status, staleTime: 300000 });

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  // The full Assistant page already has Tago front and center.
  if (location.pathname === '/assistant') return null;

  const send = async (text) => {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    setInput('');
    const next = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await aiApi.chat(next.map(({ role, content }) => ({ role, content })));
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${e.response?.data?.message || 'Something went wrong — please try again.'}` }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <>
      {/* Topbar pill launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Ask Tago, the AI assistant"
        aria-expanded={open}
        title="Ask Tago"
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold shadow-sm transition-colors',
          open
            ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/50 dark:bg-brand-500/15 dark:text-brand-300'
            : 'border-brand-200 bg-white text-brand-700 hover:border-brand-300 hover:bg-brand-50 dark:border-brand-500/30 dark:bg-slate-900 dark:text-brand-300 dark:hover:bg-slate-800'
        )}
      >
        <Sparkles className="h-4 w-4" />
        <span className="hidden sm:inline">Tago AI</span>
      </button>

      {/* Chat panel — anchored under the header, below the pill */}
      {open && (
        <div className="fixed right-4 top-[4.5rem] z-50 flex h-[min(70vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:right-6">
          {/* Header */}
          <div className="flex items-center gap-2.5 bg-gradient-to-r from-brand-500 to-violet-600 px-4 py-3 text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20"><Sparkles className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-tight">Tago</p>
              <p className="text-[11px] text-white/75">Your marketing assistant · live data</p>
            </div>
            {messages.length > 0 && (
              <button onClick={() => setMessages([])} title="New conversation" aria-label="New conversation" className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white">
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => { setOpen(false); navigate('/assistant'); }} title="Open full page" aria-label="Open full page" className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white">
              <Maximize2 className="h-4 w-4" />
            </button>
            <button onClick={() => setOpen(false)} title="Close" aria-label="Close Tago" className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          {!status?.configured ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-400">
              Tago isn't switched on yet — an admin needs to add the AI key to the backend.
            </div>
          ) : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Hi {user?.name?.split(' ')[0]} 👋 I'm Tago.
                    </p>
                    <p className="-mt-2 text-xs text-slate-400">Ask me anything about your platform — analytics, approvals, team, events…</p>
                    <div className="flex flex-col gap-1.5">
                      {QUICK_ASKS.map((q) => (
                        <button key={q} onClick={() => send(q)}
                          className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-500/50">
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((m, i) => (
                  m.role === 'user' ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-brand-600 px-3 py-2 text-xs text-white">{m.content}</div>
                    </div>
                  ) : (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[90%] rounded-2xl rounded-tl-md bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                        <Markdown text={m.content} />
                      </div>
                    </div>
                  )
                ))}

                {busy && (
                  <div className="flex justify-start">
                    <span className="flex gap-1 rounded-2xl rounded-tl-md bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
                      {[0, 150, 300].map((d) => (
                        <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </span>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 border-t border-slate-100 p-3 dark:border-slate-800">
                <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy}
                  placeholder="Ask Tago…" className="input-base h-10 flex-1 text-sm" />
                <button type="submit" disabled={!input.trim() || busy} aria-label="Send"
                  className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition',
                    input.trim() && !busy ? 'bg-brand-600 hover:bg-brand-700' : 'cursor-not-allowed bg-slate-200 dark:bg-slate-700')}>
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
