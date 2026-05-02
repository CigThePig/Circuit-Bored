export type AiSession = {
  turnTargets: Map<string, string>;
};

export function createAiSession(): AiSession {
  return { turnTargets: new Map() };
}
