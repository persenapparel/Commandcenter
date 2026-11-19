'use strict';
// Staging source contract only. No database access or credentials.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const expected=[
 'staging_owner_enroll_register_scope_20261119.sql',
 'staging_credential_scoped_register_access_20261119.sql',
 'staging_revoke_badge_shifts_on_register_denial_20261119.sql',
 'staging_owner_badge_register_access_read_20261119.sql',
 'staging_owner_badge_scoped_status_20261119.sql',
 'staging_close_all_revoked_staff_handoffs_20261119.sql',
 'staging_owner_paired_single_register_enrollment_20261119.sql',
 'staging_legacy_pending_activation_one_register_20261119.sql',
 'staging_owner_grants_legacy_credential_ids_20261119.sql',
 'staging_owner_grant_conflict_guard_20261119.sql',
 'staging_owner_grant_revocation_credential_version_20261119.sql'
];
test('all reviewed staging-only migration sources are present in release order',()=>{
 for(const file of expected)assert.ok(fs.existsSync(path.join(root,'sql',file)),file);
 const order=read('sql/STAGING-RELEASE-MIGRATION-ORDER.md');
 let last=-1;
 for(const file of expected){const n=order.indexOf(file);assert.ok(n>last,'out-of-order or missing: '+file);last=n;}
});
test('owner enrollment RPC has identical register parameter name in both replacements and cashier caller',()=>{
 const initial=read('sql/'+expected[0]);
 const replacement=read('sql/staging_owner_paired_single_register_enrollment_20261119.sql');
 const cashier=read('register.js');
 assert.match(initial,/p_register_id\s+uuid/);
 assert.match(replacement,/p_register_id\s+uuid/);
 assert.doesNotMatch(replacement,/\bp_register\b/);
 assert.match(cashier,/p_register_id\s*:\s*register\.id/);
});
test('register permission changes remain credential-scoped and revoke legacy access',()=>{
 const grant=read('sql/staging_owner_grant_revocation_credential_version_20261119.sql');
 assert.match(grant,/pos_owner_set_badge_register_access/);
 assert.match(grant,/credential_version/i);
 assert.match(grant,/pos_staff_shifts/i);
 assert.match(grant,/pos_checkout_handoffs/i);
 const first=read('sql/staging_credential_scoped_register_access_20261119.sql');
 assert.match(first,/revoke all on function public\.pos_staff_set_register_access\(uuid,uuid,boolean\)/i);
 const owner=read('sql/staging_owner_paired_single_register_enrollment_20261119.sql');
 assert.match(owner,/REVOKE ALL ON FUNCTION public\.pos_owner_enroll_badge\(integer,text,text,text,text,text\) FROM PUBLIC, anon, authenticated/i);
});
