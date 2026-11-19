'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=f=>fs.readFileSync('pos/'+f,'utf8');
const migration=read('sql/staging_fix_owner_paired_badge_uniqueness_20261118.sql');
const register=read('register.js');
test('old one-staff-per-owner unique index is dropped but badge uniqueness stays',()=>{
 assert.match(migration,/drop index if exists public\.pos_staff_credentials_user_unique/);
 assert.match(migration,/create unique index if not exists pos_staff_credentials_owner_auth_unique/);
 assert.match(migration,/where staff_role='owner'/);
 assert.doesNotMatch(migration,/drop (?:index|constraint).*badge_digest_key/);
});
test('owner enrollment targets owner-only index and never upgrades employee cashier row',()=>{
 assert.match(migration,/on conflict\(auth_user_id\) where staff_role='owner' do update/);
 assert.match(migration,/staff_role='owner'/);
 assert.match(migration,/staff_role='cashier'/);
});
test('testing two cashier badges uses the scanned barcode rather than random account row',()=>{
 assert.match(migration,/badge_digest=extensions\.digest\(p_badge,'sha256'\)/);
 assert.match(migration,/where auth_user_id=v_uid and enabled=true and staff_role='cashier'/);
 assert.match(migration,/v_staff\.badge_digest=extensions\.digest\(p_badge,'sha256'\)/);
});
test('legacy grant API fails closed when owner account has multiple badge identities',()=>{
 assert.match(migration,/select count\(\*\) from public\.pos_staff_credentials/);
 assert.match(migration,/auth_user_id=p_staff_user and enabled=true\)=1/);
});
test('a database conflict cannot be mislabeled as reused barcode or PIN',()=>{
 assert.match(migration,/'reason','enrollment_conflict'/);
 assert.match(register,/enrollment_conflict:'The employee badge could not be saved/);
});
