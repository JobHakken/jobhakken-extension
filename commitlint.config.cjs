// Conventional Commits, mirrored from the monorepo (JobHakken/JobHakken) so history
// reads the same across repos. Enforced by the husky commit-msg hook.
// .cjs because package.json is "type":"module" (a .js here would be parsed as ESM).
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 150],
  },
};
