/**
 * Baseline generation from real previous code.
 *
 * A stored reference PNG answers "does this match what someone once approved".
 * For agent-driven renderer work the more useful question is "what did this
 * exact scene look like before my edit", so the baseline is rendered from a
 * detached git worktree at the merge-base (or an explicit ref). Stored
 * baselines are still supported implicitly: whatever sits in `baseline/` is
 * reused until the base commit changes or a refresh is requested.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDir, removeDir } from "./paths.ts";

/**
 * Files copied from the working tree into the baseline worktree.
 *
 * The point of a baseline is to compare *renderer* code, so `src/` is never
 * touched. The capture harness itself must be the current one, otherwise a
 * base commit from before this pipeline existed could not be captured at all.
 */
export const HARNESS_OVERLAY = ["visual-lab.html", "tools/visual-lab.ts", "tools/visual"] as const;

const CANDIDATE_BASE_REFS = ["origin/main", "main", "origin/master", "master", "origin/HEAD"];

export type BaseRef = {
  /** What the caller asked for, or "auto". */
  requested: string;
  /** The ref the base commit was derived from. */
  resolvedFrom: string;
  sha: string;
  shortSha: string;
  subject: string;
};

export type HeadRef = {
  sha: string;
  shortSha: string;
  branch: string;
  dirty: boolean;
};

export function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryGit(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

export function isGitRepository(repoRoot: string): boolean {
  return tryGit(["rev-parse", "--git-dir"], repoRoot) !== null;
}

export function describeHead(repoRoot: string): HeadRef {
  const sha = tryGit(["rev-parse", "HEAD"], repoRoot) ?? "unknown";
  return {
    sha,
    shortSha: sha.slice(0, 8),
    branch: tryGit(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot) ?? "unknown",
    dirty: (tryGit(["status", "--porcelain"], repoRoot) ?? "").length > 0,
  };
}

/**
 * Resolve the commit a baseline should be rendered from.
 *
 * An explicit ref is compared through its merge-base with HEAD, so a long-lived
 * branch shows only its own visual change rather than everything that landed on
 * the base branch meanwhile.
 */
export function resolveBaseRef(repoRoot: string, requested?: string): BaseRef | null {
  const candidates = requested ? [requested] : CANDIDATE_BASE_REFS;
  for (const candidate of candidates) {
    const resolved = tryGit(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], repoRoot);
    if (!resolved) continue;
    const mergeBase = tryGit(["merge-base", "HEAD", resolved], repoRoot) ?? resolved;
    const subject = tryGit(["log", "-1", "--format=%s", mergeBase], repoRoot) ?? "";
    return {
      requested: requested ?? "auto",
      resolvedFrom: candidate,
      sha: mergeBase,
      shortSha: mergeBase.slice(0, 8),
      subject,
    };
  }
  return null;
}

export type BaselineRecord = {
  sha: string;
  resolvedFrom: string;
  subject: string;
  generatedAt: string;
  caseIds: string[];
  /**
   * Scenes that exist on this branch but not at the base commit, so they were
   * deliberately not rendered. Recorded so a later run can tell "no baseline
   * because the scene is new" apart from "no baseline because the cache is
   * stale" and reuse the cache instead of re-rendering everything.
   */
  newSceneIds?: string[];
};

export function readBaselineRecord(baselineDir: string): BaselineRecord | null {
  const file = path.join(baselineDir, "baseline.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as BaselineRecord;
  } catch {
    return null;
  }
}

export function writeBaselineRecord(baselineDir: string, record: BaselineRecord): void {
  ensureDir(baselineDir);
  writeFileSync(path.join(baselineDir, "baseline.json"), `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Check out `sha` in a throwaway detached worktree, overlay the current capture
 * harness, hand the directory to `run`, and always clean up.
 *
 * The developer's working tree, index, and current branch are never touched:
 * `git worktree add --detach` only adds an entry to `.git/worktrees`.
 */
export async function withBaselineWorktree<T>(
  repoRoot: string,
  sha: string,
  run: (worktreeDir: string) => Promise<T>,
): Promise<T> {
  const parent = mkdtempSync(path.join(os.tmpdir(), "circuit-bored-baseline-"));
  const worktreeDir = path.join(parent, "worktree");
  git(["worktree", "add", "--detach", "--force", worktreeDir, sha], repoRoot);
  try {
    for (const entry of HARNESS_OVERLAY) {
      const source = path.join(repoRoot, entry);
      if (!existsSync(source)) continue;
      cpSync(source, path.join(worktreeDir, entry), { recursive: true });
    }
    return await run(worktreeDir);
  } finally {
    try {
      git(["worktree", "remove", "--force", worktreeDir], repoRoot);
    } catch {
      // A locked or already-removed worktree must not mask the real result.
    }
    tryGit(["worktree", "prune"], repoRoot);
    removeDir(parent);
  }
}
