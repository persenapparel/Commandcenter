'use strict';
/* Staging-only employee home menu. Existing Supabase owner authentication is
 * the sole login boundary. Badge scans MUST NOT grant a session until a
 * server-verified, revocable employee badge exchange is implemented.
 */
(()=>{
 const workspace=document.getElementById('workspace');
 const launch=document.getElementById('register-launch');
 if(!workspace||!launch)return;
 const panel=document.createElement('section');
 panel.id='employee-home-menu';
 panel.className='panel';
 panel.setAttribute('aria-label','Employee home');
 panel.innerHTML='<h2>Welcome to Persen Apparel</h2><p id="employee-home-greeting">Sign in with your authorized account to continue.</p><label for="employee-badge-scan">Employee badge (Bluetooth HID)</label><input id="employee-badge-scan" type="password" autocomplete="off" inputmode="none" placeholder="Badge sign-in pending secure verification" disabled><p class="hint">Badge login is not yet enabled. Scanning a badge cannot bypass owner authentication. Use your account sign-in for staging.</p><div class="employee-home-actions"><button id="employee-sales" type="button">Sales</button><button id="employee-refunds" type="button" disabled title="Requires approved refund permissions">Refunds (coming soon)</button><button id="employee-returns" type="button" disabled title="Requires verified original sale">Returns (coming soon)</button><button id="employee-inventory" type="button">Inventory Check</button></div><p id="employee-home-status" role="status"></p>';
 launch.insertAdjacentElement('afterend',panel);
 const idle=document.createElement('section');
 idle.id='employee-idle-preview';
 idle.className='panel';
 idle.setAttribute('aria-label','Branded idle screen preview');
 idle.innerHTML='<div class="employee-idle-brand"><img src="assets/persen-logo.png" alt="Persen Apparel logo" width="70" height="70" onerror="this.hidden=true"><strong>PERSEN APPAREL</strong><time id="employee-idle-clock"></time><span id="employee-idle-season">Seasonal welcome</span></div><p class="hint">Branded idle preview only. Automatic 30-second secure locking and badge/PIN shift verification are pending server integration.</p>';
 launch.insertAdjacentElement('beforebegin',idle);
 const clock=document.getElementById('employee-idle-clock');
 function updateClock(){clock.textContent=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date());}
 updateClock();setInterval(updateClock,30000);
 const month=new Date().getMonth();
 document.getElementById('employee-idle-season').textContent=month===11?'❄ Holiday Season':month===9?'🍂 Fall Collection':month===10?'🍁 Autumn Collection':month===1?'♥ Winter Collection':'Welcome to Persen Apparel';
 const css=document.createElement('style');css.textContent='#employee-home-menu{margin:16px 0}#employee-home-menu[hidden]{display:none}.employee-home-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}.employee-home-actions button{min-height:70px;border:1px solid #b9cee8;border-radius:13px;background:#eaf3ff;color:#12335f;font-weight:800;font-size:17px}.employee-home-actions button:disabled{opacity:.48}@media(max-width:520px){.employee-home-actions{grid-template-columns:1fr}}';css.textContent+=' #employee-idle-preview{text-align:center;margin:16px 0}.employee-idle-brand{display:flex;flex-direction:column;align-items:center;gap:9px;padding:18px}.employee-idle-brand strong{letter-spacing:.12em}#employee-idle-clock{font-size:36px;font-weight:750;font-variant-numeric:tabular-nums}';document.head.append(css);
 const status=document.getElementById('employee-home-status');
 function authorized(){return !workspace.hidden&&!!document.getElementById('close-register');}
 document.getElementById('employee-sales').onclick=()=>{
  if(!authorized())return status.textContent='Please sign in first.';
  const open=document.getElementById('open-register');
  if(open&&!open.disabled){open.click();status.textContent='Opening sales register.';}
  else status.textContent='Configure an active sales product before opening the register.';
 };
 document.getElementById('employee-inventory').onclick=()=>{
  if(!authorized())return status.textContent='Please sign in first.';
  const mode=document.getElementById('scan-mode-inventory'),field=document.getElementById('scan-code');
  const open=document.getElementById('open-register');
  if(open&&!open.disabled)open.click();
  if(mode&&field&&!document.body.classList.contains('pos-register-closed')){mode.click();field.focus();status.textContent='Inventory scanner ready.';}
  else status.textContent='Open the register after loading your products to use inventory scan.';
 };
 // The register owns sign-out and authorization. Do not cache credentials or
 // infer a staff identity from an unverified scanned barcode.
})();
