//! S4-001 customer-document PDF renderer.
//!
//! Renders CREDIT_SALE invoices and CUSTOMER_PAYMENT receipts from the
//! immutable JSON payload produced by `receivables.get_customer_document_payload`.
//! The browser is not involved: Typst runs in-process, with bundled fonts and
//! no filesystem/package/network reads, then the PDF is published atomically.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde_json::Value;
use typst::diag::{FileError, FileResult, SourceDiagnostic, Warned};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_layout::PagedDocument;
use typst_pdf::PdfOptions;

static AMIRI_REGULAR: &[u8] = include_bytes!("../pdf_proof/fonts/Amiri-Regular.ttf");
static TEMPLATE: &str = include_str!("template.typ");

pub(crate) struct RenderedCustomerPdf {
    pub bytes: Vec<u8>,
    pub document_kind: String,
    pub document_number: String,
}

pub(crate) enum CustomerPdfError {
    Validation(&'static str),
    Render(String),
    Export(String),
    Io(std::io::Error),
}

impl CustomerPdfError {
    pub(crate) fn diagnostic(&self) -> String {
        match self {
            CustomerPdfError::Validation(reason) => (*reason).to_string(),
            CustomerPdfError::Render(detail) | CustomerPdfError::Export(detail) => detail.clone(),
            CustomerPdfError::Io(err) => err.to_string(),
        }
    }

    pub(crate) const fn is_retryable(&self) -> bool {
        matches!(self, CustomerPdfError::Io(_))
    }

    fn code(&self) -> &'static str {
        match self {
            CustomerPdfError::Validation(_) => "CUSTOMER_PDF_VALIDATION",
            CustomerPdfError::Render(_) => "CUSTOMER_PDF_RENDER",
            CustomerPdfError::Export(_) => "CUSTOMER_PDF_EXPORT",
            CustomerPdfError::Io(_) => "CUSTOMER_PDF_IO",
        }
    }
}

impl std::fmt::Display for CustomerPdfError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

impl std::fmt::Debug for CustomerPdfError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CustomerPdfError({})", self.code())
    }
}

impl std::error::Error for CustomerPdfError {}

impl From<std::io::Error> for CustomerPdfError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

pub(crate) fn render_customer_document(
    payload: &Value,
) -> Result<RenderedCustomerPdf, CustomerPdfError> {
    let document_kind = required_string(payload, "document_kind")?;
    if document_kind != "CREDIT_SALE" && document_kind != "CUSTOMER_PAYMENT" {
        return Err(CustomerPdfError::Validation(
            "unsupported customer document kind",
        ));
    }

    let document_number = required_string(payload, "document_number")?;
    let document_date = required_string(payload, "document_date")?;
    let status = required_string(payload, "status")?;
    let posted_at = optional_string(payload.get("posted_at"));
    let customer = payload
        .get("customer")
        .and_then(Value::as_object)
        .ok_or(CustomerPdfError::Validation("customer snapshot is missing"))?;
    let customer_code = object_required_string(customer, "code")?;
    let customer_name = object_required_string(customer, "name")?;
    let customer_tax_id = object_optional_string(customer.get("tax_id"));
    let customer_address = object_optional_string(customer.get("address"));

    let (title, subtotal, total, due_date, payment_method, note, items, allocations) =
        if document_kind == "CREDIT_SALE" {
            let subtotal = required_string(payload, "subtotal")?;
            let total = required_string(payload, "total_amount")?;
            let due_date = required_string(payload, "due_date")?;
            let rows = payload.get("lines").and_then(Value::as_array).ok_or(
                CustomerPdfError::Validation("credit sale lines are missing"),
            )?;
            if rows.is_empty() {
                return Err(CustomerPdfError::Validation("credit sale has no lines"));
            }
            let mut rendered = String::new();
            for row in rows {
                rendered.push_str(&format!(
                    "(line: {}, name: {}, sku: {}, qty: {}, unit: {}, total: {}),",
                    typst_string(&scalar_string(row.get("line_number"))?),
                    typst_string(&required_string(row, "name")?),
                    typst_string(&required_string(row, "sku")?),
                    typst_string(&required_string(row, "quantity")?),
                    typst_string(&required_string(row, "unit_price")?),
                    typst_string(&required_string(row, "line_total")?),
                ));
            }
            (
                "Credit sale invoice".to_string(),
                subtotal,
                total,
                due_date,
                String::new(),
                String::new(),
                rendered,
                String::new(),
            )
        } else {
            let total = required_string(payload, "amount")?;
            let method = required_string(payload, "payment_method")?;
            let note = optional_string(payload.get("note"));
            let rows = payload.get("allocations").and_then(Value::as_array).ok_or(
                CustomerPdfError::Validation("payment allocations are missing"),
            )?;
            if rows.is_empty() {
                return Err(CustomerPdfError::Validation(
                    "customer payment has no allocations",
                ));
            }
            let mut rendered = String::new();
            for row in rows {
                rendered.push_str(&format!(
                    "(number: {}, date: {}, amount: {}),",
                    typst_string(&optional_string(row.get("invoice_document_number"))),
                    typst_string(&optional_string(row.get("invoice_document_date"))),
                    typst_string(&required_string(row, "allocated_amount")?),
                ));
            }
            (
                "Customer payment receipt".to_string(),
                String::new(),
                total,
                String::new(),
                method,
                note,
                String::new(),
                rendered,
            )
        };

    let dict = format!(
        "(kind: {kind}, title: {title}, number: {number}, date: {date}, status: {status}, posted_at: {posted}, customer_code: {customer_code}, customer_name: {customer_name}, customer_tax_id: {tax_id}, customer_address: {address}, subtotal: {subtotal}, total: {total}, due_date: {due_date}, payment_method: {payment_method}, note: {note}, items: ({items}), allocations: ({allocations}))",
        kind = typst_string(&document_kind),
        title = typst_string(&title),
        number = typst_string(&document_number),
        date = typst_string(&document_date),
        status = typst_string(&status),
        posted = typst_string(&posted_at),
        customer_code = typst_string(&customer_code),
        customer_name = typst_string(&customer_name),
        tax_id = typst_string(&customer_tax_id),
        address = typst_string(&customer_address),
        subtotal = typst_string(&subtotal),
        total = typst_string(&total),
        due_date = typst_string(&due_date),
        payment_method = typst_string(&payment_method),
        note = typst_string(&note),
        items = items,
        allocations = allocations,
    );

    let main = format!("{}\n#render-customer-document({})\n", TEMPLATE, dict);
    let world = CustomerPdfWorld::new(main);
    let Warned {
        output,
        warnings: _,
    } = typst::compile::<PagedDocument>(&world);
    let document = output.map_err(|diags| CustomerPdfError::Render(render_diagnostics(&diags)))?;
    if document.pages().is_empty() {
        return Err(CustomerPdfError::Render(
            "document produced zero pages".to_string(),
        ));
    }

    let bytes = typst_pdf::pdf(&document, &PdfOptions::default())
        .map_err(|diags| CustomerPdfError::Export(render_diagnostics(&diags)))?;

    Ok(RenderedCustomerPdf {
        bytes,
        document_kind,
        document_number,
    })
}

pub(crate) fn write_pdf_atomic(dest: &Path, bytes: &[u8]) -> Result<(), CustomerPdfError> {
    if bytes.is_empty() {
        return Err(CustomerPdfError::Validation("generated PDF is empty"));
    }

    let parent = dest.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;

    if dest.exists() {
        let existing = fs::read(dest)?;
        if existing == bytes {
            return Ok(());
        }
        return Err(CustomerPdfError::Validation(
            "generated destination already exists with different bytes",
        ));
    }

    let file_name =
        dest.file_name()
            .and_then(|name| name.to_str())
            .ok_or(CustomerPdfError::Validation(
                "generated destination has no file name",
            ))?;
    let tmp: PathBuf = parent.join(format!(
        ".{file_name}.tmp-{}-{}",
        std::process::id(),
        next_counter()
    ));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_all()?;
        Ok(())
    })();

    if let Err(err) = write_result {
        let _ = fs::remove_file(&tmp);
        return Err(CustomerPdfError::Io(err));
    }

    if let Err(err) = fs::rename(&tmp, dest) {
        let _ = fs::remove_file(&tmp);
        return Err(CustomerPdfError::Io(err));
    }
    Ok(())
}

fn required_string(value: &Value, key: &str) -> Result<String, CustomerPdfError> {
    let value = value.get(key).ok_or(CustomerPdfError::Validation(
        "required document field is missing",
    ))?;
    let result = scalar_string(Some(value))?;
    if result.trim().is_empty() {
        return Err(CustomerPdfError::Validation(
            "required document field is blank",
        ));
    }
    Ok(result)
}

fn object_required_string(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<String, CustomerPdfError> {
    let result = scalar_string(object.get(key))?;
    if result.trim().is_empty() {
        return Err(CustomerPdfError::Validation(
            "required customer snapshot field is blank",
        ));
    }
    Ok(result)
}

fn optional_string(value: Option<&Value>) -> String {
    scalar_string(value).unwrap_or_default()
}

fn object_optional_string(value: Option<&Value>) -> String {
    optional_string(value)
}

fn scalar_string(value: Option<&Value>) -> Result<String, CustomerPdfError> {
    match value {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::String(value)) => Ok(value.clone()),
        Some(Value::Number(value)) => Ok(value.to_string()),
        Some(Value::Bool(value)) => Ok(value.to_string()),
        _ => Err(CustomerPdfError::Validation(
            "document field must be scalar",
        )),
    }
}

fn typst_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

fn render_diagnostics(diags: &[SourceDiagnostic]) -> String {
    diags
        .iter()
        .map(|diag| diag.message.to_string())
        .collect::<Vec<_>>()
        .join("; ")
}

fn next_counter() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

struct CustomerPdfWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    main_id: FileId,
    main: Source,
}

impl CustomerPdfWorld {
    fn new(main_text: String) -> Self {
        let mut fonts: Vec<Font> = typst_assets::fonts()
            .flat_map(|data| Font::iter(Bytes::new(data)))
            .collect();
        fonts.extend(Font::iter(Bytes::new(AMIRI_REGULAR)));
        let book = FontBook::from_fonts(&fonts);
        let virtual_path = VirtualPath::new("customer-document.typ").expect("static path is valid");
        let main_id = FileId::new(RootedPath::new(VirtualRoot::Project, virtual_path));
        let main = Source::new(main_id, main_text);
        Self {
            library: LazyHash::new(Library::builder().build()),
            book: LazyHash::new(book),
            fonts,
            main_id,
            main,
        }
    }
}

impl World for CustomerPdfWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.main_id
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main_id {
            Ok(self.main.clone())
        } else {
            Err(FileError::NotFound(PathBuf::from("<unavailable>")))
        }
    }

    fn file(&self, _id: FileId) -> FileResult<Bytes> {
        Err(FileError::NotFound(PathBuf::from("<unavailable>")))
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn renders_credit_invoice_and_payment_receipt() {
        let invoice = json!({
            "document_kind": "CREDIT_SALE",
            "document_number": "CR-2026-000001",
            "status": "POSTED",
            "document_date": "2026-07-31",
            "posted_at": "2026-07-31T10:00:00Z",
            "customer": {"code":"CUS-000001","name":"عميل Test","tax_id":"NIF-1","address":"Alger"},
            "subtotal": "1500.00",
            "total_amount": "1500.00",
            "due_date": "2026-08-30",
            "lines": [{"line_number":1,"sku":"SKU-1","name":"Café","quantity":"1","unit_price":"1500.00","line_total":"1500.00"}]
        });
        let payment = json!({
            "document_kind": "CUSTOMER_PAYMENT",
            "document_number": "CP-2026-000001",
            "status": "POSTED",
            "document_date": "2026-07-31",
            "posted_at": "2026-07-31T11:00:00Z",
            "customer": {"code":"CUS-000001","name":"Client","tax_id":null,"address":null},
            "payment_method":"CASH",
            "amount":"500.00",
            "note":"Part payment",
            "allocations":[{"invoice_document_number":"CR-2026-000001","invoice_document_date":"2026-07-31","allocated_amount":"500.00"}]
        });

        let invoice_pdf = render_customer_document(&invoice).expect("invoice renders");
        let payment_pdf = render_customer_document(&payment).expect("payment renders");
        assert!(invoice_pdf.bytes.starts_with(b"%PDF-"));
        assert!(payment_pdf.bytes.starts_with(b"%PDF-"));
        assert_eq!(invoice_pdf.document_number, "CR-2026-000001");
        assert_eq!(payment_pdf.document_kind, "CUSTOMER_PAYMENT");
    }

    #[test]
    fn rejects_mutable_or_unsupported_payload_shapes() {
        let bad = json!({"document_kind":"BOGUS"});
        assert!(matches!(
            render_customer_document(&bad),
            Err(CustomerPdfError::Validation(_))
        ));
    }
}
