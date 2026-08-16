/**
 * A local Vite dev server, started in-process.
 *
 * The capture runner and the browser live in the same environment, so nothing
 * outside this machine ever has to reach localhost. Starting Vite
 * programmatically (rather than spawning `npm run dev`) also means shutdown is
 * a promise rather than a signal race, which is what keeps `visual:review`
 * from leaving a server behind.
 */
import { createServer, type ViteDevServer } from "vite";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import { removeDir } from "./paths.ts";

export type VisualServer = {
  origin: string;
  root: string;
  close: () => Promise<void>;
};

/**
 * Serve `root` on an ephemeral loopback port.
 *
 * `configFile: false` is deliberate: the project's Vite config only declares
 * build inputs, and a baseline worktree may carry an older config. Ignoring it
 * makes the dev server identical for current and baseline checkouts.
 */
export async function startVisualServer(root: string): Promise<VisualServer> {
  const cacheDir = mkdtempSync(path.join(os.tmpdir(), "circuit-bored-vite-"));
  let server: ViteDevServer;
  try {
    server = await createServer({
      root,
      configFile: false,
      cacheDir,
      logLevel: "error",
      appType: "mpa",
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
    });
    await server.listen();
  } catch (error) {
    removeDir(cacheDir);
    throw error;
  }

  const address = server.httpServer?.address();
  const port = typeof address === "object" && address !== null ? address.port : null;
  if (port === null) {
    await server.close();
    removeDir(cacheDir);
    throw new Error(`Vite dev server for '${root}' did not report a port`);
  }

  return {
    origin: `http://127.0.0.1:${port}`,
    root,
    close: async () => {
      await server.close();
      removeDir(cacheDir);
    },
  };
}
