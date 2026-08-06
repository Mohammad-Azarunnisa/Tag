// AI client for the built-in assistant (Tago). Talks to OpenAI or Anthropic —
// whichever key is configured. The key lives ONLY in the backend environment
// (OPENAI_API_KEY / ANTHROPIC_API_KEY); it is never sent to the browser, logged,
// or committed. Plain fetch, so no extra dependency either way.
//
// Everything above this file is written against Anthropic's message shape:
// content blocks, `tool_use` / `tool_result`, `input_schema`. Rather than rewrite
// the assistant, the OpenAI path translates in both directions and hands back
// the same shape — so aiController and aiTools don't know or care which provider
// answered. Adding a third provider means adding a translation here and nothing
// else.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
// Cheap, fast, and supports tool calling — the three things the assistant needs.
// Override with OPENAI_MODEL if you want a bigger model.
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

/**
 * Which provider to use. An explicit AI_PROVIDER wins; otherwise whichever key
 * is present, preferring OpenAI when both are. Returns null when neither is set,
 * which is what makes the assistant report itself as "not configured".
 */
export const provider = () => {
  const forced = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (forced === 'openai' || forced === 'anthropic') return forced;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
};

const apiKey = () => (provider() === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY);

export const hasKey = () => !!apiKey();

export const modelName = () => (provider() === 'openai'
  ? (process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL)
  : (process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL));

/** The env var to point someone at when the assistant isn't set up or is rejected. */
export const keyVarName = () => (provider() === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY');

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

// Prompt caching: the first call writes the cache (1.25x), every reuse within 5
// minutes reads it at ~0.1x. A breakpoint on the system prompt caches tools +
// system, and a rolling one on the last message means a multi-round tool
// conversation caches the whole prefix each round and the next round reads it
// back. Caching only engages once the prefix clears the model's minimum
// cacheable length (~4k tokens on Haiku 4.5) — which is exactly when tool
// results have made the conversation worth caching.
const addCacheControl = (block) => ({ ...block, cache_control: { type: 'ephemeral' } });
const markLastBlock = (messages) => {
  if (!Array.isArray(messages) || !messages.length) return messages;
  const out = messages.slice();
  const last = { ...out[out.length - 1] };
  if (typeof last.content === 'string') {
    last.content = [addCacheControl({ type: 'text', text: last.content })];
  } else if (Array.isArray(last.content) && last.content.length) {
    last.content = last.content.map((b, i) => (i === last.content.length - 1 ? addCacheControl(b) : b));
  }
  out[out.length - 1] = last;
  return out;
};

const callAnthropic = async ({ system, messages, tools, toolChoice, cache, maxTokens }) => {
  let sys = system;
  let msgs = messages;
  if (cache) {
    if (typeof system === 'string' && system) sys = [addCacheControl({ type: 'text', text: system })];
    msgs = markLastBlock(messages);
  }
  const body = { model: modelName(), max_tokens: maxTokens, system: sys, messages: msgs, tools };
  if (toolChoice) body.tool_choice = toolChoice;

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw providerError(data?.error?.message, res.status, 'Anthropic');
  return data;
};

// ---------------------------------------------------------------------------
// OpenAI — translated to and from the Anthropic shape
// ---------------------------------------------------------------------------

const jsonOrEmpty = (raw) => {
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
};

// Anthropic puts tools at the top level with an `input_schema`; OpenAI wraps
// each one in a `function` envelope and calls it `parameters`.
const toOpenAITools = (tools) => (Array.isArray(tools) && tools.length
  ? tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
  : undefined);

const toOpenAIToolChoice = (choice) => {
  if (!choice) return undefined;
  if (choice.type === 'tool' && choice.name) return { type: 'function', function: { name: choice.name } };
  if (choice.type === 'any') return 'required';
  if (choice.type === 'auto') return 'auto';
  return undefined;
};

/**
 * Anthropic-shaped conversation → OpenAI chat messages.
 *
 * Three shapes matter, all produced by the agent loop in aiController:
 *  - a plain string message, which carries over unchanged;
 *  - an assistant turn whose content blocks mix text with `tool_use`, which
 *    becomes one assistant message with `tool_calls`;
 *  - a user turn made of `tool_result` blocks, which becomes one OpenAI message
 *    per result with role 'tool' — OpenAI cannot batch them the way Anthropic
 *    does, and each must reference the call it answers.
 * `cache_control` markers are dropped: OpenAI caches automatically.
 */
const toOpenAIMessages = (system, messages) => {
  const out = [];
  const systemText = typeof system === 'string'
    ? system
    : (Array.isArray(system) ? system.map((b) => b.text || '').join('\n').trim() : '');
  if (systemText) out.push({ role: 'system', content: systemText });

  for (const msg of messages || []) {
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }
    const blocks = Array.isArray(msg.content) ? msg.content : [];

    const results = blocks.filter((b) => b.type === 'tool_result');
    if (results.length) {
      for (const r of results) {
        out.push({
          role: 'tool',
          tool_call_id: r.tool_use_id,
          content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? ''),
        });
      }
      // A turn is either tool results or ordinary content, never both.
      continue;
    }

    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n').trim();
    const calls = blocks.filter((b) => b.type === 'tool_use');
    if (msg.role === 'assistant' && calls.length) {
      out.push({
        role: 'assistant',
        // OpenAI wants null, not '', when a turn is only tool calls.
        content: text || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
        })),
      });
    } else if (text) {
      out.push({ role: msg.role, content: text });
    }
  }
  return out;
};

/** OpenAI response → the Anthropic-shaped object the rest of the app expects. */
const fromOpenAIResponse = (data) => {
  const choice = data?.choices?.[0] || {};
  const msg = choice.message || {};
  const content = [];
  if (msg.content) content.push({ type: 'text', text: String(msg.content) });
  for (const call of msg.tool_calls || []) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function?.name,
      input: jsonOrEmpty(call.function?.arguments),
    });
  }
  const u = data?.usage || {};
  return {
    content,
    // The agent loop keys off this exact value to decide whether to run tools.
    stop_reason: (msg.tool_calls || []).length ? 'tool_use' : 'end_turn',
    model: data?.model,
    usage: {
      input_tokens: u.prompt_tokens,
      output_tokens: u.completion_tokens,
      // OpenAI caches automatically; surface the hit so the usage log means the
      // same thing on both providers.
      cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens || 0,
      cache_creation_input_tokens: 0,
    },
  };
};

// `max_tokens` is deprecated for current OpenAI models and rejected outright by
// the reasoning ones, so the newer name goes first and we fall back only if the
// API actually complains about it. Older models (gpt-3.5-turbo, gpt-4) need the
// old name, and this is the only way to support both without pinning a list of
// model names that would go stale.
const wantsLegacyMaxTokens = (message = '') =>
  /max_completion_tokens/i.test(message) && /unsupported|unrecognized|unknown|not supported|invalid/i.test(message);

const postOpenAI = (body) => fetch(OPENAI_URL, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const callOpenAI = async ({ system, messages, tools, toolChoice, maxTokens }) => {
  const base = {
    model: modelName(),
    messages: toOpenAIMessages(system, messages),
    tools: toOpenAITools(tools),
    tool_choice: toOpenAIToolChoice(toolChoice),
  };

  let res = await postOpenAI({ ...base, max_completion_tokens: maxTokens });
  let data = await res.json().catch(() => ({}));

  if (!res.ok && wantsLegacyMaxTokens(data?.error?.message)) {
    res = await postOpenAI({ ...base, max_tokens: maxTokens });
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok) throw providerError(data?.error?.message, res.status, 'OpenAI');
  return fromOpenAIResponse(data);
};

// ---------------------------------------------------------------------------

const providerError = (message, status, label) => {
  const err = new Error(message || `${label} API error (${status})`);
  err.status = status;
  // 402/403 show up when a key is valid but the account has no credit or the
  // model isn't enabled for it — worth telling apart from a bad key.
  err.code = status === 401 ? 'BAD_KEY'
    : status === 429 ? 'RATE_LIMIT'
      : status === 402 || status === 403 ? 'NO_ACCESS'
        : 'API_ERROR';
  return err;
};

/**
 * One turn against the configured provider. `messages` may contain tool_use /
 * tool_result blocks from previous iterations of the agent loop. Pass
 * `toolChoice` to force a specific tool — used to get structured output (e.g. a
 * drafted caption) back as validated tool input instead of free text. `cache`
 * asks for prompt caching where the provider needs to be told (Anthropic);
 * OpenAI does it on its own, so the flag is simply ignored there.
 *
 * Always resolves to the Anthropic response shape, whichever provider ran.
 */
export const complete = async ({ system, messages, tools, toolChoice, cache = false, maxTokens = 1500 }) => {
  const which = provider();
  if (!which) {
    const err = new Error('AI assistant is not configured');
    err.code = 'NO_KEY';
    throw err;
  }
  if (!apiKey()) {
    const err = new Error(`AI_PROVIDER is set to ${which} but ${keyVarName()} is missing`);
    err.code = 'NO_KEY';
    throw err;
  }
  return which === 'openai'
    ? callOpenAI({ system, messages, tools, toolChoice, maxTokens })
    : callAnthropic({ system, messages, tools, toolChoice, cache, maxTokens });
};
