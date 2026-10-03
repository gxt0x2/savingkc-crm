import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import nextHelper from '@next/eslint-plugin-next/dist/utils/get-root-dirs.js';
const { getRootDirs } = nextHelper;
import { globSync } from './index.mjs';
const cases = JSON.parse(fs.readFileSync(new URL('./contract-cases.json',import.meta.url),'utf8'));

test('actual Next helper preserves the 130 reviewed filesystem contracts', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(),'savingkc-next-roots-'));
  const previous = process.cwd();
  try {
    for (const dir of ['packages/a/src/deep','packages/b/src','packages/long/src','packages/item1','packages/item2','packages/.hidden/sub','packages/x.y','packages/z9','links','literal{a}/src','packages/01','packages/02','1/a','2/b']) fs.mkdirSync(path.join(fixture,dir),{recursive:true});
    fs.symlinkSync('../packages/a',path.join(fixture,'links/a'),'dir');
    fs.symlinkSync('../packages/long',path.join(fixture,'links/long'),'dir');
    fs.symlinkSync('../packages/missing',path.join(fixture,'links/broken'),'dir');
    fs.writeFileSync(path.join(fixture,'packages/notes.txt'),'synthetic fixture');
    process.chdir(fixture);
    const resolve = value => Array.isArray(value) ? value.map(resolve) : value.replaceAll('$FIXTURE',fixture).replaceAll('$PARENT','../'+path.basename(fixture));
    for (const entry of cases) {
      const rootDir = resolve(entry.rootDir);
      const context = {cwd:fixture,settings:rootDir === '(default)' ? {} : {next:{rootDir}}};
      assert.deepEqual(getRootDirs(context),resolve(entry.expected),JSON.stringify(rootDir));
    }
  } finally { process.chdir(previous); fs.rmSync(fixture,{recursive:true,force:true}); }
});

test('unsupported API and excessive parser work fail explicitly', () => {
  assert.throws(()=>globSync('packages/*',{onlyDirectories:true,dot:true}),TypeError);
  assert.throws(()=>globSync(['packages/*'],{onlyDirectories:true}),TypeError);
  assert.throws(()=>globSync('{'.repeat(6000)+'a,b'+'}'.repeat(6000),{onlyDirectories:true}),/brace levels/);
  assert.throws(()=>globSync('a'.repeat(65537),{onlyDirectories:true}),/characters/);
  assert.throws(()=>globSync('{a,b}'.repeat(20),{onlyDirectories:true}),/expansion exceeds/);
});
