#![allow(dead_code)]
mod application;
pub mod commands;
#[cfg_attr(not(test), allow(dead_code))]
mod domain;
mod error;
mod infrastructure;
pub mod state;

/// Installs a `tracing` subscriber so `RUST_LOG` (e.g. `RUST_LOG=sqlx=debug`)
/// actually produces output. Debug builds only: `tracing`/`tracing-core` were
/// already pulled in transitively by SQLx and Tauri, but nothing in this
/// binary ever installed a subscriber to consume their events, so every
/// SQLx-level connection diagnostic — including the specific error underneath
/// a `PoolTimedOut` — was silently discarded rather than merely filtered.
/// `try_init` rather than `init`: never panics if a subscriber is already set
/// (relevant for `cargo test`, where multiple test binaries can race).
#[cfg(debug_assertions)]
fn init_dev_tracing() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}

/// WS-K-3: if this process was launched with the literal `--provision-migrate`
/// argument, run the installer-only migration path and exit immediately —
/// never falling through to [`run`] (no Tauri, no window). Any other launch,
/// including a normal double-click with zero arguments, returns immediately
/// without doing anything, so ordinary app startup is byte-for-byte
/// unchanged. Deliberately checked in `main.rs` *before* `run()` is called,
/// not inside it: `run()` builds a `tauri::Builder`, which this path must
/// never touch. Kept even after WS-K-4 moved first-run setup into the app
/// itself: still useful as a standalone diagnostic/support tool, and nothing
/// about WS-K-4 requires removing it.
pub fn maybe_run_provision_migrate() {
    if !infrastructure::provision_cli::provision_migrate_requested(std::env::args()) {
        return;
    }
    let exit_code = infrastructure::provision_cli::run();
    std::process::exit(exit_code);
}

/// WS-K-4: resolve whether the embedded PostgreSQL server needs to be
/// started for this launch, and start it if so — honoring the stale-pid
/// safety check. Only relevant when `database.json` is what will resolve
/// the connection (never when the developer `STOCKIHA_DEV_DATABASE_URL` env
/// var is set: that always points at the Owner's own, separately-managed
/// dev cluster, which this app must never start, stop, or otherwise touch).
///
/// Best-effort by design: any failure here is not specially reported: the
/// unmodified WS-K-1 precedence/diagnostic path immediately below reports
/// the real connectivity failure through the exact same ten-state screen it
/// already had, so this function does not need a second reporting path of
/// its own — see the module-level note on why database_state_from_precedence
/// is left completely untouched.
async fn ensure_embedded_postgres_running(
    app_data_dir: Option<&std::path::Path>,
    resource_dir: Option<&std::path::Path>,
    handle: &std::sync::Arc<std::sync::Mutex<infrastructure::pg_process::EmbeddedPostgresHandle>>,
) {
    if std::env::var(infrastructure::db::DATABASE_URL_ENV).is_ok() {
        return;
    }
    let Some(app_data_dir) = app_data_dir else {
        return;
    };
    let Some(resource_dir) = resource_dir else {
        return;
    };

    let port = match infrastructure::local_config::load(app_data_dir) {
        infrastructure::local_config::LocalConfigOutcome::Loaded { options, .. } => {
            options.get_port()
        }
        _ => return, // no database.json yet — first-run setup screen handles this
    };

    let bin_dir = resource_dir.join("postgres").join("win64").join("bin");
    // Must match `embedded_setup::run_setup`'s own resolution exactly — see
    // `pg_process::resolve_pgdata_dir`'s doc comment for why this is not
    // always `<app_data_dir>/pgdata`.
    let pgdata = infrastructure::pg_process::resolve_pgdata_dir(app_data_dir);

    match infrastructure::pg_process::ensure_running(bin_dir.clone(), pgdata.clone(), port).await {
        Ok(child) => {
            let mut guard = handle.lock().unwrap_or_else(|p| p.into_inner());
            guard.bin_dir = bin_dir;
            guard.pgdata = pgdata;
            guard.port = port;
            if child.is_some() {
                guard.child = child;
            }
        }
        Err(detail) => {
            // Logged, not surfaced separately: the connection attempt
            // startup_diagnostic makes immediately after this will fail for
            // the same underlying reason and report it through the normal,
            // already-built diagnostic screen.
            tracing::error!("embedded PostgreSQL did not start: {detail}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    init_dev_tracing();

    let app = tauri::Builder::default()
        // WS-K-4: two app instances would mean two postgres.exe processes
        // writing the same data directory — the single most dangerous
        // failure mode in this design. Must be the FIRST plugin registered
        // (Tauri's own documented requirement): a second launch is
        // redirected into this callback (which simply focuses the existing
        // window) instead of ever reaching .setup() again. This is the
        // first of two independent layers; the second is the stale
        // postmaster.pid liveness check in ensure_embedded_postgres_running
        // above, which still protects against non-Stockiha-launch races
        // (e.g. a prior instance whose exit is still in flight).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.webview_windows().values().next() {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState {
            stage: "Slice 4".to_string(),
        })
        // WS-K-4: the embedded PostgreSQL child-process handle, managed for
        // the whole app lifetime so both the first-run setup command and
        // the shutdown hook below can reach the same `Child`. `Arc`-wrapped
        // (not a bare `Mutex`): `run_embedded_setup` needs to hold this
        // across `.await` points, and a bare `tauri::State<'_, Mutex<T>>`
        // reference borrowed that way defeats the `Send`-for-any-lifetime
        // proof `tauri::generate_handler!` needs to make — an owned,
        // cheaply-cloned `Arc` sidesteps the whole problem.
        .manage(std::sync::Arc::new(std::sync::Mutex::new(
            infrastructure::pg_process::EmbeddedPostgresHandle::new(
                std::path::PathBuf::new(),
                std::path::PathBuf::new(),
                0,
            ),
        )))
        // WS-K-1: `DatabaseState` construction moved from a pre-`.build()`
        // `.manage(block_on(...))` call (as it was before WS-K-1) into
        // `.setup()`. This is a forced, mechanical move, not a reorganization
        // of startup: the WS-K-1 precedence's second tier reads
        // `database.json` from Tauri's own `app_data_dir()`, and that API is
        // only reachable from an `AppHandle`/`&mut App` — i.e. only from
        // inside `.setup()` or a live `#[tauri::command]`, never before
        // `Builder::build()` has run. Nothing else about startup ordering
        // changed: this closure runs everything the old `.manage(block_on)`
        // call ran, in the same order, still on Tauri's own process-global
        // async runtime via the same `tauri::async_runtime::block_on` idiom.
        // WS-K-4 adds exactly one new step, before the existing ones: make
        // sure the embedded server is actually running before probing it —
        // nothing else starts it any more (no Windows service).
        .setup(|app| {
            use tauri::Manager;

            let app_data_dir = app.path().app_data_dir().ok();
            let resource_dir = app.path().resource_dir().ok();
            let pg_handle = app.state::<std::sync::Arc<
                std::sync::Mutex<infrastructure::pg_process::EmbeddedPostgresHandle>,
            >>();

            tauri::async_runtime::block_on(async {
                ensure_embedded_postgres_running(
                    app_data_dir.as_deref(),
                    resource_dir.as_deref(),
                    pg_handle.inner(),
                )
                .await;

                let state = infrastructure::db::database_state_from_precedence(app_data_dir);
                // Eager readiness proof: one real connection and `SELECT 1`,
                // so a broken configuration announces its true cause at
                // startup instead of degrading silently into "Service
                // unavailable" fifteen seconds later with an evidence-free
                // pool timeout.
                infrastructure::db::startup_diagnostic(&state).await;
                // WS-H-2: the recovery environment is supplied only by
                // run.bat. Report it missing here, by name, rather than
                // letting it surface later as a message that reads like a
                // broken feature.
                application::recovery::startup_environment_diagnostic();
                // WS-H-2: remove restore-drill databases stranded by a
                // previous run (e.g. a PostgreSQL backend crash that killed
                // the drill's connection before it could clean up). Safe
                // here: no drill of this process can be in flight yet.
                application::recovery::sweep_orphaned_restore_databases().await;
                app.manage(state);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_info,
            commands::db_health::check_db_health,
            commands::db_health::get_db_diagnostic,
            commands::embedded_setup::run_embedded_setup,
            commands::auth::login,
            commands::auth::logout,
            commands::iam::create_user,
            commands::iam::list_users,
            commands::iam::set_user_active,
            commands::iam::assign_user_role,
            commands::iam::create_role,
            commands::iam::list_permissions,
            commands::iam::list_roles,
            commands::iam::list_role_permissions,
            commands::iam::set_role_permissions,
            commands::stock_receipt::post_stock_receipt,
            commands::stock_adjustment::confirm_stock_adjustment,
            commands::stock_adjustment::list_stock_adjustment_units,
            commands::inventory::get_inventory_capabilities,
            commands::inventory::list_inventory_snapshot,
            commands::cash_sale::confirm_cash_sale,
            commands::credit_sale::confirm_credit_sale,
            commands::credit_sale::authorize_credit_override,
            commands::cash_session::open_cash_session,
            commands::cash_session::inspect_active_cash_session,
            commands::cash_session::inspect_current_cash_session,
            commands::cash_session::list_cash_denominations,
            commands::cash_session::begin_cash_session_close,
            commands::cash_session::cancel_cash_session_close,
            commands::cash_session::submit_cash_session_count,
            commands::cash_session::approve_cash_session_variance,
            commands::cash_session::suspend_cash_session,
            commands::cash_session::resume_cash_session,
            commands::cash_session::handover_cash_session,
            commands::cash_session::get_cash_session,
            commands::drawer::list_drawer_operation_policy,
            commands::drawer::update_drawer_operation_policy,
            commands::onboarding::get_historical_finance_setting,
            commands::onboarding::update_historical_finance_setting,
            commands::onboarding::get_inventory_corrections_setting,
            commands::onboarding::update_inventory_corrections_setting,
            commands::onboarding::create_historical_finance_batch,
            commands::onboarding::replace_historical_finance_batch_data,
            commands::onboarding::validate_historical_finance_batch,
            commands::onboarding::approve_historical_finance_batch,
            commands::onboarding::get_historical_finance_summary,
            commands::onboarding::create_historical_trade_batch,
            commands::onboarding::replace_historical_trade_batch_data,
            commands::onboarding::validate_historical_trade_batch,
            commands::onboarding::approve_historical_trade_batch,
            commands::onboarding::get_historical_trade_analytics,
            commands::onboarding::get_historical_product_mapping,
            commands::onboarding::get_historical_mapping_readiness,
            commands::onboarding::get_historical_report,
            commands::onboarding::get_historical_report_scope,
            commands::onboarding::apply_historical_product_alias_decisions,
            commands::onboarding::clear_historical_product_alias,
            commands::opening_state::get_opening_state_setting,
            commands::opening_state::update_opening_state_setting,
            commands::opening_state::create_opening_state_package,
            commands::opening_state::replace_opening_state_package_data,
            commands::opening_state::validate_opening_state_package,
            commands::opening_state::approve_opening_state_package,
            commands::opening_state::get_opening_state_package,
            commands::opening_state_lifecycle::get_opening_state_onboarding_status,
            commands::opening_state_lifecycle::set_opening_state_onboarding_choice,
            commands::opening_state_application::get_opening_state_application_context,
            commands::opening_state_application::update_opening_state_application_setting,
            commands::opening_state_application::apply_opening_state,
            commands::recovery::get_restore_verification_setting,
            commands::recovery::update_restore_verification_setting,
            commands::recovery::create_operator_backup,
            commands::recovery::validate_operator_backup,
            commands::recovery::verify_operator_backup_restore,
            commands::recovery::get_backup_destination_setting,
            commands::recovery::update_backup_destination_setting,
            commands::setup::get_setup_status,
            commands::setup::bootstrap_first_admin,
            commands::catalog::create_product,
            commands::catalog::list_products,
            commands::catalog::create_product_with_variants,
            commands::catalog::add_variant,
            commands::catalog::update_variant,
            commands::catalog::set_variant_active,
            commands::catalog::update_product,
            commands::catalog::create_attribute,
            commands::catalog::add_attribute_value,
            commands::catalog::list_attributes,
            commands::catalog::create_unit,
            commands::catalog::list_units,
            commands::catalog::set_variant_attributes,
            commands::catalog::add_variant_barcode,
            commands::catalog::remove_variant_barcode,
            commands::catalog::add_variant_alt_unit,
            commands::catalog::remove_variant_alt_unit,
            commands::catalog::set_variant_base_unit,
            commands::catalog::resolve_barcode,
            commands::catalog::list_catalog_products,
            commands::catalog::get_product_detail,
            // WS-D-2 — reference-data lifecycle, quick_create_product,
            // list_products_v2, and the widened update_product/update_variant
            // overloads (D-1 deliverable exposed to the app).
            commands::catalog::list_categories,
            commands::catalog::create_category,
            commands::catalog::rename_category,
            commands::catalog::set_category_active,
            commands::catalog::delete_category,
            commands::catalog::list_attributes_v2,
            commands::catalog::rename_attribute,
            commands::catalog::set_attribute_active,
            commands::catalog::delete_attribute,
            commands::catalog::list_attribute_values,
            commands::catalog::rename_attribute_value,
            commands::catalog::set_attribute_value_active,
            commands::catalog::delete_attribute_value,
            commands::catalog::list_units_v2,
            commands::catalog::rename_unit,
            commands::catalog::set_unit_active,
            commands::catalog::delete_unit,
            commands::catalog::quick_create_product,
            commands::catalog::list_products_v2,
            commands::catalog::update_product_v2,
            commands::catalog::update_variant_v2,
            commands::warehouse::create_warehouse,
            commands::warehouse::list_warehouses,
            commands::reference::list_fiscal_periods,
            commands::reference::get_open_fiscal_period,
            commands::reference::get_dashboard_summary,
            commands::documents::get_sale_document,
            commands::documents::list_sale_lines,
            commands::documents::list_document_jobs,
            commands::documents::list_printable_documents,
            commands::documents::list_business_documents,
            commands::documents::get_customer_document_payload,
            commands::finance::list_journals,
            commands::finance::get_journal_detail,
            commands::documents::generate_customer_document_pdf,
            commands::documents::enqueue_customer_reprint,
            commands::documents::get_business_document_detail,
            commands::documents::get_business_document_reports,
            commands::procurement::create_supplier,
            commands::procurement::update_supplier,
            commands::procurement::list_suppliers,
            commands::procurement::create_purchase_order_draft,
            commands::procurement::update_purchase_order_draft,
            commands::procurement::confirm_purchase_order,
            commands::procurement::cancel_purchase_order,
            commands::procurement::list_purchase_orders,
            commands::procurement::list_purchase_product_options,
            commands::procurement::get_purchase_order_detail,
            commands::procurement::confirm_purchase_receipt,
            commands::procurement::confirm_direct_purchase,
            commands::procurement::list_purchase_receipts,
            commands::procurement::list_purchase_receipt_lines,
            commands::procurement::get_procurement_capabilities,
            commands::procurement::allocate_landed_cost,
            commands::procurement::create_supplier_invoice_draft,
            commands::procurement::confirm_supplier_invoice,
            commands::procurement::list_supplier_invoices,
            commands::procurement::list_supplier_liabilities,
            commands::procurement::create_supplier_return_draft,
            commands::procurement::confirm_supplier_return,
            commands::procurement::post_supplier_payment,
            commands::procurement::list_supplier_returns,
            commands::procurement::list_supplier_payments,
            commands::customer::create_customer,
            commands::customer::update_customer,
            commands::customer::list_customers,
            commands::customer::get_customer_capabilities,
            commands::customer::get_customer_credit_summary,
            commands::customer::list_customer_ledger,
            commands::receivables::list_open_customer_invoices,
            commands::receivables::post_customer_payment,
            commands::receivables::list_refundable_customer_payments,
            commands::receivables::authorize_customer_payment_refund,
            commands::receivables::post_customer_refund,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // WS-K-4: PostgreSQL is a plain child process of this app now, not a
    // Windows service — nothing else stops it. `RunEvent::Exit` (not
    // `ExitRequested`, which is cancellable and can fire more than once) is
    // the definitive "the event loop is actually exiting" signal, covering
    // both a normal window close and a programmatic `AppHandle::exit`.
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            use tauri::Manager;
            let handle = app_handle
                .state::<std::sync::Arc<std::sync::Mutex<infrastructure::pg_process::EmbeddedPostgresHandle>>>();
            let mut guard = handle.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(mut child) = guard.child.take() {
                match infrastructure::pg_process::stop_postgres(
                    &guard.bin_dir,
                    &guard.pgdata,
                    infrastructure::embedded_setup::STOP_GRACEFUL_TIMEOUT,
                ) {
                    Ok(infrastructure::pg_process::StopOutcome::Immediate) => {
                        tracing::warn!(
                            "embedded PostgreSQL did not stop gracefully within {:?}; escalated to -m immediate",
                            infrastructure::embedded_setup::STOP_GRACEFUL_TIMEOUT
                        );
                    }
                    Ok(infrastructure::pg_process::StopOutcome::Fast) => {}
                    Err(err) => {
                        tracing::error!("failed to stop embedded PostgreSQL cleanly: {err}");
                    }
                }
                // pg_ctl stop -w already waited for the server to exit; this
                // reaps our own Child handle so no zombie/handle leak
                // remains on our side regardless.
                let _ = child.wait();
            }
        }
    });
}
