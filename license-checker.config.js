module.exports = {
  // Only enforce licenses for production dependencies — devDeps don't ship
  // in the production Docker image (deploy/Dockerfile → prod target).
  excludeDev: true,
  excludePeer: true,
  excludeOptional: true,

  // Only fail on these copyleft / custom licenses that conflict with
  // commercial distribution. The --onlyAllow list in the CI workflow
  // defines the allowed set (MIT, Apache-2.0, BSD-3-Clause, ISC, Unlicense, …).
  failOn: [
    'GPL-2.0',
    'GPL-2.0-only',
    'GPL-2.0-or-later',
    'GPL-3.0',
    'GPL-3.0-only',
    'GPL-3.0-or-later',
    'AGPL-3.0',
    'AGPL-3.0-only',
    'AGPL-3.0-or-later',
    'LGPL-2.1',
    'LGPL-2.1-only',
    'LGPL-2.1-or-later',
    'LGPL-3.0',
    'LGPL-3.0-only',
    'LGPL-3.0-or-later',
  ],

  // Allowed licenses for commercial distribution.
  onlyAllow: [
    'MIT',
    'Apache-2.0',
    'Apache-2.0-Clang',
    'BSD-3-Clause',
    'ISC',
    'Unlicense',
    'CC0-1.0',
    '0BSD',
    'Python-2.0',
  ],
};
