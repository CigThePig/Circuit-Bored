/**
 * `visual:review` and friends.
 *
 * One command has to do the whole loop — render the previous code, render the
 * working tree, diff them, and write files an agent can open — otherwise the
 * feedback loop stays optional and gets skipped.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Browser } from "playwright";
import {
  describeHead,
  isGitRepository,
  readBaselineRecord,
  resolveBaseRef,
  withBaselineWorktree,
  writeBaselineRecord,
  type BaseRef,
} from "./baseline.ts";
import { captureCases, launchChromium } from "./capture.ts";
import { compareCaptures, rankByChange, writeComparisonIndex } from "./compare.ts";
import { artifactLayout, ensureDir, relativePosix, removeDir, repositoryRoot } from "./paths.ts";
import { writeReport } from "./report.ts";
import { buildSampleCases, VISUAL_REVIEW_CASES, type ReviewCase } from "./review-matrix.ts";
import { startVisualServer } from "./server.ts";

export type Command = "review" | "capture" | "baseline" | "compare" | "sample";

const COMMANDS: Command[] = ["review", "capture", "baseline", "compare", "sample"];

export type CliOptions = {
  command: Command;
  base?: string;
  useBaseline: boolean;
  refreshBaseline: boolean;
  sceneFilter: string[];
  outDir?: string;
  seeds: number;
  quiet: boolean;
};

export const USAGE = `Circuit Bored visual review

  node tools/visual-review.mjs <command> [options]

Commands
  review     Render the baseline, render the working tree, diff, and report (default)
  capture    Render the working tree only
  baseline   Render the baseline only
  compare    Diff and report from whatever is already captured
  sample     Render a deeper set of uncurated procedural seeds

Options
  --base <ref>          Baseline git ref (default: merge-base with origin/main)
  --no-baseline         Skip baseline rendering; capture and report only
  --refresh-baseline    Re-render the baseline even if one is already cached
  --scene <id,...>      Only cases whose scene id or case id starts with one of these
  --out <dir>           Artifact directory (default: artifacts/visual-review)
  --seeds <n>           Seeds per theme/profile for 'sample' (default: 3)
  --quiet               Only print the summary
  --help                Show this message
`;

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    command: "review",
    useBaseline: true,
    refreshBaseline: false,
    sceneFilter: [],
    seeds: 3,
    quiet: false,
  };
  const args = [...argv];
  if (args.length > 0 && !args[0].startsWith("-")) {
    const candidate = args.shift() as Command;
    if (!COMMANDS.includes(candidate)) {
      throw new Error(`Unknown command '${candidate}'. Expected one of: ${COMMANDS.join(", ")}`);
    }
    options.command = candidate;
  }
  while (args.length > 0) {
    const flag = args.shift()!;
    switch (flag) {
      case "--base":
        options.base = requireValue(flag, args.shift());
        break;
      case "--no-baseline":
        options.useBaseline = false;
        break;
      case "--refresh-baseline":
        options.refreshBaseline = true;
        break;
      case "--scene":
        options.sceneFilter.push(...requireValue(flag, args.shift()).split(",").map((value) => value.trim()).filter(Boolean));
        break;
      case "--out":
        options.outDir = requireValue(flag, args.shift());
        break;
      case "--seeds": {
        const value = Number(requireValue(flag, args.shift()));
        if (!Number.isFinite(value) || value < 1) throw new Error("--seeds expects a positive number");
        options.seeds = Math.round(value);
        break;
      }
      case "--quiet":
        options.quiet = true;
        break;
      default:
        throw new Error(`Unknown option '${flag}'.\n\n${USAGE}`);
    }
  }
  return options;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

export function selectCases(cases: readonly ReviewCase[], filter: readonly string[]): ReviewCase[] {
  if (filter.length === 0) return [...cases];
  const selected = cases.filter((entry) =>
    filter.some((needle) => entry.sceneId.startsWith(needle) || entry.id.startsWith(needle) || entry.dir === needle));
  if (selected.length === 0) {
    throw new Error(`No review cases matched: ${filter.join(", ")}`);
  }
  return selected;
}

function hasFiles(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).some((name) => name !== "baseline.json");
}

function formatDuration(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

export async function run(options: CliOptions, log: (message: string) => void): Promise<number> {
  const startedAt = Date.now();
  const repoRoot = repositoryRoot();
  const isSample = options.command === "sample";
  const layout = artifactLayout(repoRoot, options.outDir ?? (isSample ? path.join("artifacts", "visual-sample") : undefined));
  const allCases = isSample ? buildSampleCases(options.seeds) : VISUAL_REVIEW_CASES;
  const cases = selectCases(allCases, options.sceneFilter);
  const fullRun = options.sceneFilter.length === 0;
  const verbose = (message: string): void => {
    if (!options.quiet) log(message);
  };

  const head = isGitRepository(repoRoot) ? describeHead(repoRoot) : null;
  let base: (BaseRef & { captured: boolean }) | null = null;
  let baselineNote = "";

  const wantsBaseline = options.useBaseline
    && !isSample
    && (options.command === "review" || options.command === "baseline");
  if (isSample) {
    baselineNote = "Sampling renders current output only. These uncurated seeds exist to catch generation problems the six canonical seeds hide, not to be diffed.";
  } else if (wantsBaseline) {
    const resolved = resolveBaseRef(repoRoot, options.base);
    if (!resolved) {
      baselineNote = options.base
        ? `Baseline ref '${options.base}' could not be resolved, so only current captures were produced.`
        : "No base branch (origin/main, main, master) could be resolved, so only current captures were produced. Pass --base <ref> to choose one.";
    } else {
      base = { ...resolved, captured: false };
    }
  } else if (options.command === "compare") {
    // Compare never renders anything; it reports which baseline it found so a
    // stale one cannot be mistaken for a fresh comparison.
    const record = readBaselineRecord(layout.baseline);
    baselineNote = record
      ? `Compared against the baseline already on disk: ${record.resolvedFrom} @ ${record.sha.slice(0, 8)} ("${record.subject}"), rendered ${record.generatedAt}.`
      : "No baseline was found on disk, so this run reports current captures only. Run `npm run visual:baseline` first.";
  } else if (options.command === "capture") {
    baselineNote = "Capture-only run: current images were refreshed and re-compared against whatever baseline was already on disk.";
  } else {
    baselineNote = "Baseline rendering was skipped (--no-baseline).";
  }

  let browser: Browser | null = null;
  try {
    const needsBrowser = options.command !== "compare";
    if (needsBrowser) browser = await launchChromium();

    // ---- baseline -------------------------------------------------------
    if (base && browser) {
      const cached = readBaselineRecord(layout.baseline);
      const reusable = !options.refreshBaseline
        && cached?.sha === base.sha
        && hasFiles(layout.baseline)
        && cases.every((entry) => cached.caseIds.includes(entry.id));
      if (reusable) {
        base.captured = true;
        baselineNote = `Baseline reused from a previous run at ${base.shortSha} (${base.resolvedFrom}). Use --refresh-baseline to re-render it.`;
        verbose(`baseline: reusing cached captures at ${base.shortSha}`);
      } else {
        verbose(`baseline: rendering ${cases.length} cases at ${base.shortSha} (${base.resolvedFrom}) in a temporary worktree`);
        if (fullRun) removeDir(layout.baseline);
        ensureDir(layout.baseline);
        await withBaselineWorktree(repoRoot, base.sha, async (worktreeDir) => {
          const server = await startVisualServer(worktreeDir);
          try {
            await captureCases(browser!, {
              origin: server.origin,
              outDir: layout.baseline,
              cases,
              label: "baseline",
              onProgress: verbose,
            });
          } finally {
            await server.close();
          }
        });
        base.captured = true;
        writeBaselineRecord(layout.baseline, {
          sha: base.sha,
          resolvedFrom: base.resolvedFrom,
          subject: base.subject,
          generatedAt: new Date().toISOString(),
          caseIds: cases.map((entry) => entry.id),
        });
        baselineNote = `Baseline rendered from ${base.resolvedFrom} @ ${base.shortSha} ("${base.subject}") in a detached worktree. Your working tree was not modified.`;
      }
    }

    // ---- current --------------------------------------------------------
    if (browser && options.command !== "baseline") {
      if (fullRun) {
        removeDir(layout.current);
        removeDir(layout.compare);
      }
      ensureDir(layout.current);
      const server = await startVisualServer(repoRoot);
      try {
        verbose(`current: rendering ${cases.length} cases from the working tree`);
        await captureCases(browser, {
          origin: server.origin,
          outDir: layout.current,
          cases,
          label: "current",
          onProgress: verbose,
        });
      } finally {
        await server.close();
      }
    }

    if (options.command === "baseline") {
      log(`Baseline written to ${relativePosix(repoRoot, layout.baseline)} in ${formatDuration(startedAt)}.`);
      return 0;
    }

    // ---- compare and report --------------------------------------------
    const comparisons = compareCaptures(layout);
    const metricsFile = writeComparisonIndex(layout, comparisons);
    const { manifest, htmlFile, manifestFile } = writeReport({
      layout,
      mode: options.command,
      cases,
      comparisons,
      head,
      base,
      baselineNote: baselineNote || (base?.captured
        ? `Baseline rendered from ${base.resolvedFrom} @ ${base.shortSha}.`
        : "No baseline was available for this run."),
    });

    log("");
    log(`Visual review (${options.command}) finished in ${formatDuration(startedAt)}.`);
    log(`  cases     ${manifest.summary.cases}`);
    log(`  images    ${manifest.summary.images}`);
    log(`  changed   ${manifest.summary.changed}`);
    log(`  identical ${manifest.summary.identical}`);
    log(`  no base   ${manifest.summary.withoutBaseline}`);
    log("");
    const comparedAgainstBaseline = comparisons.some((entry) => entry.baseline !== null);
    log(`  current     ${relativePosix(repoRoot, layout.current)}/`);
    if (comparedAgainstBaseline) {
      const suffix = base?.captured ? `  (${base.resolvedFrom} @ ${base.shortSha})` : "";
      log(`  baseline    ${relativePosix(repoRoot, layout.baseline)}/${suffix}`);
      log(`  comparisons ${relativePosix(repoRoot, layout.compare)}/`);
    }
    log(`  report      ${relativePosix(repoRoot, htmlFile)}`);
    log(`  manifest    ${relativePosix(repoRoot, manifestFile)}`);
    log(`  metrics     ${relativePosix(repoRoot, metricsFile)}`);
    if (baselineNote) log(`\n  ${baselineNote}`);

    const ranked = rankByChange(comparisons).slice(0, 8);
    if (ranked.length > 0) {
      log("\n  Largest pixel changes (look at these first):");
      for (const entry of ranked) {
        log(`    ${(entry.metrics!.changedRatio * 100).toFixed(2).padStart(6)}%  ${entry.relativePath}`);
      }
    } else if (comparedAgainstBaseline) {
      log("\n  No pixel differences against the baseline. Either the change is not visual, or it did not reach these scenes.");
    }
    log("\n  Inspect the PNGs directly. Passing tests do not prove visual quality.");
    return 0;
  } finally {
    await browser?.close();
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  const options = parseArgs(argv);
  return run(options, (message) => process.stdout.write(`${message}\n`));
}
