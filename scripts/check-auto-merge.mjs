import assert from 'node:assert/strict';
import fs from 'node:fs';
const yaml = fs.readFileSync(new URL('../.github/workflows/pr-auto-integration.yml', import.meta.url), 'utf8');
const script = yaml.split('          script: |\n')[1].split('\n  publish-after-auto-merge:')[0]
  .split('\n').map(line => line.slice(12)).join('\n');
const execute = new (Object.getPrototypeOf(async () => {}).constructor)('github', 'context', 'core', 'setTimeout', script);
const names = ['Node build', 'Docker build and CVE scan', 'Docker build runtime navigateur'];
async function scenario({ unstable = false, failure = false, missing = false, changed = false, draft = false, denied = false, merged = false, blocked = false } = {}) {
  let merges = 0, failures = 0, attempts = 0;
  const github = {
    graphql: async query => {
      if (query.includes('query(')) return { repository: { pullRequest: { id: 'fixture', autoMergeRequest: null } } };
      if (denied) throw new Error('permission denied');
      if (unstable) throw new Error('Pull request is in unstable status');
      return {};
    },
    paginate: async () => names.slice(missing ? 1 : 0).map(name => ({ name, status: 'completed', conclusion: failure ? 'failure' : 'success' })),
    rest: { checks: { listForRef() {} }, pulls: {
      get: async () => ({ data: { merged, state: 'open', draft, head: { sha: changed ? 'new' : 'head' } } }),
      merge: async args => {
        attempts++;
        assert.equal(args.sha, 'head');
        assert.equal(args.merge_method, 'squash');
        if (blocked) throw Object.assign(new Error('protected branch'), { status: 405 });
        merges++;
        return { data: { merged: true } };
      },
    } },
  };
  await execute(github, {repo:{owner:'example',repo:'example'},payload:{pull_request:{number:1,head:{sha:'head'}}}},
    {info() {}, setFailed() { failures++; }}, callback => callback());
  return {merges, failures, attempts};
}
assert.deepEqual(await scenario(), {merges:0, failures:0, attempts:0});
assert.deepEqual(await scenario({unstable:true}), {merges:1, failures:0, attempts:1});
for (const flag of ['failure','missing','changed','draft']) {
  assert.deepEqual(await scenario({unstable:true,[flag]:true}), {merges:0, failures:1, attempts:0});
}
assert.deepEqual(await scenario({merged:true}), {merges:0, failures:0, attempts:0});
assert.deepEqual(await scenario({unstable:true,blocked:true}), {merges:0, failures:1, attempts:60});
await assert.rejects(scenario({denied:true}), /permission denied/);
console.log('Auto-merge checks OK: retries, exact head, required builds, drafts and branch protection failures.');
