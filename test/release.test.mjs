import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'http-header-release-'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const name of pkg.files) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), readFileSync(join(root, name)));
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
};
const prepare = cwd => JSON.parse(execFileSync(process.execPath, [script, 'prepare'], { cwd, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }));

test('shared release preparation produces the exact ESM tarball and matching checksum asset', () => {
  const dir = fixture();
  try {
    const candidate = prepare(dir);
    assert.equal(candidate.name, '@ehven/http-response-header-policy');
    assert.equal(candidate.repository, 'ehven-consultants-npm-products/ehven-http-response-header-policy');
    assert.equal(candidate.tag, 'v0.1.0');
    assert.equal(candidate.assets.length, 2, 'conditional ESM exports are delivered inside the tarball');
    for (const asset of candidate.assets) assert.equal(sha(readFileSync(join(dir, 'release', asset.name))), asset.sha256);
    assert.match(readFileSync(join(dir, 'release', 'SHA256SUMS'), 'utf8'), new RegExp('^' + sha(readFileSync(join(dir, 'release', candidate.tarball))) + '  ' + candidate.tarball.replaceAll('.', '\\.') + '\\n$'));
    const names = execFileSync('tar', ['-tzf', join(dir, 'release', candidate.tarball)], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(names.length, 6);
    assert.ok(names.includes('package/src/index.mjs'));
    assert.ok(names.includes('package/src/index.d.ts'));
    assert.ok(!names.some(name => name.includes('scripts/') || name.includes('test/')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('release preparation rejects incomplete explicit payload inventories', () => {
  const dir = fixture();
  try {
    const path = join(dir, 'package.json');
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    pkg.files.push('missing-public-file.mjs');
    writeFileSync(path, JSON.stringify(pkg));
    assert.throws(() => prepare(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tampered release bytes are rejected before any provider operation', () => {
  const dir = fixture();
  try {
    const candidate = prepare(dir);
    writeFileSync(join(dir, 'release', candidate.tarball), 'tampered');
    for (const action of ['draft', 'stage']) {
      const result = spawnSync(process.execPath, [script, action], {
        cwd: dir, timeout: 10000,
        env: { PATH: '', HOME: dir }, encoding: 'utf8',
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Release preparation stopped/);
      assert.equal(result.stdout, '');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unrecognized CLI actions cannot publish either channel', () => {
  const result = spawnSync(process.execPath, [script, 'publish'], { cwd: root, timeout: 10000, encoding: 'utf8', env: { PATH: '', HOME: tmpdir() } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
});
