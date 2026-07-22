// S0-007 — Fixed Typst proof template (French/Arabic PDF generation proof).
//
// This file contains ONLY layout. Every value — including all monetary and
// quantity strings — is computed and formatted authoritatively in Rust and
// passed in as the `doc` dictionary. No date, locale, or money logic lives
// here, so rendering is a pure function of `doc` and therefore deterministic.
//
// The Rust renderer appends a single `#render-proof(( ... ))` call with the
// serialized document data to the end of this source.

#let render-proof(doc) = {
  // Fixed, deterministic page geometry: ISO A4 portrait, uniform 20mm margin.
  set document(title: "Stockiha — PDF generation proof", author: "Stockiha")
  set page(width: 210mm, height: 297mm, margin: 20mm)
  // Latin/French text uses an OFL font from typst-assets; Arabic falls back to
  // the bundled OFL Amiri face. Fallback list is explicit and deterministic.
  set text(font: ("Libertinus Serif", "Amiri"), size: 11pt, lang: "fr")

  // Heading (Latin).
  text(size: 20pt, weight: "bold")[Stockiha]
  v(2pt)
  line(length: 100%, stroke: 0.5pt)
  v(6pt)

  // Bilingual subtitle: Latin (French) + Arabic (RTL, shaped by Amiri).
  grid(
    columns: (1fr, 1fr),
    align: (left, right),
    text(size: 12pt)[Justificatif de génération PDF],
    text(font: "Amiri", size: 13pt, lang: "ar")[إثبات توليد ملف PDF],
  )
  v(10pt)

  // Metadata: document number and date (values formatted in Rust).
  grid(
    columns: (auto, 1fr),
    row-gutter: 4pt,
    column-gutter: 8pt,
    [*Document n°:*], doc.number,
    [*Date:*], doc.date,
  )
  v(12pt)

  // Line-item table.
  table(
    columns: (1fr, auto, auto, auto),
    align: (left, right, right, right),
    stroke: 0.5pt,
    inset: 6pt,
    table.header(
      [*Désignation*], [*Qté*], [*P.U.*], [*Montant*],
    ),
    ..doc.items.map(it => (it.desc, it.qty, it.unit, it.line)).flatten(),
  )
  v(10pt)

  // Totals (values formatted in Rust; no arithmetic in the template).
  align(right)[
    #grid(
      columns: (auto, auto),
      row-gutter: 4pt,
      column-gutter: 12pt,
      align: (right, right),
      [Sous-total:], doc.subtotal,
      [*Total:*], [*#doc.total*],
    )
  ]
}
