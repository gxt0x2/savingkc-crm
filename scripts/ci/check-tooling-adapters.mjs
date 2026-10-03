import assert from 'node:assert/strict';
import * as rootAdapter from 'fast-glob';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const plugin = dirname(require.resolve('@next/eslint-plugin-next/package.json'));
assert.equal(require(join(plugin, 'package.json')).version, '16.3.8', 'Reverify Next consumer before upgrading');
const consumer = join(plugin, 'dist/utils/get-root-dirs.js');
assert.equal(createHash('sha256').update(readFileSync(consumer)).digest('hex'), '886677432990a735e5ebdfb345ff1cbd40e264f9947a8432eeeb254b3a926bde', 'Next glob consumer changed: review adapter API');
function scripts(dir) {
  return readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory()
    ? scripts(join(dir,entry.name)) : entry.name.endsWith('.js') ? [join(dir,entry.name)] : []);
}
const imports = scripts(join(plugin,'dist')).filter(file => /require\(["']fast-glob["']\)/.test(readFileSync(file,'utf8')));
assert.deepEqual(imports,[consumer], 'Unexpected fast-glob consumer');
const fromConsumer = createRequire(consumer);
assert.equal(fromConsumer('fast-glob/package.json').name, '@savingkc/next-root-glob');
assert.deepEqual(Object.keys(fromConsumer('fast-glob')), ['globSync']);
assert.equal(fromConsumer('fast-glob').globSync, rootAdapter.globSync, 'Root guard and Next must resolve the same adapter');
const lock = JSON.parse(readFileSync(new URL('../../package-lock.json',import.meta.url),'utf8'));
assert.ok(!Object.keys(lock.packages).some(key => /(?:^|\/)node_modules\/(?:braces|micromatch)$/.test(key)), 'Vulnerable parser chain returned');
console.log('Next tooling consumer, local resolution and parser graph verified');
