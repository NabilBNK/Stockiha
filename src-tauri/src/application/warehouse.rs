//! Slice 1 Frontend MVP batch — application service for warehouse reads and
//! creation. Creation is gated on `MANAGE_WAREHOUSES` in the SQL function;
//! listing requires only a valid session.

use sqlx::PgPool;

use crate::error::AppError;

pub(crate) struct WarehouseItem {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub is_active: bool,
}

pub(crate) async fn create_warehouse(
    pool: &PgPool,
    session_token: &str,
    code: &str,
    name: &str,
) -> Result<i64, AppError> {
    let id: i64 = sqlx::query_scalar("SELECT inventory.create_warehouse($1, $2, $3)")
        .bind(session_token)
        .bind(code)
        .bind(name)
        .fetch_one(pool)
        .await
        .map_err(AppError::from_posting_error)?;
    Ok(id)
}

pub(crate) async fn list_warehouses(
    pool: &PgPool,
    session_token: &str,
) -> Result<Vec<WarehouseItem>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, String, bool)>(
        "SELECT id, code, name, is_active FROM inventory.list_warehouses($1)",
    )
    .bind(session_token)
    .fetch_all(pool)
    .await
    .map_err(AppError::from_posting_error)?;

    Ok(rows
        .into_iter()
        .map(|(id, code, name, is_active)| WarehouseItem {
            id,
            code,
            name,
            is_active,
        })
        .collect())
}
