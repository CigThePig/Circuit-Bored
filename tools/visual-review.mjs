#!/usr/bin/env node
/**
 * Entry point for the visual-review pipeline.
 *
 * This file is plain JavaScript on purpose: the pipeline itself is TypeScript
 * executed by Node's built-in type stripping, and a `.ts` entry point could not
 * even be parsed on an older runtime. Checking the version here turns an
 * inscrutable syntax error into an actionable message.
 */
const MIN_MAJOR = 22;
const MIN_MINOR = 18;

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < MIN_MAJOR || (major === MIN_MAJOR && minor < MIN_MINOR)) {
  process.stderr.write(
    `The visual-review pipeline needs Node ${MIN_MAJOR}.${MIN_MINOR} or newer for built-in TypeScript support ` +
      `(running ${process.versions.node}).\n`,
  );
  process.exit(1);
}

const { main } = await import("./visual/cli.ts");

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`\nVisual review failed.\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
}
