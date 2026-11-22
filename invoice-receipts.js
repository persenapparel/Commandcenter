/* Boutique-style 80mm payment receipts for Persen Apparel Command Center.
   Read-only: uses existing invoice payments and receipt snapshots; never posts a payment,
   sends a message, or changes POS / customer records. */
(function () {
  'use strict';
  const portal = document.getElementById('owner-app');
  if (!portal || typeof render !== 'function' || typeof data === 'undefined') return;

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
  const amount = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? '$' + n.toFixed(2) : '$0.00';
  };
  const cents = (value) => Math.round((Number(value) || 0) * 100);
  const dateText = (value) => {
    const raw = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return raw.slice(5, 7) + '/' + raw.slice(8, 10) + '/' + raw.slice(0, 4);
    }
    return raw || 'Date not provided';
  };

  function invoicePayments(inv) {
    return data.payments.filter((p) => p.invoice_id === inv.id)
      .slice()
      .sort((a, b) => String(a.received_on || a.created_at || '').localeCompare(String(b.received_on || b.created_at || '')) ||
        String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
        String(a.id).localeCompare(String(b.id)));
  }

  function invoiceEntries(inv) {
    const payments = invoicePayments(inv);
    const receipts = new Map(data.receipts
      .filter((receipt) => receipt.source_type === 'invoice' && receipt.invoice_id === inv.id)
      .map((receipt) => [receipt.source_payment_id, receipt]));
    let running = 0;
    return payments.map((payment) => {
      running += cents(payment.amount);
      return { inv, payment, official: receipts.get(payment.id), running };
    });
  }

  function createButton(label, action, id, kind) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn ' + (kind || 'ghost') + ' sm';
    button.textContent = label;
    button.dataset.boutiqueReceipt = action;
    button.dataset.id = id;
    return button;
  }

  function decorate() {
    if (!owner) return;
    for (const form of portal.querySelectorAll('form[data-form="invoice-status"]')) {
      const inv = data.invoices.find((x) => x.id === form.dataset.id);
      if (!inv || inv.document_type === 'Estimate' || inv.status === 'Void') continue;
      const entries = invoiceEntries(inv);
      if (!entries.length || form.parentElement.querySelector('[data-invoice-receipt-actions]')) continue;
      const area = document.createElement('div');
      area.dataset.invoiceReceiptActions = inv.id;
      area.style.cssText = 'margin:12px 0;padding:12px;border:1px solid #cbd5e1;border-radius:12px';
      const title = document.createElement('div');
      title.className = 'owner-mini';
      title.style.marginBottom = '8px';
      title.textContent = 'THERMAL PAYMENT RECEIPTS (' + entries.length + ') · Print or save as PDF';
      area.appendChild(title);
      const actions = document.createElement('div');
      actions.className = 'owner-actions';
      entries.forEach(({ payment }, index) => {
        actions.appendChild(createButton(
          'Print Receipt' + (entries.length > 1 ? ' · ' + dateText(payment.received_on) + ' · ' + amount(payment.amount) : ''),
          'invoice-payment', payment.id, index === entries.length - 1 ? 'primary' : 'ghost'
        ));
      });
      area.appendChild(actions);
      form.after(area);
    }

    for (const original of portal.querySelectorAll('[data-click="print-receipt"]')) {
      if (original.parentElement.querySelector('[data-boutique-receipt]')) continue;
      const button = createButton('Print 80mm Boutique', 'official-receipt', original.dataset.id, 'primary');
      original.after(button);
    }
  }

  function receiptDocument(inv, payment, official, running) {
    const snapshot = official || inv;
    const total = Number(snapshot.total);
    const paidSoFar = official ? Number(official.total_paid) : running;
    return {
      documentNumber: official?.document_number ?? inv.invoice_number,
      documentTitle: inv || official.source_type === 'invoice' ? 'Invoice' : 'Order',
      customer: snapshot.customer_name,
      receiptNumber: official?.receipt_number || '',
      paymentId: payment?.id || '',
      paymentDate: official?.payment_date ?? payment?.received_on,
      paymentMethod: official?.payment_method ?? payment?.method,
      paymentAmount: Number(official?.payment_amount ?? payment?.amount),
      invoiceTotal: total,
      paidSoFar,
      balance: official ? Number(official.balance_due) : Math.max(0, cents(total) - cents(paidSoFar)) / 100,
      lines: Array.isArray(snapshot.line_items) ? snapshot.line_items : [],
      subtotal: snapshot.subtotal,
      discount: Number(snapshot.discount_amount || 0),
      tax: Number(snapshot.tax_amount || 0),
      shipping: Number(snapshot.shipping || 0)
    };
  }

  function renderThermal(receipt) {
    const isPaid = cents(receipt.balance) <= 0;
    const lineItems = receipt.lines.map((item) => {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const itemName = String(item.name || item.description || 'Custom apparel');
      const detail = [item.description && item.name ? item.description : '', item.size ? 'Size ' + item.size : '',
        item.design ? 'Design: ' + item.design : ''].filter(Boolean).join(' | ');
      const linePrice = item.unit_price == null ? '' : '<span>' + amount(qty * Number(item.unit_price)) + '</span>';
      return '<div class="item"><div class="item-row"><strong>' + esc(itemName) + '</strong>' + linePrice +
        '</div><div class="item-meta">' + esc(qty + ' x ' + (item.unit_price == null ? 'item' : amount(item.unit_price))) +
        (detail ? '<div>' + esc(detail) + '</div>' : '') + '</div></div>';
    }).join('');

    const row = (label, value, className) => '<div class="money ' + (className || '') +
      '"><span>' + esc(label) + '</span><strong>' + amount(value) + '</strong></div>';
    const subtotal = receipt.subtotal == null ? '' : row('Item subtotal', receipt.subtotal);
    const discount = receipt.discount > 0 ? row('Discount', -receipt.discount) : '';
    const shipping = receipt.shipping ? row('Shipping', receipt.shipping) : '';
    const tax = receipt.tax ? row('Tax', receipt.tax) : '';
    const identity = receipt.receiptNumber ?
      'Receipt ' + receipt.receiptNumber :
      'Payment record' + (receipt.paymentId ? ' ' + receipt.paymentId.slice(0, 8).toUpperCase() : '');
    const title = esc(identity + ' | Persen Apparel');
    const safeDoc = esc(receipt.documentNumber);
    const safeCustomer = esc(receipt.customer);
    const safeMethod = esc(receipt.paymentMethod);
    const safeDate = esc(dateText(receipt.paymentDate));
    const status = isPaid ? 'PAID IN FULL' : 'PARTIAL PAYMENT';
    const titleClass = isPaid ? 'paid' : 'partial';

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + title + '</title><style>' +
      '*{box-sizing:border-box}html{background:#f3f5f7}body{margin:20px auto;padding:0;width:76mm;max-width:100%;font:12px/1.4 Arial,Helvetica,sans-serif;color:#111;background:white;box-shadow:0 8px 35px #0002;overflow-wrap:anywhere}' +
      '.receipt{padding:4mm 3mm 9mm} .no-print{margin:12px auto 0;max-width:76mm;text-align:center;font:13px Arial,sans-serif}' +
      '.no-print button{background:#13391f;border:0;border-radius:8px;color:#fff;font-weight:700;padding:12px 14px;cursor:pointer;width:100%}' +
      '.no-print p{line-height:1.5;color:#333}' +
      '.mast{text-align:center;border-bottom:2px solid #111;padding-bottom:12px}.mast h1{font-size:22px;letter-spacing:1px;margin:3px 0}.mast .small{font-size:10px;letter-spacing:1.1px}' +
      '.season{margin:8px 0;font-size:15px;letter-spacing:4px}.tagline{font-size:10px;font-weight:600;margin:4px 0}' +
      '.headline{text-align:center;padding:11px 3px;border-block:1px dashed #111;margin:10px 0}.headline h2{font-size:16px;margin:0 0 4px}.headline p{margin:0;font-size:11px}' +
      '.info{font-size:11px;margin:11px 0}.info div{margin:3px 0}.section{text-align:center;font-size:10px;letter-spacing:2px;border-block:1px dashed #111;padding:5px 0;margin:12px 0 4px}' +
      '.item{padding:7px 0;border-bottom:1px dotted #777}.item-row,.money{display:flex;justify-content:space-between;gap:7px;align-items:start}.item-row strong{font-size:14px;flex:1}.item-row span{text-align:right;white-space:nowrap}.item-meta{font-size:10px;margin-top:3px;color:#333}.money{margin:7px 0;font-size:11px}.money strong{white-space:nowrap}' +
      '.main-total{font-size:15px;border-top:2px solid #111;padding-top:9px;margin-top:10px}.paid{background:#eee}.partial{background:#f8f8f8}' +
      '.status{font-size:16px;letter-spacing:1px;text-align:center;padding:9px 2px;border:2px solid #111;margin:12px 0;font-weight:800}' +
      '.footer{text-align:center;border-top:2px dashed #111;margin-top:13px;padding-top:12px}.footer h3{font-size:15px;margin:0 0 7px}.footer p{font-size:10px;margin:4px 0}.footer .stars{letter-spacing:3px;font-size:14px;margin:10px 0}' +
      '@media print{@page{margin:0}html,body{background:white!important;width:72mm;margin:0;padding:0;box-shadow:none!important}.receipt{padding:3mm 2mm 5mm}.item{break-inside:avoid}.no-print{display:none!important}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}' +
      '</style></head><body>' +
      '<div class="no-print"><button type="button" onclick="window.print()">PRINT / SAVE PDF</button>' +
      '<p>For Epson: select the Epson printer, 80mm receipt paper, no headers or footers, and no margins. Save as PDF is also available.</p></div>' +
      '<main class="receipt">' +
      '<header class="mast"><div class="season">✦ ❄ ✦</div><div class="small">CUSTOM APPAREL • LONG ISLAND</div><h1>PERSEN APPAREL</h1><p class="tagline">Made for your moments.</p><div class="small">PERSENAPPAREL.COM</div></header>' +
      '<div class="headline"><h2>PAYMENT RECEIPT</h2><p>' + esc(identity) + '</p></div>' +
      '<div class="info"><div><strong>Customer:</strong> ' + safeCustomer + '</div>' +
      '<div><strong>' + esc(receipt.documentTitle) + ':</strong> ' + safeDoc + '</div>' +
      '<div><strong>Payment date:</strong> ' + safeDate + '</div><div><strong>Payment method:</strong> ' + safeMethod + '</div></div>' +
      '<div class="section">YOUR ORDER DETAILS</div>' +
      (lineItems || '<p>Payment toward ' + safeDoc + '</p>') +
      '<div class="section">PAYMENT SUMMARY</div>' +
      subtotal + discount + shipping + tax +
      row('Invoice / order total', receipt.invoiceTotal) +
      row('This payment', receipt.paymentAmount, 'main-total') +
      row('Total paid to date', receipt.paidSoFar) +
      row('Balance remaining', receipt.balance) +
      '<div class="status ' + titleClass + '">' + status + '</div>' +
      '<footer class="footer"><h3>THANK YOU!</h3><p>Thank you for supporting our small Long Island business and letting us create something special for you.</p>' +
      '<div class="stars">✦ ✦ ✦</div><p>Need another custom order?<br><strong>persenapparel.com</strong></p>' +
      '<p>Payment was recorded by Persen Apparel. This is not a bank payment confirmation.</p></footer>' +
      '</main></body></html>';
  }

  function openReceipt(inv, payment, official, running) {
    const w = window.open('', '_blank', 'width=510,height=820');
    if (!w) { msg('Allow pop-ups to preview and print your receipt.'); return; }
    w.document.open();
    w.document.write(renderThermal(receiptDocument(inv, payment, official, running)));
    w.document.close();
    try { w.opener = null; } catch (_) {}
  }

  portal.addEventListener('click', (event) => {
    const button = event.target.closest('[data-boutique-receipt]');
    if (!button || !owner) return;
    const action = button.dataset.boutiqueReceipt;
    if (action === 'invoice-payment') {
      for (const inv of data.invoices) {
        const entry = invoiceEntries(inv).find((x) => x.payment.id === button.dataset.id);
        if (entry) { openReceipt(inv, entry.payment, entry.official, entry.running / 100); return; }
      }
      msg('Payment not found. Refresh Command Center and try again.');
    }
    if (action === 'official-receipt') {
      const receipt = data.receipts.find((x) => x.id === button.dataset.id);
      if (!receipt) { msg('Receipt not found. Refresh and try again.'); return; }
      const inv = receipt.source_type === 'invoice' ? data.invoices.find((x) => x.id === receipt.invoice_id) : null;
      openReceipt(inv || null, null, receipt, Number(receipt.total_paid || 0));
    }
  });

  // The existing editor also decorates render(). Chain after it without replacing its features.
  const previousRender = render;
  render = function () {
    const result = previousRender.apply(this, arguments);
    decorate();
    return result;
  };
  decorate();
})();