'use strict';
// Pure, staging-only customer-response shape validation. Not an authorization
// boundary: the server must independently bind requests to a live checkout.
const allowed = new Set(['email','phone','marketingConsent','signature']);
function validateGuestResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw Error('Invalid customer response');
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw Error('Unsupported customer field');
  const email = value.email == null ? '' : value.email;
  const phone = value.phone == null ? '' : value.phone;
  if (typeof email !== 'string' || email.length > 254 || (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) throw Error('Invalid email');
  if (typeof phone !== 'string' || phone.length > 40 || (phone.trim() && !/^[+()\d\s.\-]{7,40}$/.test(phone.trim()))) throw Error('Invalid phone');
  if (typeof value.marketingConsent !== 'boolean') throw Error('Explicit consent choice required');
  if (value.signature != null && (typeof value.signature !== 'string' || value.signature.length > 32768 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.signature))) throw Error('Invalid signature');
  return Object.freeze({email:email.trim(),phone:phone.trim(),marketingConsent:value.marketingConsent,signature:value.signature || null});
}
module.exports={validateGuestResponse};
