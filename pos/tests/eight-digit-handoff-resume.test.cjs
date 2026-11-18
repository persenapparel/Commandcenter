'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=path=>fs.readFileSync('pos/'+path,'utf8');
test('eight-digit staff barcode is valid on idle and customer-handoff resume',()=>{
 const adapter=read('handoff-rpc-adapter.cjs');
 assert.equal(adapter.split('badge.length<8').length-1,2);
 assert.equal(adapter.includes('badge.length<16'),false);
 const sql=read('sql/staging_eight_digit_handoff_resume_fix_20261118.sql');
 const target='public.pos_staff_resume_shift(p_shift_id,p_shift_secret,p_badge,v_checkout.register_id)';
 assert.ok(sql.includes(target));
 assert.ok(!sql.includes('public.pos_staff_resume_shift(p_shift_id,p_shift_secret,p_badge);'));
});
test('SQL resume retains account, checkout, shift and register grant isolation',()=>{
 const sql=read('sql/staging_eight_digit_handoff_resume_fix_20261118.sql');
 for(const marker of ['auth.uid()','pos_staff_register_grants','s.revoked_at is null','capability_digest is null','v_checkout.register_id','SECURITY DEFINER','REVOKE ALL ON FUNCTION public.pos_handoff_resume','TO authenticated'])assert.ok(sql.includes(marker),marker);
 assert.ok(sql.includes('end; $function$;'));
});
