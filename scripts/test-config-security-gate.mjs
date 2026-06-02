import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateConfigSecurityGate } from './config-security-gate.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fixtureRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `linear-config-gate-${name}-`));
}

function writeFixture(root, overrides = {}) {
  writeJson(path.join(root, '.pi', 'settings.json'), overrides.settings || {
    sessionDir: '.pi/sessions',
    compaction: { enabled: true, reserveTokens: 24576, keepRecentTokens: 24000 },
    enabledModels: ['gpt-4.1', 'claude-3-5-sonnet-latest']
  });
  writeJson(path.join(root, 'package.json'), overrides.packageJson || {
    scripts: {
      validate: 'node scripts/validate-layout.mjs',
      test: 'npm run test:config-security && npm run typecheck',
      'test:config-security': 'node scripts/test-config-security-gate.mjs'
    },
    dependencies: {
      express: '^5.1.0'
    },
    devDependencies: {
      typescript: '^5.9.3'
    }
  });
}

{
  const root = fixtureRoot('safe');
  writeFixture(root);
  const report = validateConfigSecurityGate({ root });
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
}

{
  const root = fixtureRoot('unsafe');
  writeFixture(root, {
    settings: {
      compaction: { enabled: true, reserveTokens: 2048, keepRecentTokens: 2000 },
      enabledModels: ['gpt-*', 'gemini-*']
    },
    packageJson: {
      scripts: { validate: 'node scripts/validate-layout.mjs' },
      dependencies: { express: 'latest' },
      devDependencies: { tsx: 'latest' }
    }
  });
  const report = validateConfigSecurityGate({ root });
  assert.equal(report.ok, false);
  assert.equal(report.findings.some(finding => finding.code === 'model_allowlist_wildcard'), true);
  assert.equal(report.findings.some(finding => finding.code === 'dependency_latest'), true);
  assert.equal(report.findings.some(finding => finding.code === 'test_umbrella_missing'), true);
  assert.equal(report.findings.some(finding => finding.code === 'compaction_buffer_too_small'), true);
}

console.log('config security gate tests passed');
