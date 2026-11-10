// Which release tag a Mac build records inside the app (scripts/package-mac.mjs), so the app can tell a newer release
// (src/updates.ts). A build that names a tag behaves as that release for every copy that updates to it, so it must be that
// release's code: a checkout with changes of its own never takes its commit's tag.
import { execFileSync } from 'node:child_process';

export const versionTag = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The tag to record, or '' for none.
 * - `named`: CK_RELEASE_TAG, said outright (test builds are made this way); otherwise the highest version tag in `tags`, the
 *   tags on the commit being built (other tags, such as checkpoints, don't count).
 * - `changes`: what differs from that commit (`git status --porcelain`, one entry a line; ignored files such as the build's
 *   own output aren't listed). With any, the commit's tag isn't taken, and a release is refused.
 * - `release`: a release must have a tag and a checkout without changes.
 */
export function releaseTag({ release = false, named, tags = [], changes = [] }) {
  if (named !== undefined && named !== '' && !versionTag.test(named)) throw new Error(`CK_RELEASE_TAG ${named} isn’t a version tag like v0.5.0-preview.5.`);
  if (release && changes.length) throw new Error(`A release is built from a clean checkout of its tag, and this one has changes of its own:\n${changes.slice(0, 20).join('\n')}`);
  const tag = named ?? (changes.length ? '' : tags.find(name => versionTag.test(name)) ?? '');
  if (release && !tag) throw new Error('A release is built from its tag: tag the commit (or set CK_RELEASE_TAG), so the app can tell a newer release.');
  return tag;
}

const git = (...args) => { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); } catch { return []; } };

/** The tag for the checkout in the current folder. Without git (a copy of the source) there are no tags and nothing to compare with. */
export const releaseTagHere = (release, named = process.env.CK_RELEASE_TAG) => releaseTag({
  release, named,
  tags: git('-c', 'versionsort.suffix=-', 'tag', '--points-at', 'HEAD', '--sort=-version:refname'),
  changes: git('status', '--porcelain'),
});
