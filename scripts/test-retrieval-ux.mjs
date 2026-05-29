#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  filterOfficialResults,
  isIssueIdentifierOrUuid,
  officialDomainsForQuery,
  scoreDocument,
  tokenizeQuery
} from './retrieval-utils.mjs';

const tokens = tokenizeQuery('Fact Pack write guard dry-run operations');
assert.deepEqual(tokens, ['fact', 'pack', 'write', 'guard', 'dry', 'run', 'operations']);

const docScore = scoreDocument(
  'OPERATIONS.md',
  'Fact Pack evidence, write guard preflight, dry-run apply and operations schema are documented here.',
  tokens
);
assert.equal(docScore.score, 7);
assert.deepEqual(docScore.matchedTokens, tokens);

const officialDomains = officialDomainsForQuery('Linear GraphQL API official docs', true);
assert.deepEqual(officialDomains, ['linear.app']);

const filtered = filterOfficialResults(
  [
    { title: 'Linear API docs', url: 'https://linear.app/developers/graphql' },
    { title: 'Rollout guide', url: 'https://rollout.com/integration/linear' }
  ],
  officialDomains
);
assert.equal(filtered.length, 1);
assert.equal(filtered[0].url, 'https://linear.app/developers/graphql');

assert.equal(isIssueIdentifierOrUuid('WEN-239'), true);
assert.equal(isIssueIdentifierOrUuid('57eb6535-1f0d-4d8b-b1c2-518719c691c8'), true);
assert.equal(isIssueIdentifierOrUuid('portfolio review'), false);

console.log('retrieval UX tests passed');
