'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const signatures = {"@expo/metro-file-map@56.0.4": "d84d9441db0dceb5207d320ba2a2265bed436a91ae14b9d45eb135cf0f6faba2", "metro-file-map@0.84.5": "fd54d0713d2066eb474652dcdf3f88ff67f66d84600d1d8013ecbf6c7fdc3c47", "metro-file-map@0.84.4": "fd54d0713d2066eb474652dcdf3f88ff67f66d84600d1d8013ecbf6c7fdc3c47"};
const root = path.resolve(__dirname, '..');
const lock = require(path.join(root, 'package-lock.json'));
const allowed = {"@expo/metro-file-map": ["56.0.4"], "metro-file-map": ["0.84.4", "0.84.5"]};
const consumers = Object.entries(lock.packages).filter(([key]) => /(?:^|\/)node_modules\/(?:@expo\/metro-file-map|metro-file-map)$/.test(key));
assert.ok(consumers.length > 0, 'No Metro consumers found');
function scripts(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry => entry.isDirectory()
    ? scripts(path.join(dir,entry.name)) : /\.(?:js|cjs|mjs)$/.test(entry.name) ? [path.join(dir,entry.name)] : []);
}
for (const [key, metadata] of consumers) {
  const pkg = path.join(root, key);
  const manifest = require(path.join(pkg, 'package.json'));
  assert.equal(manifest.version, metadata.version);
  assert.ok(allowed[manifest.name]?.includes(manifest.version), 'Reverify Metro consumer before upgrading '+manifest.name+' '+manifest.version);
  const source = manifest.name.startsWith('@expo/') ? 'build' : 'src';
  const common = path.join(pkg,source,'watchers/common.js');
  const imports = scripts(path.join(pkg,source)).filter(file => /require\(["']micromatch["']\)/.test(fs.readFileSync(file,'utf8')));
  assert.deepEqual(imports, [common], 'Unexpected Metro matcher consumer');
  const text = fs.readFileSync(common,'utf8');
  assert.equal(createHash('sha256').update(text).digest('hex'), signatures[manifest.name+'@'+manifest.version], 'Metro watcher consumer changed: review adapter contract');
  const access = [...text.matchAll(/(?:micromatch(?:_1)?(?:\.default)?)[.]([a-zA-Z]+)\s*\(/g)].map(match => match[1]);
  assert.deepEqual(access,['some','some'],'Metro matcher API changed');
  const requireHere = createRequire(common);
  assert.equal(requireHere('micromatch/package.json').name, '@savingkc/metro-matcher');
  assert.deepEqual(Object.keys(requireHere('micromatch')), ['some']);
  const { includedByGlob } = requireHere(common);
  assert.equal(includedByGlob('f',['**/*.{ts,tsx}'],false,'src/app.tsx'),true);
  assert.equal(includedByGlob('f',['**/*.tsx'],false,'src/app.txt'),false);
  assert.equal(includedByGlob('f',[],false,'src/.hidden'),false);
  assert.equal(includedByGlob('f',[],true,'src/.hidden'),true);
  assert.equal(includedByGlob('d',['**/*.tsx'],false,'src/folder'),true);
  assert.equal(includedByGlob('l',['**/*.tsx'],false,'.hidden'),false);
  // Preserve some's OR semantics: a negative pattern is a separate predicate.
  assert.equal(includedByGlob('f',['**/*.tsx','!**/*.test.tsx'],false,'app.test.tsx'),true);
}
assert.ok(!Object.keys(lock.packages).some(key => /(?:^|\/)node_modules\/braces$/.test(key)), 'Vulnerable parser returned');
for (const [key, metadata] of Object.entries(lock.packages)) {
  if (/(?:^|\/)node_modules\/micromatch$/.test(key)) assert.equal(metadata.link,true,'Upstream micromatch chain returned');
}
console.log(`Metro ${consumers.length} consumers, local resolution, predicates and parser graph verified`);
