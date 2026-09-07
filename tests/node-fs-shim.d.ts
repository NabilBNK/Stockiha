/**
 * Minimal ambient declaration for the one Node built-in this test file
 * needs. The project has no @types/node dependency (nothing else here reads
 * a file synchronously by path), so TypeScript can't resolve `node:fs`
 * on its own; this is a narrower fix than adding a project-wide dependency
 * for a single test file.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
