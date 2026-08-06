import asyncHandler from 'express-async-handler';
import dns from 'dns/promises';
import net from 'net';

// Lightweight Open-Graph link-preview fetcher used by the Brand Library so any
// external link shows a real thumbnail (like a WhatsApp/Slack preview).
//
// SSRF-guarded: only http/https, the target host must not resolve to a private/
// loopback/link-local address, the fetch is time-boxed, and only HTML is parsed.
// Results are cached in-memory to avoid re-fetching the same URL repeatedly.

const cache = new Map(); // url -> { data, exp }
const TTL = 6 * 60 * 60 * 1000; // 6h
const MAX_HTML = 300_000; // parse at most ~300KB of markup

const isPrivateIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  const s = String(ip).toLowerCase();
  return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
};

const metaContent = (html, prop) => {
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i');
  const b = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
  return (html.match(a)?.[1] || html.match(b)?.[1] || '').trim();
};

// @route GET /api/link-preview?url=  — returns { url, image, title, siteName, favicon }
export const linkPreview = asyncHandler(async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!/^https?:\/\//i.test(url)) { res.status(400); throw new Error('A valid http(s) URL is required'); }

  const now = Date.now();
  const cached = cache.get(url);
  if (cached && cached.exp > now) return res.json(cached.data);

  let host;
  try { host = new URL(url).hostname; } catch { res.status(400); throw new Error('Invalid URL'); }

  // SSRF guard — refuse private/loopback targets.
  try {
    const records = await dns.lookup(host, { all: true });
    if (!records.length || records.some((r) => isPrivateIp(r.address))) { res.status(400); throw new Error('This host is not allowed'); }
  } catch (e) {
    res.status(400);
    throw new Error(e.message === 'This host is not allowed' ? e.message : 'Could not resolve that host');
  }

  const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  let html = '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TAG-LinkPreview/1.0)', Accept: 'text/html,application/xhtml+xml' },
    });
    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.includes('text/html')) html = (await r.text()).slice(0, MAX_HTML);
  } catch { /* network/timeout — return favicon-only preview */ }
  finally { clearTimeout(timer); }

  let image = metaContent(html, 'og:image') || metaContent(html, 'twitter:image') || metaContent(html, 'twitter:image:src');
  if (image && !/^https?:\/\//i.test(image)) { try { image = new URL(image, url).href; } catch { image = ''; } }
  const title = metaContent(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim();
  const siteName = metaContent(html, 'og:site_name') || host;

  const data = { url, image: image || '', title: title || '', siteName, favicon };
  cache.set(url, { data, exp: now + TTL });
  res.json(data);
});
