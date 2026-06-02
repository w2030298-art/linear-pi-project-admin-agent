import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { json } from './utils.mjs';

const MIN_RESERVE_TOKENS = 16384;
const MIN_KEEP_RECENT_TOKENS = 16000;
const TRUSTED_MODEL_IDS = new Set([
  'claude-3-5-sonnet-latest',
  'claude-3-7-sonnet-latest',
  'claude-sonnet-4-5',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-5',
  'gpt-5-mini',
  'gemini-2.5-pro',
  'gemini-2.5-flash'
]);

function readJson(root, relativePath, findings) {
  const filePath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    findings.push({
      code: 'config_json_unreadable',
      message: `${relativePath} must be readable JSON: ${err.message}`,
      path: relativePath
    });
    return null;
  }
}

function isWildcardModel(model) {
  return typeof model === 'string' && /[*?]/.test(model);
}

function validateModels(settings, findings) {
  const models = settings?.enabledModels;
  if (!Array.isArray(models) || models.length === 0) {
    findings.push({
      code: 'model_allowlist_missing',
      message: '.pi/settings.json enabledModels must list explicit trusted model IDs.',
      path: '.pi/settings.json.enabledModels'
    });
    return;
  }
  for (const model of models) {
    if (isWildcardModel(model)) {
      findings.push({
        code: 'model_allowlist_wildcard',
        message: `enabledModels entry ${JSON.stringify(model)} uses a wildcard. Linear write agents require explicit trusted model IDs.`,
        path: '.pi/settings.json.enabledModels'
      });
    } else if (!TRUSTED_MODEL_IDS.has(model)) {
      findings.push({
        code: 'model_allowlist_unknown',
        message: `enabledModels entry ${JSON.stringify(model)} is not in the reviewed trusted model registry for this repo.`,
        path: '.pi/settings.json.enabledModels'
      });
    }
  }
}

function validateCompaction(settings, findings) {
  const compaction = settings?.compaction || {};
  if (compaction.enabled !== true) {
    findings.push({
      code: 'compaction_disabled',
      message: '.pi/settings.json compaction.enabled must stay true for bounded runtime context.',
      path: '.pi/settings.json.compaction.enabled'
    });
  }
  if (Number(compaction.reserveTokens || 0) < MIN_RESERVE_TOKENS) {
    findings.push({
      code: 'compaction_buffer_too_small',
      message: `compaction.reserveTokens must be at least ${MIN_RESERVE_TOKENS}.`,
      path: '.pi/settings.json.compaction.reserveTokens'
    });
  }
  if (Number(compaction.keepRecentTokens || 0) < MIN_KEEP_RECENT_TOKENS) {
    findings.push({
      code: 'compaction_buffer_too_small',
      message: `compaction.keepRecentTokens must be at least ${MIN_KEEP_RECENT_TOKENS}.`,
      path: '.pi/settings.json.compaction.keepRecentTokens'
    });
  }
}

function validateDependencyPins(packageJson, findings) {
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = packageJson?.[section] || {};
    for (const [name, version] of Object.entries(deps)) {
      if (version === 'latest') {
        findings.push({
          code: 'dependency_latest',
          message: `${section}.${name} uses latest. Pin package.json to the reviewed lockfile version and update intentionally.`,
          path: `package.json.${section}.${name}`
        });
      }
    }
  }
}

function validateTestUmbrella(packageJson, findings) {
  const scripts = packageJson?.scripts || {};
  const test = scripts.test;
  if (typeof test !== 'string' || !test.trim()) {
    findings.push({
      code: 'test_umbrella_missing',
      message: 'package.json must define a test umbrella script for merge-gate test execution.',
      path: 'package.json.scripts.test'
    });
    return;
  }
  for (const required of ['test:config-security', 'typecheck']) {
    if (!test.includes(required)) {
      findings.push({
        code: 'test_umbrella_incomplete',
        message: `package.json scripts.test must include ${required}.`,
        path: 'package.json.scripts.test'
      });
    }
  }
}

export function validateConfigSecurityGate(options = {}) {
  const root = options.root || process.cwd();
  const findings = [];
  const settings = readJson(root, '.pi/settings.json', findings);
  const packageJson = readJson(root, 'package.json', findings);

  if (settings) {
    validateModels(settings, findings);
    validateCompaction(settings, findings);
  }
  if (packageJson) {
    validateDependencyPins(packageJson, findings);
    validateTestUmbrella(packageJson, findings);
  }

  return { ok: findings.length === 0, findings };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const report = validateConfigSecurityGate();
  json(report);
  if (!report.ok) process.exit(1);
}
