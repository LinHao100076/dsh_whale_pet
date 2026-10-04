import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('fork package and runtime identifiers are isolated from dsh-pet-desktop', () => {
  const packageJson = JSON.parse(read('../../package.json')) as { name: string };
  const patch = read('../../cordis.patch.yml');
  const client = read('../client/index.ts');
  const host = read('./index.ts');
  const storage = read('./storage-paths.ts');
  const electronMain = read('../../runtime/electron-helper/main.js');
  const helperPackage = JSON.parse(read('../../runtime/electron-helper/package.json')) as { name: string };

  assert.equal(packageJson.name, 'dsh-pet-desktop');
  assert.match(patch, /id:\s*dsh-pet-desktop/);
  assert.match(patch, /name:\s*'dsh-pet-desktop'/);
  assert.match(client, /id:\s*'dsh-pet-desktop'/);
  assert.match(host, /const ROUTE_PREFIX = '\/dsh-pet-desktop-7340'/);
  assert.match(host, /join\(dshHome, 'dsh-pet-desktop'\)/);
  assert.match(storage, /DESKTOP_APP_NAME = 'dsh-pet-desktop-electron-helper'/);
  assert.match(electronMain, /app\.setName\('dsh-pet-desktop-electron-helper'\)/);
  assert.equal(helperPackage.name, 'dsh-pet-desktop-electron-helper');
});
