/* Run locally: node pos/tests.cjs — no database writes. */
'use strict';
const assert=require('node:assert/strict');
const C=require('./pos-core.js'), E=require('./pos-events.js');
const tests=[];
function test(name,fn){fn();tests.push(name)}
test('Basic cash totals',()=>assert.deepEqual(C.totals([{qty:2,unit_cents:4000,taxable:true}],10,0),{subtotal_cents:8000,discount_cents:800,tax_cents:0,total_cents:7200}));
test('Rounding and taxes',()=>assert.equal(C.totals([{qty:1,unit_cents:10000,taxable:true}],0,8625).tax_cents,863));
test('Non-taxable item',()=>assert.equal(C.totals([{qty:1,unit_cents:2000,taxable:false}],0,8625).tax_cents,0));
test('100 percent discount',()=>assert.equal(C.totals([{qty:1,unit_cents:2000}],100,8625).total_cents,0));
test('Phone validator',()=>{assert.equal(C.phone('(631) 555-1212'),'(631) 555-1212');assert.throws(()=>C.phone('555'),/phone/)});
test('Discount bounds',()=>assert.throws(()=>C.percent(150),/Discount/));
test('Service labels are normalized',()=>{assert.equal(E.serviceName('Apparel'),'Apparel');assert.equal(E.serviceName('Custom Shirts'),'Other')});
test('Rating invalid values do not count',()=>{assert.equal(E.validRating('6'),null);assert.equal(E.validRating('3'),3);assert.equal(E.validRating(''),null)});
test('Event report excludes other events',()=>{
 const rows=[
  {event_id:'A',snapshot:{items:[{qty:2,unit_cents:2000,service:'Apparel'}],rating:5,marketing_opt_in:true,custom_interest:'yes'},total_cents:3600,discount_cents:400,tax_cents:0},
  {event_id:'A',snapshot:{items:[{qty:1,unit_cents:1500,service:'Custom Printing'}],rating:3,marketing_opt_in:false,custom_interest:'maybe'},total_cents:1500,discount_cents:0,tax_cents:0},
  {event_id:'B',snapshot:{items:[{qty:1,unit_cents:9999,service:'Apparel'}]},total_cents:9999,discount_cents:0,tax_cents:0}
 ];
 const report=E.report(rows,'A');
 assert.equal(report.transactions,2);
 assert.equal(report.units,3);
 assert.equal(report.gross_cents,5500);
 assert.equal(report.discount_cents,400);
 assert.equal(report.collected_cents,5100);
 assert.equal(report.services.Apparel.gross_cents,4000);
 assert.equal(report.services['Custom Printing'].gross_cents,1500);
 assert.equal(report.rating_average,4);
 assert.equal(report.promo_opt_ins,1);
 assert.equal(report.custom_leads,2);
 assert.equal(E.report(rows,'B').transactions,1);
});
test('Walk-in report',()=>assert.equal(E.report([{event_id:null,snapshot:{items:[]},total_cents:0}],null).transactions,1));
console.log('Persen POS: '+tests.length+' tests passed: '+tests.join('; '));
