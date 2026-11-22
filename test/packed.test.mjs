import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('packed package installs offline and its ESM/types work outside the source tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'http-policy-consumer-'));
  const run = (command, args, cwd = dir) => execFileSync(command, args, { cwd, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  try {
    const [packed] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dir], root));
    assert.deepEqual(packed.files.map(x => x.path).sort(), ['CHANGELOG.md', 'LICENSE', 'README.md', 'package.json', 'src/index.d.ts', 'src/index.mjs'].sort());
    assert.ok(packed.size <= 30000, 'packed artifact exceeds the 30 kB candidate budget');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', resolve(dir, packed.filename)]);
    const installed = JSON.parse(readFileSync(join(dir, 'node_modules/@ehven/http-response-header-policy/package.json'), 'utf8'));
    assert.equal(Object.keys(installed.dependencies ?? {}).length, 0);
    writeFileSync(join(dir, 'consumer.mjs'), `import assert from 'node:assert/strict';
import {createResponseHeaderPolicy} from '@ehven/http-response-header-policy';
const policy=createResponseHeaderPolicy({headers:{'x-frame-options':{action:'enforce',value:'SAMEORIGIN'}}});
const response=policy.apply(new Response('packed consumer'));
assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN');
assert.equal(await response.text(),'packed consumer');
console.log('PACKED_CONSUMER_PASSED');`);
    assert.match(run(process.execPath, ['consumer.mjs']), /PACKED_CONSUMER_PASSED/);
    writeFileSync(join(dir, 'consumer.ts'), `import {createResponseHeaderPolicy, type PolicyOptions} from '@ehven/http-response-header-policy';
const config:PolicyOptions={headers:{'x-test':{action:'enforce',value:'typed'}}};
const output:Response=createResponseHeaderPolicy(config).apply(new Response());
output.headers.get('x-test');
// @ts-expect-error invalid actions must be rejected by the distributed types
createResponseHeaderPolicy({headers:{'x-test':{action:'append',value:'bad'}}});`);
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.ts']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
