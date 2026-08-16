/**
 * The in-page contract between the Visual Lab and the headless capture runner.
 *
 * Declared once and imported by both sides so a change to the ready signal or
 * the apply call cannot compile on one half of the pipeline and not the other.
 */

export type VisualLabBridge = {
  /** Bumped when the contract changes shape. */
  readonly version: number;
  /** True only once the requested frame has actually been drawn. */
  ready: boolean;
  /** Non-null when the last request failed; capture must not screenshot. */
  error: string | null;
  /** Every scene id the lab can render, including the seed-inspection slot. */
  sceneIds: string[];
  /** Apply a capture query string and render one deterministic frame. */
  applyCapture: (search: string) => void;
  /** Natural pixel box of the capture stage, for viewport sizing. */
  captureSize: () => { width: number; height: number };
};

export const VISUAL_BRIDGE_VERSION = 1;

declare global {
  interface Window {
    __CIRCUIT_BORED_VISUAL__?: VisualLabBridge;
  }
}
