/* Structural guardrails for the unapplied SQL draft.
 * Not a PostgreSQL parser. These checks catch previously observed truncation and
 * duplicate function definitions; a staged PostgreSQL integration test is still required.
 */
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const sql=fs.readFileSync('pos/pos-schema-review.sql','utf8');
const defs=[...sql.matchAll(/create or replace function\s+([a-z_]+\.[a-z_]+)\s*\(/gi)].map(m=>m[1]);
assert.equal(defs.length,new Set(defs).size,'Duplicate function definitions');
const opens=[...sql.matchAll(/\bas\s+(\$\$|\$[A-Za-z_][A-Za-z_0-9]*\$)/g)];
const closes=[...sql.matchAll(/\bend\s+(\$\$|\$[A-Za-z_][A-Za-z_0-9]*\$)\s*;/g)];
assert.ok(opens.length>=8,'Expected POS SQL functions');
assert.equal(opens.length,closes.length,'SQL function bodies have unmatched dollar quotes');
assert.ok(!/\bas\s+\$(?!\$)/.test(sql),'Malformed SQL dollar quote');
assert.ok(!/\bend\s+\$(?!\$)/.test(sql),'Malformed SQL function ending');
for(const name of ['public.pos_complete_cash','public.pos_set_cash_drawer','pos_internal.valid_counts','pos_internal.make_change','public.pos_claim_print_job']){
 assert.ok(defs.includes(name),'Missing SQL function '+name);
}
assert.ok(sql.includes('p_tender_cents integer'),'Cash settlement requires tender amount');
assert.ok(sql.includes('Insufficient exact change in drawer'),'Change availability validated server-side');
assert.ok(sql.includes('tendered_cents,change_cents,change_breakdown'),'Cash receipt audit amounts saved');
console.log('POS SQL draft structural checks passed ('+opens.length+' function bodies). Not a database migration test.');
