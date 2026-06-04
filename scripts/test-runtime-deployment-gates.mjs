import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert.equal(typeof packageJson.scripts['runtime:acceptance'], 'string');
assert.match(packageJson.scripts['runtime:acceptance'], /scripts\/runtime-acceptance\.mjs/);

const acceptanceScript = fs.readFileSync('scripts/runtime-acceptance.mjs', 'utf8');
assert.match(acceptanceScript, /runtimeRoot/);
assert.match(acceptanceScript, /git/);
assert.match(acceptanceScript, /npm/);
assert.match(acceptanceScript, /test:runtime-reload-master/);
assert.match(acceptanceScript, /test:runtime-local-protection/);
assert.match(acceptanceScript, /test:runtime-instruction-boundary/);
assert.match(acceptanceScript, /test:wezterm-launch/);
assert.match(acceptanceScript, /quarantineRuntimeChanges/);
assert.match(acceptanceScript, /linear-pi-runtime-code-drift-before-acceptance/);
assert.doesNotMatch(acceptanceScript, /Runtime root has non-ignored local changes/);

const workflow = fs.readFileSync('.github/workflows/runtime-ci.yml', 'utf8');
assert.match(workflow, /npm ci/);
assert.match(workflow, /npm run validate/);
assert.match(workflow, /npm run typecheck/);
assert.match(workflow, /npm run runtime:acceptance -- --ci/);

console.log('runtime deployment gate tests passed');
