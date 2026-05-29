const DEFAULT_OFFICIAL_DOMAINS = [
  { pattern: /\blinear\b/i, domains: ['linear.app'] },
  { pattern: /\bgithub\b/i, domains: ['docs.github.com', 'github.com'] },
  { pattern: /\bopenai\b/i, domains: ['platform.openai.com', 'docs.openai.com', 'openai.com'] }
];

export function tokenizeQuery(query) {
  const seen = new Set();
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
    .filter(token => {
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
  return tokens;
}

export function scoreDocument(filePath, content, tokens) {
  const haystack = `${filePath}\n${content}`.toLowerCase();
  const matchedTokens = tokens.filter(token => haystack.includes(token));
  return { score: matchedTokens.length, matchedTokens };
}

function hostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function matchesDomain(url, domain) {
  const host = hostname(url);
  const normalized = String(domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  return Boolean(host && normalized && (host === normalized || host.endsWith(`.${normalized}`)));
}

export function filterOfficialResults(results, domains) {
  const allowed = (domains || []).filter(Boolean);
  if (!allowed.length) return results;
  return (results || []).filter(result => allowed.some(domain => matchesDomain(result.url, domain)));
}

export function officialDomainsForQuery(query, requireOfficial = false) {
  if (!requireOfficial) return [];
  const envDomains = process.env.WEB_OFFICIAL_DOMAINS
    ? process.env.WEB_OFFICIAL_DOMAINS.split(',').map(domain => domain.trim()).filter(Boolean)
    : [];
  if (envDomains.length) return envDomains;
  const match = DEFAULT_OFFICIAL_DOMAINS.find(entry => entry.pattern.test(query || ''));
  return match ? match.domains : [];
}

export function isIssueIdentifierOrUuid(value) {
  const text = String(value || '').trim();
  return /^[A-Z][A-Z0-9]+-\d+$/.test(text) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text);
}
