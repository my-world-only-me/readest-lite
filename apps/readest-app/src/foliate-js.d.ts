// Type declarations for foliate-js (untyped JS module).
// foliate-js ships no .d.ts files; without these declarations TypeScript
// under moduleResolution:bundler cannot resolve the dynamic imports used by
// TTSController.ensureTimeline() (getSentences, textWalker) and the build
// fails with "Property 'getSentences' does not exist on type 'typeof
// import("foliate-js/tts")'". The actual runtime resolution works because
// next.config.mjs lists foliate-js in transpilePackages and pnpm links it
// as a workspace package; this file only teaches tsc the shapes.

declare module 'foliate-js/tts.js' {
  export interface SentenceEntry {
    range: Range;
    // foliate-js's getSentences yields { range, ... } — we only consume range.
    // Use a permissive index signature so future fields don't break us.
    [key: string]: unknown;
  }
  export function* getSentences(
    doc: Document,
    textWalker: unknown,
    nodeFilter?: unknown,
    granularity?: 'sentence' | 'word',
  ): Generator<SentenceEntry, void, unknown>;
}

declare module 'foliate-js/text-walker.js' {
  export const textWalker: unknown;
}
