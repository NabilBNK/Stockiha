#!/usr/bin/env node
// WS-K-7 — offline licence issuing tool (plan §8.1). Node ESM, no npm
// dependencies: this is a thin wrapper around the already-installed Tauri
// CLI's `signer sign` command (the same tool WS-K-6 uses to sign update
// installers), building the `STKL1.<payload>.<sig>` key string the app's
// licence engine (`src-tauri/src/licence`) verifies.
//
// The licence-signing PRIVATE key and its password are the Owner's alone —
// see scripts/licence/README.md — and are read only from the two required
// environment variables below; this script never accepts them as
// command-line arguments and never prints their values.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MACHINE_CODE_RE = /^STKH(-[0-9A-HJKMNP-TV-Z]{4}){4}$/;
const LICENCE_ID_RE = /^[A-Z0-9-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    machineCode: null,
    licensee: null,
    expires: null,
    licenceId: null,
    notes: null,
    outDir: null,
    // Hidden, fixtures-only: overrides the computed `issued_on` date.
    issuedOn: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) fail(`${arg} requires a value`);
      return argv[i];
    };
    switch (arg) {
      case '--machine-code':
        out.machineCode = next();
        break;
      case '--licensee':
        out.licensee = next();
        break;
      case '--expires':
        out.expires = next();
        break;
      case '--licence-id':
        out.licenceId = next();
        break;
      case '--notes':
        out.notes = next();
        break;
      case '--out-dir':
        out.outDir = next();
        break;
      case '--issued-on':
        out.issuedOn = next();
        break;
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  return out;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function defaultLicenceId() {
  const now = new Date();
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `L-${date}-${time}`;
}

function validateArgs(args) {
  if (!args.machineCode) fail('--machine-code is required');
  args.machineCode = args.machineCode.trim().toUpperCase();
  if (!MACHINE_CODE_RE.test(args.machineCode)) {
    fail(`--machine-code ${args.machineCode} does not match STKH-XXXX-XXXX-XXXX-XXXX`);
  }

  if (!args.licensee) fail('--licensee is required');
  const licenseeTrimmed = args.licensee.trim();
  if (licenseeTrimmed.length < 1 || licenseeTrimmed.length > 120) {
    fail('--licensee must be 1-120 characters after trimming');
  }

  if (!args.expires) fail('--expires is required (YYYY-MM-DD or "permanent")');
  if (args.expires !== 'permanent' && !DATE_RE.test(args.expires)) {
    fail('--expires must be YYYY-MM-DD or "permanent"');
  }

  args.licenceId = args.licenceId ?? defaultLicenceId();
  if (!LICENCE_ID_RE.test(args.licenceId)) {
    fail('--licence-id must be 1-40 characters matching [A-Z0-9-]+');
  }

  if (args.notes && args.notes.length > 200) {
    fail('--notes must be at most 200 characters');
  }

  if (args.issuedOn && !DATE_RE.test(args.issuedOn)) {
    fail('--issued-on must be YYYY-MM-DD');
  }

  const home = process.env.USERPROFILE || process.env.HOME || '.';
  args.outDir = args.outDir ?? join(home, 'StockihaLicences', 'issued');

  return args;
}

function requireEnv() {
  const keyPath = process.env.STOCKIHA_LICENCE_KEY_PATH;
  const password = process.env.STOCKIHA_LICENCE_KEY_PASSWORD;
  if (!keyPath) fail('STOCKIHA_LICENCE_KEY_PATH is not set');
  if (password === undefined) fail('STOCKIHA_LICENCE_KEY_PASSWORD is not set');
  return { keyPath, password };
}

function buildPayload(args) {
  // Compact JSON, keys in the exact §3.1 order — the signature covers
  // these exact bytes, so field order here becomes part of what is signed
  // (harmless either way since the verifier deserializes by key, but kept
  // stable and readable for anyone inspecting a fixture file by eye).
  const payload = {
    v: 1,
    licence_id: args.licenceId,
    licensee: args.licensee.trim(),
    machine_code: args.machineCode,
    issued_on: args.issuedOn ?? todayLocalDate(),
    expires_on: args.expires === 'permanent' ? null : args.expires,
    edition: 'STANDARD',
    notes: args.notes ?? '',
  };
  return payload;
}

function base64UrlNoPad(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signPayload(payloadFile, keyPath, password) {
  const result = spawnSync(
    'npx',
    ['--yes', '@tauri-apps/cli', 'signer', 'sign', '-f', keyPath, payloadFile],
    {
      shell: true,
      encoding: 'utf8',
      env: {
        ...process.env,
        TAURI_SIGNING_PRIVATE_KEY_PATH: keyPath,
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
      },
    },
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || 'signer sign failed with no output');
    process.exit(1);
  }
}

function appendCsvRow(outDir, payload) {
  const csvPath = join(outDir, 'issued-licences.csv');
  const header = 'licence_id,licensee,machine_code,issued_on,expires_on,created_at_utc\n';
  if (!existsSync(csvPath)) {
    writeFileSync(csvPath, header, 'utf8');
  }
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const row = [
    payload.licence_id,
    payload.licensee,
    payload.machine_code,
    payload.issued_on,
    payload.expires_on ?? 'permanent',
    new Date().toISOString(),
  ]
    .map(escape)
    .join(',');
  appendFileSync(csvPath, `${row}\n`, 'utf8');
}

function main() {
  const args = validateArgs(parseArgs(process.argv.slice(2)));
  const { keyPath, password } = requireEnv();

  mkdirSync(args.outDir, { recursive: true });

  const payload = buildPayload(args);
  const payloadJson = JSON.stringify(payload);
  const payloadFile = join(args.outDir, `${payload.licence_id}.json`);
  writeFileSync(payloadFile, payloadJson, 'utf8');

  signPayload(payloadFile, keyPath, password);

  const sigFileBytes = readFileSync(`${payloadFile}.sig`);
  const payloadBytes = Buffer.from(payloadJson, 'utf8');

  const key = `STKL1.${base64UrlNoPad(payloadBytes)}.${base64UrlNoPad(sigFileBytes)}`;

  const keyFile = join(args.outDir, `${payload.licence_id}.txt`);
  writeFileSync(keyFile, `${key}\n`, 'utf8');

  appendCsvRow(args.outDir, payload);

  console.log('='.repeat(72));
  console.log(key);
  console.log('='.repeat(72));
  console.log(`Written to: ${keyFile}`);
}

// Only run when invoked directly (not when imported, e.g. by a future test).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
