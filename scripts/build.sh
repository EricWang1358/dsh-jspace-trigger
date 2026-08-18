#!/usr/bin/env bash
# Build/validation script for dsh-jspace-trigger.
#
# This plugin is dependency-free ESM, so there is no transpile step. The build
# exists to make a "build once, package reproducibly" contract explicit and to
# fail fast when the package entry is missing or broken. It also produces the
# packaged-file manifest (npm pack --dry-run) so reviewers can see exactly what
# ships.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"

echo "== dsh-jspace-trigger build =="
echo "node: $(node --version)"
echo "dir:  $here"

# 1. Entry points must exist and be syntactically valid ES modules.
for f in index.js index.d.ts src/index.js src/trigger-core.mjs src/skill-utils.mjs src/call-analysis.mjs; do
  if [ ! -f "$f" ]; then
    echo "error: required file missing: $f" >&2
    exit 1
  fi
done

node --input-type=module -e "import('$here/index.js').then(m => {
  if (typeof m.apply !== 'function' || typeof m.name !== 'string') throw new Error('bad plugin entry shape');
  console.log('entry ok:', m.name, m.inject.join(','));
})"

# 2. Test suite is the real validation gate.
npm test

# 3. Packaged-file manifest for review.
npm pack --dry-run
