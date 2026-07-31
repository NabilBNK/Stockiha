// S4-001 — deterministic customer credit invoice / payment receipt PDF layout.
// All business data and decimal formatting arrive precomputed from immutable
// PostgreSQL document snapshots. This template performs layout only.

#let present(value) = if value == "" { "—" } else { value }

#let customer-block(doc) = {
  grid(
    columns: (auto, 1fr),
    row-gutter: 3pt,
    column-gutter: 8pt,
    [*Customer:*], doc.customer_name,
    [*Customer code:*], doc.customer_code,
    [*Tax ID:*], present(doc.customer_tax_id),
    [*Address:*], present(doc.customer_address),
  )
}

#let render-customer-document(doc) = {
  set document(title: "Stockiha — " + doc.title, author: "Stockiha")
  set page(width: 210mm, height: 297mm, margin: 18mm)
  set text(font: ("Libertinus Serif", "Amiri"), size: 10.5pt)

  grid(
    columns: (1fr, auto),
    align: (left, right),
    text(size: 20pt, weight: "bold")[Stockiha],
    text(size: 15pt, weight: "bold")[#doc.title],
  )
  v(3pt)
  line(length: 100%, stroke: 0.6pt)
  v(8pt)

  grid(
    columns: (auto, 1fr, auto, 1fr),
    row-gutter: 3pt,
    column-gutter: 8pt,
    [*Document:*], doc.number,
    [*Date:*], doc.date,
    [*Status:*], doc.status,
    [*Posted:*], present(doc.posted_at),
  )
  v(10pt)
  customer-block(doc)
  v(12pt)

  if doc.kind == "CREDIT_SALE" {
    grid(
      columns: (auto, 1fr),
      row-gutter: 3pt,
      column-gutter: 8pt,
      [*Due date:*], doc.due_date,
    )
    v(8pt)

    table(
      columns: (auto, 1fr, auto, auto, auto),
      align: (right, left, right, right, right),
      stroke: 0.4pt,
      inset: 5pt,
      table.header([*Line*], [*Item*], [*Qty*], [*Unit price*], [*Amount*]),
      ..doc.items.map(it => (it.line, it.name + " (" + it.sku + ")", it.qty, it.unit, it.total)).flatten(),
    )
    v(10pt)
    align(right)[
      #grid(
        columns: (auto, auto),
        column-gutter: 12pt,
        [Subtotal:], doc.subtotal,
        [*Total:*], [*#doc.total*],
      )
    ]
  } else {
    grid(
      columns: (auto, 1fr),
      row-gutter: 3pt,
      column-gutter: 8pt,
      [*Payment method:*], doc.payment_method,
      [*Note:*], present(doc.note),
    )
    v(8pt)

    table(
      columns: (1fr, auto, auto),
      align: (left, right, right),
      stroke: 0.4pt,
      inset: 5pt,
      table.header([*Invoice*], [*Invoice date*], [*Allocated*]),
      ..doc.allocations.map(a => (present(a.number), present(a.date), a.amount)).flatten(),
    )
    v(10pt)
    align(right)[*Amount received: #doc.total*]
  }

  v(18pt)
  line(length: 100%, stroke: 0.3pt)
  v(4pt)
  text(size: 8.5pt, fill: rgb("555555"))[
    Generated from the immutable posted document snapshot. Reprinting this file does not repost the financial transaction.
  ]
}
