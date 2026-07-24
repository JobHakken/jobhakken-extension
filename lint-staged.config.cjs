// Runs on staged files at commit-time (via the husky pre-commit hook).
module.exports = {
  '*.ts': ['eslint --fix', 'prettier --write'],
  '*.{md,json,mjs,cjs,html,css,yml,yaml}': ['prettier --write'],
};
