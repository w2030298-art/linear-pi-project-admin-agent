import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Tiny .env loader so validate scripts can run before npm install.
try {
  const envText = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1);
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {}

export function json(data) { console.log(JSON.stringify(data, null, 2)); }
export function now() { return new Date().toISOString(); }
export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
export function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
export function writeJson(file, data) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
export function hash(input) { return crypto.createHash('sha256').update(typeof input === 'string' ? input : JSON.stringify(input)).digest('hex'); }
export function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}
export function has(name) { return process.argv.includes(name); }
export async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const txt = await res.text();
  let body;
  try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}
