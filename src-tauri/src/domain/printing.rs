use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnqueuePrintJobPayload {
    pub document_id: i64,
    pub job_type: String, // 'THERMAL_RECEIPT' | 'PDF_INVOICE' | 'DRAWER_PULSE'
    pub format: String,   // 'ESC_POS_80MM' | 'PDF_A4' | 'PDF_A5'
    pub printer_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePrintJobStatusPayload {
    pub job_id: i64,
    pub status: String, // 'COMPLETED' | 'FAILED'
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintJobDto {
    pub id: i64,
    pub document_id: Option<i64>,
    pub document_number: Option<String>,
    pub document_type: Option<String>,
    pub job_type: String,
    pub format: String,
    pub status: String,
    pub printer_name: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}
