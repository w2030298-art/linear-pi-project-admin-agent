#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const guidePath = 'docs/WEZTERM_PI_LAUNCH.md';
const reportPath = 'docs/reports/wezterm-pi-smoke-2026-05-29.md';
const configPath = 'config/wezterm-linear-pi.lua';
const installerPath = 'scripts/install-wezterm-linear-pi-shortcut.ps1';

assert.equal(fs.existsSync(guidePath), true, `${guidePath} should exist`);
assert.equal(fs.existsSync(reportPath), true, `${reportPath} should exist`);
assert.equal(fs.existsSync(configPath), true, `${configPath} should exist`);
assert.equal(fs.existsSync(installerPath), true, `${installerPath} should exist`);

const guide = fs.readFileSync(guidePath, 'utf8');
const report = fs.readFileSync(reportPath, 'utf8');
const config = fs.readFileSync(configPath, 'utf8');
const installer = fs.readFileSync(installerPath, 'utf8');

for (const text of [guide, report]) {
  assert.match(text, /wezterm-gui\.exe/i);
  assert.match(text, /wezterm start --cwd|start --cwd/i);
  assert.match(text, /--config-file/i);
  assert.match(text, /config[\\\/]wezterm-linear-pi\.lua/i);
  assert.match(text, /C:\\Users\\22003\\linear-pi-project-admin-agent/);
  assert.match(text, /\bpi\b/);
  assert.doesNotMatch(text, /(LINEAR_API_KEY|LINEAR_API_TOKEN|GITHUB_TOKEN|OPENAI_API_KEY)\s*=/i);
  assert.doesNotMatch(text, /sk-[A-Za-z0-9_-]{20,}/);
}

assert.match(guide, /winget install wez\.wezterm/i);
assert.match(guide, /default_cwd/i);
assert.match(guide, /任务栏/);
assert.match(guide, /回退/);
assert.match(guide, /Windows Terminal/);
assert.match(guide, /中文输入/);
assert.match(guide, /复制粘贴/);
assert.match(guide, /滚动/);
assert.match(guide, /快捷键/);

assert.match(report, /WezTerm version/i);
assert.match(report, /Shortcut/i);
assert.match(report, /Manual verification/i);
assert.match(report, /rollback/i);

assert.match(config, /require\(["']wezterm["']\)/);
assert.match(config, /CopyTo\(["']Clipboard["']\)/);
assert.match(config, /PasteFrom\(["']Clipboard["']\)/);
assert.match(config, /ActivateCommandPalette/);
assert.match(config, /SpawnTab/);
assert.match(installer, /--config-file/);
assert.match(installer, /wezterm-linear-pi\.lua/);

console.log('wezterm launch docs tests passed');
