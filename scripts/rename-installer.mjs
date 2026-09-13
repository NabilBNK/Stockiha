// Renames Tauri's fixed `Stockiha_<semver>_x64-setup.exe` to carry the
// build marker instead — `Stockiha_WS-K-4.9-setup.exe` — so the Owner can
// tell installers apart on disk, not just after launching them. The marker
// is read from src/shared/version.ts, the same single source the dashboard
// and setup screen render, so the file name can never disagree with what
// the app shows. Runs after every `npm run tauri:build`.
import { readFileSync, readdirSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const versionSource = readFileSync('src/shared/version.ts', 'utf8');
const marker = versionSource.match(/APP_VERSION_MARKER\s*=\s*'([^']+)'/)?.[1];
if (!marker) throw new Error('APP_VERSION_MARKER not found in src/shared/version.ts');

const dir = join('src-tauri', 'target', 'release', 'bundle', 'nsis');
const built = readdirSync(dir).find((f) => /^Stockiha_\d+\.\d+\.\d+_x64-setup\.exe$/.test(f));
if (!built) throw new Error(`no freshly built installer found in ${dir}`);

const target = join(dir, `Stockiha_${marker}-setup.exe`);
if (existsSync(target)) unlinkSync(target);
renameSync(join(dir, built), target);
console.log(`installer: ${target}`);
