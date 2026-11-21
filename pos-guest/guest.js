(()=>{'use strict';
const BASE='https://naaqcspvbntzdtwuchrr.supabase.co/functions/v1/pos-guest-checkout';
const root=document.getElementById('checkout');
const validId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
const validToken=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function cashierOrigin(value){try{const u=new URL(value),h=u.hostname.toLowerCase();return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&(u.origin==='https://pos.persenapparel.com'||h==='persen-pos-staging.pages.dev'||h.endsWith('.persen-pos-staging.pages.dev'));}catch(_){return false}}
let token='',checkoutId='',started=false,submitted=false,busy=false,authorizedCashierOrigin='';
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
function unavailable(){root.replaceChildren(el('main'));const panel=root.firstChild;panel.append(el('h1','Checkout is temporarily unavailable'),el('p','Please return the iPad to your cashier. No sale was completed.'))}
function loading(){root.replaceChildren(el('main'));root.firstChild.append(el('h1','Preparing your checkout'),el('p','Please wait while your order is loaded.'))}
function controller(){const c=new AbortController(),timer=setTimeout(()=>c.abort(),8000);return{signal:c.signal,done:()=>clearTimeout(timer)}}
async function request(action,body){if(!token||busy)throw Error('Checkout unavailable');busy=true;const abort=controller();try{const response=await fetch(BASE+'/guest-checkout/'+action,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:abort.signal,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response||!response.ok)throw Error('Checkout unavailable');const result=await response.json();if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Checkout unavailable');return result;}finally{abort.done();busy=false}}
function validSnapshot(value){return value&&value.checkoutId===checkoutId&&Array.isArray(value.items)&&value.items.length>0&&value.items.length<=80&&typeof value.total==='string'&&value.items.every(item=>item&&typeof item.name==='string'&&item.name.length<=120&&Number.isInteger(item.quantity)&&item.quantity>0&&typeof item.lineTotal==='string'&&item.lineTotal.length<=40)}

/* The isolated, credential-free page embeds the SAME customer-screen
 * controller as the guest integration tests. The transport below deliberately
 * retains the already deployed Edge Function endpoint and capability scope.
 * Payment selection remains informational; only cashier can complete a sale.
 */
const createCustomerCheckout=(()=>{
 const module={exports:{}};
'use strict';

/*
 * Credential-free guest checkout for the single-iPad swivel flow.
 * Each question is a separate step, following the former two-device design.
 * Payment choice is INFORMATION ONLY: the guest API does not process or store
 * tender. Cashier verification and server-authorized Finish Order are required.
 * Never mount this controller on the authenticated cashier origin.
 */
function createCustomerCheckout({ root, guestApi, origin, cashierOrigin }) {
  if (!root || typeof root.replaceChildren !== 'function') throw Error('Missing root');
  if (!guestApi || typeof guestApi.view !== 'function' || typeof guestApi.submit !== 'function')
    throw Error('Verified guest API required');
  const here = new URL(origin), cashier = new URL(cashierOrigin);
  if (here.protocol !== 'https:' || cashier.protocol !== 'https:' || here.origin === cashier.origin)
    throw Error('Isolated HTTPS customer origin required');

  const steps = ['review', 'phone', 'email', 'payment', 'confirm'];
  const paymentNames = Object.freeze({cash:'Cash', venmo:'Venmo', applecash:'Apple Cash'});
  const answers = {phone:'', email:'', payment:'', marketing:false};
  let phase = 'loading', snapshot = null, stepIndex = 0, busy = false;
  const doc = root.ownerDocument;
  const el = (tag, value, className) => {
    const node = doc.createElement(tag);
    if (value !== undefined) node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const line = (parent, tag, value, className) => {
    const node = el(tag, value, className);
    parent.append(node);
    return node;
  };
  function action(text, className, callback) {
    const control = el('button', text, className);
    control.type = 'button';
    // Some iPad Safari versions do not deliver a synthesized click from an
    // isolated iframe. Pointer and Touch Events are independent fallbacks.
    // A single finger tap must never advance or submit twice.
    control.style.touchAction = 'manipulation';
    let pointerStart = null, touchStart = null, lastTouchAction = 0;
    const activate = (event, fromTouch) => {
      if (control.disabled || control.isConnected === false) return;
      if (fromTouch) {
        if (Date.now() - lastTouchAction < 650) return;
        lastTouchAction = Date.now();
        if (event.cancelable) event.preventDefault();
      }
      callback(event);
    };
    control.addEventListener('pointerdown', event => {
      pointerStart = event.pointerType === 'touch' ?
        {x:event.clientX, y:event.clientY} : null;
    });
    control.addEventListener('pointercancel', () => { pointerStart = null; });
    control.addEventListener('pointerup', event => {
      if (event.pointerType !== 'touch' || !pointerStart) return;
      const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      pointerStart = null;
      if (moved <= 15) activate(event, true);
    });
    control.addEventListener('touchstart', event => {
      const touch = event.touches?.length === 1 ? event.touches[0] : null;
      touchStart = touch ?
        {identifier:touch.identifier, x:touch.clientX, y:touch.clientY} : null;
    }, {passive:true});
    control.addEventListener('touchcancel', () => { touchStart = null; });
    control.addEventListener('touchend', event => {
      if (!touchStart) return;
      const touch = Array.from(event.changedTouches || [])
        .find(item => item.identifier === touchStart.identifier);
      const start = touchStart;
      touchStart = null;
      if (!touch) return;
      const moved = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
      if (moved <= 15) activate(event, true);
    }, {passive:false});
    control.addEventListener('click', event => {
      if (Date.now() - lastTouchAction < 650) return;
      activate(event, false);
    });
    return control;
  }
  function field(parent, labelText, type, value, help) {
    const label = el('label', labelText, 'guest-field-label');
    const input = el('input');
    input.type = type;
    input.value = value;
    input.autocomplete = type === 'email' ? 'email' : type === 'tel' ? 'tel' : 'name';
    if (type === 'email') { input.maxLength = 250; input.autocapitalize = 'off'; input.spellcheck = false; }
    if (type === 'tel') { input.inputMode = 'tel'; input.maxLength = 24; }
    if (type === 'text') input.maxLength = 160;
    label.append(input);
    parent.append(label);
    if (help) line(parent, 'p', help, 'guest-field-help');
    return input;
  }
  function setStep(nextIndex) {
    if (busy || nextIndex < 0 || nextIndex >= steps.length) return;
    stepIndex = nextIndex;
    draw();
  }
  function navigation(panel, nextText, onNext, showSkip) {
    const errors = line(panel, 'p', '', 'guest-error');
    errors.setAttribute('role', 'alert');
    const nav = line(panel, 'div', undefined, 'guest-navigation');
    if (stepIndex > 0) nav.append(action('Back', 'guest-back', () => setStep(stepIndex - 1)));
    if (showSkip) nav.append(action('Skip', 'guest-skip', () => {
      if (typeof showSkip === 'function') showSkip();
      else setStep(stepIndex + 1);
    }));
    if (onNext) {
      nav.append(action(nextText, 'guest-next', () => {
        if (busy) return;
        const error = onNext();
        if (error) errors.textContent = error;
      }));
    }
    return errors;
  }
  function progress(panel) {
    const progressLabel = line(panel, 'div', undefined, 'guest-progress-label');
    line(progressLabel, 'span', 'SECURE CHECKOUT', 'guest-eyebrow');
    line(progressLabel, 'span', 'Step ' + (stepIndex + 1) + ' of ' + steps.length);
    const track = line(panel, 'div', undefined, 'guest-progress-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Checkout progress');
    track.setAttribute('aria-valuemin', '1');
    track.setAttribute('aria-valuemax', String(steps.length));
    track.setAttribute('aria-valuenow', String(stepIndex + 1));
    const bar = line(track, 'span', undefined, 'guest-progress-fill');
    bar.style.width = String((stepIndex + 1) / steps.length * 100) + '%';
  }
  function draw() {
    root.replaceChildren();
    const panel = line(root, 'main', undefined, 'customer-checkout');
    panel.setAttribute('aria-live', 'polite');
    if (phase === 'loading') {
      line(panel, 'h1', 'Preparing your checkout');
      line(panel, 'p', 'Your cashier is getting your order ready.', 'guest-muted');
      return;
    }
    if (phase === 'error') {
      line(panel, 'h1', 'Checkout unavailable');
      line(panel, 'p', 'Please return the iPad to your cashier. No payment was completed.', 'guest-muted');
      return;
    }
    if (phase === 'complete') {
      line(panel, 'div', '✓', 'guest-success-icon');
      line(panel, 'h1', 'Thank you!');
      line(panel, 'p', 'Your information was received. Please return the iPad to your cashier.', 'guest-muted');
      line(panel, 'div', 'Selected method: ' + paymentNames[answers.payment], 'guest-selected-payment');
      line(panel, 'p', 'Your cashier must verify payment and finish the order. This screen does not mean you have paid.', 'guest-notice');
      return;
    }
    progress(panel);
    const name = steps[stepIndex];
    if (stepIndex > 0) {
      const totalBar = line(panel, 'div', undefined, 'guest-total-strip');
      line(totalBar, 'span', 'Your total');
      line(totalBar, 'strong', snapshot.total);
    }
    if (name === 'review') {
      line(panel, 'div', '01 · YOUR ORDER', 'guest-section-tag');
      line(panel, 'h1', 'Here is your total.');
      line(panel, 'p', 'Review your items before continuing.', 'guest-muted');
      line(panel, 'div', snapshot.total, 'guest-grand-total');
      const items = line(panel, 'ul', undefined, 'guest-items');
      snapshot.items.forEach(item => {
        const li = line(items, 'li', undefined, 'guest-item');
        const details = line(li, 'span', undefined, 'guest-item-name');
        line(details, 'strong', item.name);
        line(details, 'small', 'Quantity: ' + item.quantity);
        line(li, 'strong', item.lineTotal, 'guest-item-price');
      });
      navigation(panel, 'Next →', () => { setStep(1); return ''; }, false);
    } else if (name === 'phone') {
      line(panel, 'div', '02 · CONTACT', 'guest-section-tag');
      line(panel, 'h1', "What's your phone number?");
      line(panel, 'p', 'Optional — for questions about your order. We do not send text receipts.', 'guest-muted');
      // A purpose-built, touch-friendly dial pad. A read-only telephone field
      // prevents iPadOS from launching its full native typing keyboard.
      const phone = field(panel, 'Phone number', 'tel', answers.phone, 'Enter 10 digits, or choose Skip.');
      phone.readOnly = true;
      phone.inputMode = 'none';
      phone.autocomplete = 'off';
      phone.setAttribute('aria-label', 'Phone number entered using the on-screen number pad');
      const dial = line(panel, 'div', undefined, 'guest-dialpad-popup');
      dial.setAttribute('role', 'group');
      dial.setAttribute('aria-label', 'Phone number dial pad');
      line(dial, 'p', 'Tap the numbers below', 'guest-dialpad-title');
      const keys = line(dial, 'div', undefined, 'guest-dialpad');
      const updatePhone = digits => {
        answers.phone = digits.replace(/[^0-9]/g, '').slice(0, 15);
        phone.value = answers.phone;
        phone.setAttribute('aria-label', 'Phone number: ' + (answers.phone || 'empty'));
      };
      for (const digit of ['1','2','3','4','5','6','7','8','9','clear','0','delete']) {
        const text = digit === 'clear' ? 'Clear' : digit === 'delete' ? '⌫' : digit;
        const key = action(text, 'guest-dialkey' +
          (digit === 'clear' || digit === 'delete' ? ' guest-dialkey-tool' : ''), () => {
          if (digit === 'clear') updatePhone('');
          else if (digit === 'delete') updatePhone(answers.phone.slice(0, -1));
          else updatePhone(answers.phone + digit);
        });
        if (digit === 'delete') key.setAttribute('aria-label', 'Delete last digit');
        if (digit === 'clear') key.setAttribute('aria-label', 'Clear phone number');
        keys.append(key);
      }
      navigation(panel, 'Next →', () => {
        const digits = answers.phone.replace(/[^0-9]/g, '');
        if (digits && (digits.length < 10 || digits.length > 15))
          return 'Enter a full phone number, or choose Skip.';
        setStep(2);
        return '';
      }, () => { answers.phone = ''; setStep(2); });
    } else if (name === 'email') {
      line(panel, 'div', '03 · CONTACT', 'guest-section-tag');
      line(panel, 'h1', "What's your email address?");
      line(panel, 'p', 'Optional — sharing your email does not subscribe you to promotions.', 'guest-muted');
      const email = field(panel, 'Email address', 'email', answers.email, 'You can skip this question.');
      email.addEventListener('input', () => { answers.email = email.value; });
      navigation(panel, 'Next →', () => {
        answers.email = email.value.trim();
        if (answers.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.email))
          return 'Enter a valid email address, or choose Skip.';
        setStep(3);
        return '';
      }, () => { answers.email = ''; setStep(3); });
    } else if (name === 'payment') {
      line(panel, 'div', '04 · PAYMENT', 'guest-section-tag');
      line(panel, 'h1', 'How would you like to pay?');
      line(panel, 'p', 'Choose your preferred method. Your cashier will finish the payment.', 'guest-muted');
      const options = line(panel, 'fieldset', undefined, 'guest-payment-options');
      line(options, 'legend', 'Payment method', 'guest-sr-only');
      const choices = [
        ['cash', '💵', 'Cash', 'Pay your cashier directly'],
        ['venmo', 'V', 'Venmo', 'Your cashier will confirm the transfer'],
        ['applecash', '●', 'Apple Cash', 'Your cashier will confirm the transfer']
      ];
      choices.forEach(choice => {
        const label = line(options, 'label', undefined, 'guest-payment-option');
        const input = el('input');
        input.type = 'radio';
        input.name = 'payment_preference';
        input.value = choice[0];
        input.checked = answers.payment === choice[0];
        input.addEventListener('change', () => {
          answers.payment = choice[0];
          options.querySelectorAll && options.querySelectorAll('label').forEach(item => {
            item.classList.toggle('selected', item === label);
          });
        });
        if (input.checked) label.className += ' selected';
        label.append(input);
        line(label, 'span', choice[1], 'guest-choice-icon');
        const copy = line(label, 'span', undefined, 'guest-choice-copy');
        line(copy, 'strong', choice[2]);
        line(copy, 'small', choice[3]);
      });
      line(panel, 'p', 'Selecting a method does not send money or charge your account.', 'guest-notice');
      navigation(panel, 'Next →', () => {
        if (!answers.payment) return 'Please select Cash, Venmo, or Apple Cash.';
        setStep(4);
        return '';
      }, false);
    } else if (name === 'confirm') {
      line(panel, 'div', '05 · CONFIRM', 'guest-section-tag');
      line(panel, 'h1', 'Review and finish.');
      line(panel, 'p', 'Confirm your payment choice, then return the iPad to your cashier.', 'guest-muted');
      const recap = line(panel, 'div', undefined, 'guest-confirm-recap');
      line(recap, 'span', 'Payment choice: ' + paymentNames[answers.payment]);
      line(recap, 'strong', snapshot.total);
      // No typed-signature substitute: the current staging backend does not
      // support storing authentic finger-drawn strokes. Remove signature
      // collection until real private drawing storage is implemented.
      line(panel, 'p', 'No signature is needed for this test. Your cashier will verify payment and finish the sale.', 'guest-notice');
      const marketingLabel = line(panel, 'label', undefined, 'guest-check-row');
      const marketing = el('input');
      marketing.type = 'checkbox';
      marketing.checked = answers.marketing;
      marketing.addEventListener('change', () => { answers.marketing = marketing.checked; });
      marketingLabel.append(marketing);
      line(marketingLabel, 'span', 'Optional: I agree to receive Persen Apparel promotional messages.');
      const errors = navigation(panel, 'Submit & return to cashier →', () => {
        if (busy) return '';
        answers.marketing = marketing.checked;
        busy = true;
        const submitButton = panel.querySelector ? panel.querySelector('.guest-next') : null;
        if (submitButton) submitButton.disabled = true;
        const payload = {
          checkoutId: snapshot.checkoutId,
          phone: answers.phone.trim(),
          email: answers.email.trim(),
          marketingConsent: answers.marketing === true,
          // No signature is collected. Staging RPC accepts this omission.
          // A payment preference, NOT authorization to treat it as paid.
          paymentPreference: answers.payment==='venmo'?'venmo_info':
            answers.payment==='applecash'?'apple_cash_info':'cash'
        };
        // Never send a client-selected tender as if it were an authorized payment.
        Promise.resolve().then(() => guestApi.submit(payload)).then(result => {
          if (!result || result.accepted !== true) throw Error('Guest submit rejected');
          answers.phone = ''; answers.email = '';
          phase = 'complete';
          draw();
        }).catch(() => {
          // Submission consumes a single-use bearer even if the network fails.
          // Fail closed; a cashier must safely recover the checkout.
          answers.phone = ''; answers.email = '';
          phase = 'error';
          draw();
        }).finally(() => { busy = false; });
        return '';
      }, false);
      if (errors) errors.textContent = '';
    }
  }
  async function start() {
    draw();
    try {
      const data = await guestApi.view();
      if (!data || typeof data.checkoutId !== 'string' ||
          !Array.isArray(data.items) || typeof data.total !== 'string' ||
          data.items.some(item => typeof item.name !== 'string' ||
            !Number.isInteger(item.quantity) || item.quantity < 1 ||
            typeof item.lineTotal !== 'string')) throw Error('Invalid guest snapshot');
      snapshot = data;
      phase = 'ready';
    } catch (_) {
      phase = 'error';
    }
    draw();
  }
  return { start };
}
if (typeof module !== 'undefined') module.exports = { createCustomerCheckout };



 return module.exports.createCustomerCheckout;
})();
function createGuestApi(){
 return Object.freeze({
   async view(){
     if(submitted)throw Error('Checkout already submitted');
     try{
       const snapshot=await request('view',{checkoutId});
       if(!validSnapshot(snapshot))throw Error('Invalid checkout snapshot');
       return snapshot;
     }catch(_){token='';throw Error('Checkout unavailable');}
   },
   async submit(answers){
     if(submitted)throw Error('Checkout already submitted');
     submitted=true;
     try{
       const payload={
         checkoutId,
         phone:String(answers.phone||'').trim(),
         email:String(answers.email||'').trim(),
         marketingConsent:answers.marketingConsent===true,
         paymentPreference:['cash','venmo_info','apple_cash_info'].includes(answers.paymentPreference)?answers.paymentPreference:'cash'
       };
       const result=await request('submit',payload);
       if(result.accepted!==true)throw Error('Checkout unavailable');
       return {accepted:true};
     }finally{token='';}
   }
 });
}
async function begin(){
 try{
   if(!cashierOrigin(authorizedCashierOrigin))throw Error('Invalid cashier origin');
   const controller=createCustomerCheckout({
      root, guestApi:createGuestApi(), origin:location.origin,
      cashierOrigin:authorizedCashierOrigin
   });
   await controller.start();
 }catch(_){token='';unavailable();}
}

function onMessage(event){if(started||event.source!==window.parent||event.data?.type!=='persen:checkout-bootstrap:v1'||!cashierOrigin(event.origin))return;const nextId=event.data.checkoutId,nextToken=event.data.capability;if(!validId(nextId)||!validToken(nextToken))return;started=true;window.removeEventListener('message',onMessage);checkoutId=nextId;token=nextToken;authorizedCashierOrigin=event.origin;void begin()}
window.addEventListener('message',onMessage);try{window.parent.postMessage({type:'persen:checkout-ready:v1'},'*')}catch(_){unavailable()}
})();
