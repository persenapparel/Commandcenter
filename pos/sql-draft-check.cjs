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
assert.ok(opens.length>=5,'Expected POS SQL functions');
assert.equal(opens.length,closes.length,'SQL function bodies have unmatched dollar quotes');
assert.ok(!/\bas\s+\$(?!\$)/.test(sql),'Malformed SQL dollar quote');
assert.ok(!/\bend\s+\$(?!\$)/.test(sql),'Malformed SQL function ending');
for(const name of ['public.pos_complete_cash','public.pos_claim_print_job','public.pos_begin_checkout','public.pos_customer_view']){
 assert.ok(defs.includes(name),'Missing SQL function '+name);
}
assert.ok(sql.includes('pos_print_jobs'),'Receipt print queue is defined');
console.log('POS SQL draft structural checks passed ('+opens.length+' function bodies). Not a database migration test.');
