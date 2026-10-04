//! Tauri IPC commands for WS-P-1 Paper Book operations.
//! Brief §11.

use serde_json::Value as JsonValue;
use tauri::State;

use crate::application::{self, paperbook};
use crate::error::IpcError;
use crate::infrastructure::db::{self, DatabaseState};

#[tauri::command]
pub(crate) async fn paperbook_get_settings(
    state: State<'_, DatabaseState>,
    session_token: String,
) -> Result<paperbook::PaperBookSettingsDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::get_settings(pool, &session_token)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_set_go_live_date(
    state: State<'_, DatabaseState>,
    session_token: String,
    date: String,
) -> Result<paperbook::PaperBookSettingsDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::set_go_live_date(pool, &session_token, &date)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_preview_import(
    state: State<'_, DatabaseState>,
    session_token: String,
    file_path: String,
) -> Result<paperbook::PaperBookPreviewDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::preview_import(pool, &session_token, &file_path)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_commit_import(
    state: State<'_, DatabaseState>,
    session_token: String,
    file_path: String,
    expected_sha256: String,
    warnings_acknowledged: bool,
) -> Result<paperbook::PaperBookImportResultDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::commit_import(
        pool,
        &session_token,
        &file_path,
        &expected_sha256,
        warnings_acknowledged,
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn paperbook_list_txns(
    state: State<'_, DatabaseState>,
    session_token: String,
    from: Option<String>,
    to: Option<String>,
    txn_type: Option<String>,
    paid: Option<String>,
    source: Option<String>,
    search: Option<String>,
    sort: Option<String>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<paperbook::PaperBookListResponse, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from_date = match from {
        Some(s) if !s.is_empty() => Some(application::parse_iso_date(&s).map_err(IpcError::from)?),
        _ => None,
    };
    let to_date = match to {
        Some(s) if !s.is_empty() => Some(application::parse_iso_date(&s).map_err(IpcError::from)?),
        _ => None,
    };
    paperbook::list_txns(
        pool,
        &session_token,
        from_date,
        to_date,
        txn_type.as_deref(),
        paid.as_deref(),
        source.as_deref(),
        search.as_deref(),
        sort.as_deref(),
        limit,
        offset,
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn paperbook_list_totals(
    state: State<'_, DatabaseState>,
    session_token: String,
    from: Option<String>,
    to: Option<String>,
    txn_type: Option<String>,
    paid: Option<String>,
    source: Option<String>,
    search: Option<String>,
) -> Result<paperbook::PaperBookTotalsDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    let from_date = match from {
        Some(s) if !s.is_empty() => Some(application::parse_iso_date(&s).map_err(IpcError::from)?),
        _ => None,
    };
    let to_date = match to {
        Some(s) if !s.is_empty() => Some(application::parse_iso_date(&s).map_err(IpcError::from)?),
        _ => None,
    };
    paperbook::list_totals(
        pool,
        &session_token,
        from_date,
        to_date,
        txn_type.as_deref(),
        paid.as_deref(),
        source.as_deref(),
        search.as_deref(),
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_get_txn(
    state: State<'_, DatabaseState>,
    session_token: String,
    id: i64,
) -> Result<paperbook::PaperBookTxnDetailDto, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::get_txn(pool, &session_token, id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_create_manual(
    state: State<'_, DatabaseState>,
    session_token: String,
    payload: JsonValue,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::create_manual(pool, &session_token, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_update_manual(
    state: State<'_, DatabaseState>,
    session_token: String,
    id: i64,
    payload: JsonValue,
) -> Result<i64, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::update_manual(pool, &session_token, id, payload)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_delete_manual(
    state: State<'_, DatabaseState>,
    session_token: String,
    id: i64,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::delete_manual(pool, &session_token, id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_autocomplete(
    state: State<'_, DatabaseState>,
    session_token: String,
    field: String,
    text: String,
    limit: Option<i32>,
) -> Result<Vec<String>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::autocomplete(pool, &session_token, &field, &text, limit)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_list_names(
    state: State<'_, DatabaseState>,
    session_token: String,
    field: String,
    search: Option<String>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<paperbook::PaperBookNamesResponse, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::list_names(
        pool,
        &session_token,
        &field,
        search.as_deref(),
        limit,
        offset,
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_name_suggestions(
    state: State<'_, DatabaseState>,
    session_token: String,
    field: String,
) -> Result<Vec<paperbook::PaperBookSuggestionDto>, IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::name_suggestions(pool, &session_token, &field)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_set_name_map(
    state: State<'_, DatabaseState>,
    session_token: String,
    field: String,
    raw_key: String,
    label: String,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::set_name_map(pool, &session_token, &field, &raw_key, &label)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_remove_name_map(
    state: State<'_, DatabaseState>,
    session_token: String,
    field: String,
    raw_key: String,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::remove_name_map(pool, &session_token, &field, &raw_key)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub(crate) async fn paperbook_dismiss_suggestion(
    state: State<'_, DatabaseState>,
    session_token: String,
    field: String,
    key_a: String,
    key_b: String,
) -> Result<(), IpcError> {
    let pool = db::pool_or_unavailable(state.inner()).map_err(IpcError::from)?;
    paperbook::dismiss_suggestion(pool, &session_token, &field, &key_a, &key_b)
        .await
        .map_err(IpcError::from)
}
