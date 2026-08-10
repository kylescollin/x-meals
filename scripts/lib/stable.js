/* Order-independent comparison for week documents.
 *
 * Firebase hands objects back with keys in its own order, and the git files
 * carry whatever order they were written in. A plain JSON.stringify comparison
 * of the two therefore always reports a difference, even when the data is
 * identical — which means "has this changed?" can never be answered honestly.
 */
'use strict';

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .filter(k => value[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + stable(value[k]))
      .join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

function same(a, b) { return stable(a) === stable(b); }

module.exports = { stable, same };
