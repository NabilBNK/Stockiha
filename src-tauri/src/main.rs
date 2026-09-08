// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WS-K-3: installer-only migration path. Exits internally and never
    // returns when `--provision-migrate` is present; a no-op otherwise, so
    // a normal launch (no arguments) falls straight through to `run()`.
    stockiha_lib::maybe_run_provision_migrate();
    stockiha_lib::run();
}
