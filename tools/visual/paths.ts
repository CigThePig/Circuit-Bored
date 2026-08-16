/**
 * Artifact layout and path safety.
 *
 * Scene ids reach the filesystem, and a review matrix is meant to be edited
 * casually, so every path the pipeline writes is resolved through here and
 * checked to stay inside the artifact root.
 */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ARTIFACT_DIR_NAME = "artifacts";
export const REVIEW_DIR_NAME = "visual-review";

export type ArtifactLayout = {
  /** Repository root the pipeline runs against. */
  repoRoot: string;
  root: string;
  current: string;
  baseline: string;
  compare: string;
  report: string;
};

/** The repository root, derived from this file rather than the process cwd. */
export function repositoryRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function artifactLayout(repoRoot = repositoryRoot(), outDir?: string): ArtifactLayout {
  const root = outDir
    ? path.resolve(repoRoot, outDir)
    : path.join(repoRoot, ARTIFACT_DIR_NAME, REVIEW_DIR_NAME);
  return {
    repoRoot,
    root,
    current: path.join(root, "current"),
    baseline: path.join(root, "baseline"),
    compare: path.join(root, "compare"),
    report: path.join(root, "report"),
  };
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Resolve `segments` under `root`, refusing anything that would escape it.
 * A scene id containing `..` is a bug, never a reason to write outside the
 * artifact directory.
 */
export function resolveWithin(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside '${resolvedRoot}': ${segments.join("/")}`);
  }
  return target;
}

/** Repository-relative POSIX path, so manifests never leak machine paths. */
export function relativePosix(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

export function ensureFileDir(file: string): string {
  ensureDir(path.dirname(file));
  return file;
}
