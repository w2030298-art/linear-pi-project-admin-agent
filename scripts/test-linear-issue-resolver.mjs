#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  resolveIssueIdentifier,
  resolveIssueRelationIdentifiers
} from './linear-issue-resolver.mjs';

const wen270 = {
  id: '27000000-0000-4000-8000-000000000270',
  identifier: 'WEN-270',
  title: 'Write confirmation fallback',
  url: 'https://linear.app/workspace/issue/WEN-270/write-confirmation-fallback'
};
const wen254 = {
  id: '25400000-0000-4000-8000-000000000254',
  identifier: 'WEN-254',
  title: 'Dry-run governance',
  url: 'https://linear.app/workspace/issue/WEN-254/dry-run-governance'
};

function lookup(overrides = {}) {
  const calls = [];
  return {
    calls,
    exactLookup: async locator => {
      calls.push(locator);
      if (overrides.missing) return null;
      if (locator === 'WEN-270') return wen270;
      if (locator === 'WEN-254') return wen254;
      return null;
    }
  };
}

{
  const l = lookup();
  const result = await resolveIssueIdentifier('WEN-270', {
    exactLookup: l.exactLookup,
    path: '$.operations[0].input.relatedIssueIdentifier'
  });
  assert.equal(result.ok, true);
  assert.equal(result.id, wen270.id);
  assert.equal(result.issue.identifier, 'WEN-270');
  assert.equal(result.source, 'linear_issue_exact_lookup');
  assert.deepEqual(l.calls, ['WEN-270']);
}

{
  const l = lookup();
  const id = '11111111-1111-4111-8111-111111111111';
  const result = await resolveIssueIdentifier(id, {
    exactLookup: l.exactLookup,
    path: '$.operations[0].input.issueIdentifier'
  });
  assert.equal(result.ok, true);
  assert.equal(result.id, id);
  assert.equal(result.source, 'input_uuid');
  assert.deepEqual(l.calls, []);
}

{
  const l = lookup({ missing: true });
  const result = await resolveIssueIdentifier('WEN-999', {
    exactLookup: l.exactLookup,
    path: '$.operations[0].input.relatedIssueIdentifier'
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocking, true);
  assert.equal(result.code, 'linear_issue_identifier_resolution_gap');
  assert.match(result.message, /could not be resolved/i);
}

{
  const l = lookup();
  const result = await resolveIssueRelationIdentifiers({
    type: 'blocks',
    issueIdentifier: 'WEN-254',
    relatedIssueIdentifier: 'WEN-270'
  }, {
    exactLookup: l.exactLookup,
    pathPrefix: '$.operations[0].input'
  });
  assert.equal(result.ok, true);
  assert.equal(result.input.issueId, wen254.id);
  assert.equal(result.input.relatedIssueId, wen270.id);
  assert.deepEqual(result.resolutions.map(item => item.identifier), ['WEN-254', 'WEN-270']);
}

console.log('linear issue resolver tests passed');
