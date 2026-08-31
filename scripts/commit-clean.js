/**
 * Create a commit from staged changes without Cursor co-author injection.
 * Usage: node scripts/commit-clean.js "commit message"
 */
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GIT = process.env.GIT_EXE || 'C:\\Program Files\\Git\\bin\\git.exe';
const msg = process.argv.slice(2).join(' ') || 'update';
const msgFile = path.join(os.tmpdir(), 'commit-clean-msg.txt');
fs.writeFileSync(msgFile, `${msg.replace(/\r?\n/g, '\n').trim()}\n`);

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'g8tsz',
  GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || '197989271+g8tsz@users.noreply.github.com',
  GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'g8tsz',
  GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || '197989271+g8tsz@users.noreply.github.com',
};

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', env, shell: true }).trim();
}

const parent = sh(`"${GIT}" rev-parse HEAD`);
const tree = sh(`"${GIT}" write-tree`);
const sha = sh(`"${GIT}" commit-tree ${tree} -p ${parent} -F "${msgFile}"`);
fs.unlinkSync(msgFile);
sh(`"${GIT}" reset --hard ${sha}`);
console.log(sh(`"${GIT}" log -1 --oneline`));
