#!/usr/bin/env node
import { arg, has, json, now, fetchJson } from './utils.mjs';
import { filterOfficialResults, officialDomainsForQuery } from './retrieval-utils.mjs';

const query = arg('--query');
const provider = arg('--provider', process.env.WEB_SEARCH_PROVIDER || 'tavily');
const maxResults = Number(arg('--max', process.env.WEB_SEARCH_MAX_RESULTS || '8'));
const domains = [];
for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--domain') domains.push(process.argv[i+1]);
const requireOfficial = has('--official');
const effectiveDomains = domains.length ? domains : officialDomainsForQuery(query, requireOfficial);

if (!query) {
  json({ ok: false, error: '--query required' });
  process.exit(2);
}

if (provider === 'off' || process.env.ALLOW_WEB_SEARCH === 'false') {
  json({ ok: true, provider: 'off', sourceType: 'web_search', collectedAt: now(), query, skipped: true, reason: 'Web search is disabled.' });
  process.exit(0);
}

async function tavily() {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error('TAVILY_API_KEY missing');
  const body = {
    query,
    max_results: maxResults,
    search_depth: requireOfficial ? 'advanced' : 'basic',
    include_answer: true,
    include_raw_content: false
  };
  if (effectiveDomains.length) body.include_domains = effectiveDomains;
  const data = await fetchJson('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const results = (data.results || []).map(r => ({ title: r.title, url: r.url, score: r.score, content: r.content }));
  return { provider: 'tavily', sourceType: 'web_search', collectedAt: now(), query, requireOfficial, officialDomains: effectiveDomains, answer: data.answer, results: requireOfficial ? filterOfficialResults(results, effectiveDomains) : results };
}

async function brave() {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error('BRAVE_SEARCH_API_KEY missing');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', effectiveDomains.length ? `${query} (${effectiveDomains.map(d => `site:${d}`).join(' OR ')})` : query);
  url.searchParams.set('count', String(Math.min(maxResults, 20)));
  const data = await fetchJson(url.toString(), {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': key }
  });
  const results = (data.web?.results || []).map(r => ({ title: r.title, url: r.url, description: r.description, age: r.age }));
  return { provider: 'brave', sourceType: 'web_search', collectedAt: now(), query, requireOfficial, officialDomains: effectiveDomains, results: requireOfficial ? filterOfficialResults(results, effectiveDomains) : results };
}

try {
  json(provider === 'brave' ? await brave() : await tavily());
} catch (err) {
  json({ ok: false, provider, query, error: err.message, note: 'Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY, or disable web search in config/search-policy.yaml.' });
  process.exit(1);
}
