'use strict';

/**
 * Isolated-origin customer checkout controller (staging draft).
 * This module never receives cashier credentials, a register-wide pairing
 * secret, cash tender or payment APIs. The caller must supply a verified
 * checkout-scoped guest transport. Do not mount on the cashier origin.
 *
 * Guest transport interface:
 *   view() -> { checkoutId, items:[{name,quantity,lineTotal}], total }
 *   submit({checkoutId, email, phone, marketingConsent, signature,
 *           signatureException}) -> {accepted:true}
 *
 * The transport must enforce checkout token binding, TTL, one-time submission,
 * rate limiting and RLS on the server; this module is NOT a security boundary.
 */
function createCustomerCheckout({ root, guestApi, origin, cashierOrigin }) {
  if (!root || typeof root.replaceChildren !== 'function') throw Error('Missing root');
  if (!guestApi || typeof guestApi.view !== 'function' || typeof guestApi.submit !== 'function')
    throw Error('Verified guest API required');
  const here = new URL(origin), cashier = new URL(cashierOrigin);
  if (here.protocol !== 'https:' || cashier.protocol !== 'https:' || here.origin === cashier.origin)
    throw Error('Isolated HTTPS customer origin required');

  let phase = 'loading', snapshot = null, busy = false;
  const el = (tag, text, className) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function draw() {
    root.replaceChildren();
    const panel = el('main', undefined, 'customer-checkout');
    panel.setAttribute('aria-live', 'polite');
    root.append(panel);
    if (phase === 'complete') {
      panel.append(el('h1', 'Your information is all set!'));
      panel.append(el('p', 'Please turn the iPad back to your cashier to finish checking out.'));
      panel.append(el('p', 'Your sale is not finished yet. The cashier will verify payment.'));
      return;
    }
    if (phase === 'error') {
      panel.append(el('h1', 'Checkout is temporarily unavailable'));
      panel.append(el('p', 'Please return the iPad to your cashier. No sale was completed.'));
      return;
    }
    if (phase === 'loading') {
      panel.append(el('h1', 'Preparing your checkout'));
      return;
    }
    panel.append(el('h1', 'Review your order'));
    const list = el('ul');
    for (const item of snapshot.items) {
      list.append(el('li', `${item.name} × ${item.quantity} — ${item.lineTotal}`));
    }
    panel.append(list, el('p', `Total: ${snapshot.total}`));
    const form = el('form');
    const field = (labelText, type, name) => {
      const label = el('label', labelText);
      const input = el('input');
      input.type = type;
      input.name = name;
      input.autocomplete = name === 'email' ? 'email' : name === 'phone' ? 'tel' : 'off';
      label.append(input);
      form.append(label);
      return input;
    };
    const email = field('Email (optional)', 'email', 'email');
    const phone = field('Phone (optional)', 'tel', 'phone');
    const marketing = field('I agree to receive marketing messages (optional)', 'checkbox', 'marketing');
    const exception = field('I cannot provide a signature (accessibility exception)', 'checkbox', 'exception');
    const signature = field('Signature (type your name, or select the accessibility exception)', 'text', 'signature');
    const error = el('p', '', 'checkout-error');
    error.setAttribute('role', 'alert');
    const submit = el('button', 'Submit information');
    submit.type = 'submit';
    form.append(error, submit);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      const signed = signature.value.trim(), excepted = exception.checked;
      if (!signed && !excepted) {
        error.textContent = 'Please sign or choose the accessibility exception.';
        return;
      }
      busy = true;
      submit.disabled = true;
      try {
        const result = await guestApi.submit({
          checkoutId: snapshot.checkoutId,
          email: email.value.trim(),
          phone: phone.value.trim(),
          marketingConsent: marketing.checked === true,
          signature: excepted ? null : signed,
          signatureException: excepted
        });
        if (!result || result.accepted !== true) throw Error('Guest submission not accepted');
        phase = 'complete';
        draw();
      } catch (_) {
        error.textContent = 'Unable to submit. Please return the iPad to your cashier.';
        submit.disabled = false;
      } finally {
        busy = false;
      }
    });
    panel.append(form);
  }
  async function start() {
    draw();
    try {
      const data = await guestApi.view();
      if (!data || typeof data.checkoutId !== 'string' ||
          !Array.isArray(data.items) || typeof data.total !== 'string' ||
          data.items.some(x => typeof x.name !== 'string' ||
            !Number.isInteger(x.quantity) || x.quantity < 1 ||
            typeof x.lineTotal !== 'string')) throw Error('Invalid guest snapshot');
      snapshot = data;
      phase = 'review';
    } catch (_) {
      phase = 'error';
    }
    draw();
  }
  return { start };
}
if (typeof module !== 'undefined') module.exports = { createCustomerCheckout };
