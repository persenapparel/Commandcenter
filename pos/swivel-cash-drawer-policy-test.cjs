'use strict';
// Staging-only structural safeguards. These do NOT prove RLS, real staff auth,
// device behavior, or actual Epson drawer operation.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('pos/epson-t20iv-staging.sql','utf8');
const swivel=fs.readFileSync('pos/swivel-mode.js','utf8');
const policy=fs.readFileSync('pos/STAFF-BADGE-CHECKOUT-PLAN.md','utf8');
const register=fs.readFileSync('pos/register.js','utf8');

assert.match(sql,/if new\.payment_method <> 'cash' then return new;/i,
 'noncash sale must never queue drawer opening');
assert.match(sql,/create unique index if not exists pos_drawer_open_cash_once on public\.pos_drawer_open_jobs\(sale_id\)/i,
 'one automatic cash drawer job per sale');
assert.match(sql,/create trigger pos_saved_sale_drawer_job after insert on public\.pos_sales/i,
 'drawer job must be queued from saved sale, not UI tender entry');
assert.match(sql,/if \(select auth\.uid\(\)\) is null or not public\.is_persen_admin\(\) then raise exception 'Unauthorized'; end if;/i,
 'owner-only manual drawer function must check authenticated admin');
assert.match(sql,/state='queued'/i,'drawer job must be claimed only from queued state');
assert.match(swivel,/dataset\.checkoutDeviceMode='swivel'/,
 'swivel must be sole offered checkout mode');
assert.match(swivel,/document\.querySelector\('\.pos-device-mode'\)\?\.remove\(\)/,
 'legacy mode selector must not be offered');
assert.match(register,/setRegisterOpen\(false\)/,'successful sale must return to welcome');
assert.match(policy,/\*\*Luke only\*\*/,'only Luke may approve');
assert.match(policy,/\*\*Colleen and Logan MAY accept and record cash/,
 'cashiers must be able to process cash');
assert.match(policy,/no owner scan needed for each normal cash transaction/,
 'ordinary cash sales must not require owner intervention');
assert.match(policy,/do not open on badge login/i,
 'badge scan must not open drawer');
assert.match(policy,/no owner scan needed for each normal cash transaction/,
 'cashier cash flow is authorized');
console.log('PASS: staged structural invariants for swivel checkout and cash drawer policy');
console.log('NOT VERIFIED: staff badge backend, RLS, duplicate sale concurrency, Epson hardware, and customer iframe isolation');
