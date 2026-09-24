//! WS-K-7 — the enforcement gate (plan §6). One central check wrapping the
//! whole `invoke_handler` in `lib.rs` (plan §6.1): impossible to forget in a
//! single command, and it fails closed — a new command nobody classified is
//! blocked in read-only mode until it is deliberately added to
//! [`ALLOWED_IN_READ_ONLY`].

use super::LicenceMode;

/// `true` when `command` must be rejected under `mode`. Unknown commands are
/// blocked in read-only mode (fail closed); in `Full` mode nothing is
/// blocked (plan §6.2).
pub(crate) fn is_blocked(command: &str, mode: LicenceMode) -> bool {
    mode == LicenceMode::ReadOnly && !ALLOWED_IN_READ_ONLY.contains(&command)
}

/// The exact list from plan §6.3. Every other registered command is
/// blocked in read-only mode. Changing this list is an Architect decision
/// (plan §PART 18 item 5) — see [`tests::every_registered_command_is_classified`]'s
/// assertion message.
pub(crate) const ALLOWED_IN_READ_ONLY: &[&str] = &[
    // Licence, app, setup, update, session.
    "get_licence_status",
    "activate_licence",
    "remove_licence",
    "refresh_licence_status",
    "get_app_info",
    "check_db_health",
    "get_db_diagnostic",
    "run_embedded_setup",
    "run_safe_database_upgrade",
    "get_update_policy",
    "prepare_for_update_install",
    "resume_after_failed_update_install",
    "login",
    "logout",
    "get_setup_status",
    "bootstrap_first_admin",
    // Backup and recovery (data protection must always work).
    "get_restore_verification_setting",
    "update_restore_verification_setting",
    "create_operator_backup",
    "validate_operator_backup",
    "verify_operator_backup_restore",
    "get_backup_destination_setting",
    "update_backup_destination_setting",
    "get_recovery_mode",
    "get_recovery_capabilities",
    "get_backup_status",
    "list_backups",
    "copy_backup_to",
    "restore_backup_live",
    "inspect_backup_for_fresh_install",
    "restore_backup_fresh_install",
    "restart_after_recovery",
    "run_automatic_backup",
    // Ending the day (the drawer can always be closed and counted).
    "inspect_active_cash_session",
    "inspect_current_cash_session",
    "list_cash_denominations",
    "get_cash_session",
    "list_cash_movements",
    "get_cash_session_policy",
    "get_cash_capabilities",
    "get_session_report",
    "list_session_sales",
    "begin_cash_session_close",
    "cancel_cash_session_close",
    "submit_cash_session_count",
    "approve_cash_session_variance",
    "suspend_cash_session",
    "resume_cash_session",
    // Printing and saving files (reprints and PDFs of existing data).
    "print_raw_receipt",
    "save_binary_file",
    "generate_customer_document_pdf",
    "enqueue_customer_reprint",
    "get_printing_settings",
    "get_company_logo",
    // Reads.
    "list_users",
    "list_permissions",
    "list_roles",
    "list_role_permissions",
    "list_stock_adjustment_units",
    "get_inventory_capabilities",
    "list_inventory_snapshot",
    "list_drawer_operation_policy",
    "get_historical_finance_setting",
    "get_inventory_corrections_setting",
    "get_historical_finance_summary",
    "get_historical_trade_analytics",
    "get_historical_product_mapping",
    "get_historical_mapping_readiness",
    "get_historical_report",
    "get_historical_report_scope",
    "get_opening_state_setting",
    "get_opening_state_package",
    "get_opening_state_onboarding_status",
    "get_opening_state_application_context",
    "list_products",
    "list_attributes",
    "list_units",
    "resolve_barcode",
    "list_catalog_products",
    "get_product_detail",
    "list_categories",
    "list_attributes_v2",
    "list_attribute_values",
    "list_units_v2",
    "list_products_v2",
    "list_warehouses",
    "list_fiscal_periods",
    "get_open_fiscal_period",
    "get_dashboard_summary",
    "get_sale_document",
    "list_sale_lines",
    "list_document_jobs",
    "list_printable_documents",
    "list_business_documents",
    "get_customer_document_payload",
    "list_journals",
    "get_journal_detail",
    "search_journals",
    "get_business_document_detail",
    "get_business_document_reports",
    "search_business_documents",
    "list_suppliers",
    "list_purchase_orders",
    "list_purchase_product_options",
    "get_purchase_order_detail",
    "list_purchase_payment_status",
    "list_purchase_payments",
    "list_supplier_balances",
    "list_purchase_returnable_lines",
    "list_purchase_returns",
    "list_purchase_receipts",
    "list_purchase_receipt_lines",
    "get_procurement_capabilities",
    "list_supplier_invoices",
    "list_supplier_liabilities",
    "list_supplier_returns",
    "list_supplier_payments",
    "list_customers",
    "get_customer_capabilities",
    "get_customer_credit_summary",
    "list_customer_ledger",
    "list_open_customer_invoices",
    "list_refundable_customer_payments",
];

#[cfg(test)]
mod tests {
    use super::*;

    /// Every command name actually registered in `lib.rs`'s
    /// `generate_handler!` block, extracted from the source text itself
    /// (no `regex` dependency: this crate's convention is to avoid a new
    /// dependency without concrete need, and matching
    /// `commands::<module>::<name>,` is simple enough by hand).
    fn registered_commands() -> Vec<String> {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let lib_rs = std::fs::read_to_string(format!("{manifest_dir}/src/lib.rs"))
            .expect("src/lib.rs must be readable");

        let mut names = Vec::new();
        for line in lib_rs.lines() {
            let trimmed = line.trim();
            let Some(after) = trimmed.strip_prefix("commands::") else {
                continue;
            };
            // `<module>::<function>,` possibly with a trailing line comment
            // stripped already by nothing here — this file has none inside
            // the handler list, so a plain `,`/whitespace trim suffices.
            let Some((_module, rest)) = after.split_once("::") else {
                continue;
            };
            let name = rest.trim_end_matches(',').trim();
            if !name.is_empty()
                && name
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b == b'_' || b.is_ascii_digit())
            {
                names.push(name.to_owned());
            }
        }
        names
    }

    #[test]
    fn every_registered_command_is_classified() {
        let registered = registered_commands();

        for allowed in ALLOWED_IN_READ_ONLY {
            assert!(
                registered.iter().any(|r| r == allowed),
                "ALLOWED_IN_READ_ONLY names {allowed:?}, which is not a registered command \
                 in lib.rs's generate_handler! list — likely a typo"
            );
        }

        assert_eq!(
            registered.len(),
            216,
            "A command was added or removed: update licence::gate::ALLOWED_IN_READ_ONLY \
             deliberately (see WS-K-7 plan §6.3) and change this count."
        );
    }

    #[test]
    fn blocked_examples_are_blocked() {
        for command in [
            "confirm_cash_sale",
            "open_cash_session",
            "void_sale",
            "create_product",
            "save_printing_settings",
            "not_a_command",
        ] {
            assert!(
                is_blocked(command, LicenceMode::ReadOnly),
                "{command} must be blocked in ReadOnly mode"
            );
            assert!(
                !is_blocked(command, LicenceMode::Full),
                "{command} must never be blocked in Full mode"
            );
        }
    }

    #[test]
    fn allowed_examples_are_allowed() {
        for command in [
            "login",
            "activate_licence",
            "create_operator_backup",
            "submit_cash_session_count",
            "search_business_documents",
        ] {
            assert!(
                !is_blocked(command, LicenceMode::ReadOnly),
                "{command} must not be blocked in ReadOnly mode"
            );
        }
    }
}
