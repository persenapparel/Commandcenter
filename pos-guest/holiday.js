/* Cosmetic staging-only seasonal flag. No checkout/session access. */
(function () {
  'use strict';
  var now = new Date();
  var month = now.getMonth();
  var active = month === 11 || (month === 10 && now.getDate() >= 15);
  if (active) document.documentElement.setAttribute('data-pos-season', 'christmas');
})();
