#!/usr/bin/env node
// Commit messages of a pull request follow Conventional Commits
// (druid-internal/docs/plan-separation-test-prod-rssi.md, lot 2; CONTRIBUTING.md): the type tells what a
// release contains and feeds its CHANGELOG. Run by the CI on pull requests:
//   node scripts/release/check-commit-messages.cjs <base-ref> <head-ref>
// Without arguments: the commits of HEAD that are not on origin/main.
const { execFileSync } = require('child_process');

const TYPES = ['feat', 'fix', 'security', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'style', 'revert'];
const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([^()\\s][^()]*\\))?!?: \\S`);
// Merge commits of pull requests and of branch updates, and `git revert` messages.
const EXEMPT = /^(Merge |Revert ")/;

/** Problem with one commit subject, or null when it is valid. */
const checkSubject = (subject) => {
  if (EXEMPT.test(subject)) return null;
  if (!CONVENTIONAL.test(subject)) return `expected "<type>(<scope>): <summary>", type among ${TYPES.join(', ')}`;
  if (subject.length > 150) return `subject longer than 150 characters (${subject.length})`;
  return null;
};

module.exports = { checkSubject, TYPES };

if (require.main === module) {
  const [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2);
  const log = execFileSync('git', ['log', '--format=%h%x09%s', `${base}..${head}`]).toString().trim();
  const commits = log ? log.split('\n').map((l) => l.split('\t')) : [];
  let errors = 0;
  for (const [sha, subject] of commits) {
    const problem = checkSubject(subject);
    if (problem) {
      errors++;
      console.log(`KO ${sha} ${subject}\n   ${problem}`);
    }
  }
  console.log(`${commits.length} commit(s) checked, ${errors} invalid.`);
  if (errors) {
    console.log('Fix with `git rebase -i` (reword) before merging — see CONTRIBUTING.md.');
    process.exit(1);
  }
}
