use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintingSettingsDto {
    pub receipt_printing_enabled: bool,
    pub receipt_target: String,
    pub thermal_printer_name: Option<String>,
    pub thermal_columns: i16,
    pub shop_name: Option<String>,
    pub shop_address: Option<String>,
    pub shop_phone: Option<String>,
    pub receipt_footer: Option<String>,
    pub updated_at: String,
}
