'use strict';
// Pure boundary validation for a future protected single-iPad customer checkout.
// This module does not enable handoff or issue capabilities.
function validateGuestHandoff(input) {
  const {cashierOrigin,guestUrl,checkoutId,capability,now=Date.now()}=input||{};
  let cashier,guest;
  try {cashier=new URL(cashierOrigin);guest=new URL(guestUrl);} catch {throw Error('Invalid checkout origin');}
  if(cashier.protocol!=='https:'||guest.protocol!=='https:')throw Error('HTTPS required');
  if(cashier.origin===guest.origin)throw Error('Guest must use a separate origin');
  if(guest.username||guest.password||guest.hash||guest.search)throw Error('Guest URL must not carry credentials or identifiers');
  if(!checkoutId||typeof checkoutId!=='string')throw Error('Checkout binding required');
  if(!capability||capability.checkoutId!==checkoutId||capability.scope!=='customer:checkout'||
     capability.issuer!=='server'||capability.revoked===true||
     !Number.isFinite(capability.expiresAt)||capability.expiresAt<=now||
     !Number.isFinite(capability.issuedAt)||capability.issuedAt>now||
     capability.expiresAt-capability.issuedAt>5*60*1000)
    throw Error('Invalid checkout-scoped capability');
  return Object.freeze({guestOrigin:guest.origin,checkoutId});
}
if(typeof module!=='undefined')module.exports={validateGuestHandoff};
