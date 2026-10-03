'use strict';
const picomatch = require('picomatch');

// Metro's verified watcher consumer uses only micromatch.some. Preserve its
// per-pattern OR semantics (including negation), array coercion and options.
// The consumer guard deliberately rejects any future need for another API.
function some(list, patterns, options) {
  const items = [].concat(list);
  for (const pattern of [].concat(patterns)) {
    const match = picomatch(String(pattern), options);
    if (items.some(item => match(item))) return true;
  }
  return false;
}

module.exports = { some };
