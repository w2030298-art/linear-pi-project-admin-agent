#!/usr/bin/env node
import { arg, has, json, now, fetchJson } from './utils.mjs';

const query = arg('--query');
const provider = arg('--provider', process.env.WEB_SEARCH_PROVIDER || 'tavily');
const maxResults = Number(arg('--max', process.env.WEB_SEARCH_MAX_RESULTS || '8'));
const domains = [];
for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--domain') domains.push(process.argv[i+1]);

if (!query) {
  json({ ok: false, error: '--query required' });
  process.exit(2);
}

async function tavily() {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error('TAVILY_API_KEY missing');
  const body = {
    query,
    max_results: maxResults,
    search_depth: has('--official') ? 'advanced' : 'basic',
    include_answer: true,
    include_raw_content: false
  };
  if (domains.length) body.include_domains = domains;
  const data = await fetchJson('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  return { provider: 'tavily', sourceType: 'web_search', collectedAt: now(), query, answer: data.answer, results: (data.results || []).map(r => ({ title: r.title, url: r.url, score: r.score, content: r.content })) };
}

async function brave() {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error('BRAVE_SEARCH_API_KEY missing');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', domains.length ? `${query} (${domains.map(d => `site:${d}`).join(' OR ')})` : query);
  url.searchParams.set('count', String(Math.min(maxResults, 20)));
  const data = await fetchJson(url.toString(), {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': key }
  });
  return { provider: 'brave', sourceType: 'web_search', collectedAt: now(), query, results: (data.web?.results || []).map(r => ({ title: r.title, url: r.url, description: r.description, age: r.age })) };
}

try {
  json(provider === 'brave' ? await brave() : await tavily());
} catch (err) {
  json({ ok: false, provider, query, error: err.message, note: 'Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY, or disable web search in config/search-policy.yaml.' });
  process.exit(1);
}
