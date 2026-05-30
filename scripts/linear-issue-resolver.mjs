const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISSUE_IDENTIFIER_RE = /^[A-Z][A-Z0-9]+-\d+$/i;

function clean(value) {
  return String(value || '').trim();
}

function compactIssue(issue) {
  return {
    id: issue.id || null,
    identifier: issue.identifier || null,
    title: issue.title || null,
    url: issue.url || null
  };
}

function resolutionGap(locator, path, message) {
  return {
    ok: false,
    code: 'linear_issue_identifier_resolution_gap',
    blocking: true,
    path,
    identifier: clean(locator),
    message
  };
}

export async function resolveIssueIdentifier(locator, {
  exactLookup,
  path = '$.input.issueIdentifier',
  role = 'issue'
} = {}) {
  const input = clean(locator);
  if (!input) return resolutionGap(input, path, `Linear ${role} identifier is empty.`);

  if (UUID_RE.test(input)) {
    return {
      ok: true,
      kind: 'issue',
      role,
      path,
      identifier: null,
      id: input,
      source: 'input_uuid',
      evidenceRef: `linear:issue:${input}`,
      issue: { id: input, identifier: null, title: null, url: null }
    };
  }

  if (!ISSUE_IDENTIFIER_RE.test(input)) {
    return resolutionGap(input, path, `Linear ${role} must be a UUID or exact issue identifier like WEN-123.`);
  }
  if (typeof exactLookup !== 'function') {
    return resolutionGap(input, path, 'Linear exact issue lookup is unavailable.');
  }

  const issue = await exactLookup(input);
  if (!issue?.id) {
    return resolutionGap(input, path, `Linear issue identifier could not be resolved exactly: ${input}`);
  }

  return {
    ok: true,
    kind: 'issue',
    role,
    path,
    identifier: issue.identifier || input,
    id: issue.id,
    source: 'linear_issue_exact_lookup',
    evidenceRef: `linear:issue:${input}`,
    issue: compactIssue(issue),
    chain: [
      { source: 'issue_identifier', identifier: input },
      { source: 'linear_get_issue_exact', id: issue.id }
    ]
  };
}

export async function resolveIssueRelationIdentifiers(input, {
  exactLookup,
  pathPrefix = '$.input'
} = {}) {
  const out = { ...input };
  const findings = [];
  const resolutions = [];

  const targets = [
    { field: 'issueIdentifier', idField: 'issueId', role: 'issue' },
    { field: 'relatedIssueIdentifier', idField: 'relatedIssueId', role: 'relatedIssue' }
  ];

  for (const target of targets) {
    if (!out[target.field]) continue;
    const result = await resolveIssueIdentifier(out[target.field], {
      exactLookup,
      path: `${pathPrefix}.${target.field}`,
      role: target.role
    });
    if (result.ok) {
      out[target.idField] = result.id;
      resolutions.push(result);
    } else {
      findings.push({
        code: result.code,
        severity: 'error',
        blocking: true,
        path: result.path,
        message: result.message,
        resolution: result
      });
    }
  }

  return {
    ok: findings.length === 0,
    input: out,
    findings,
    resolutions
  };
}
