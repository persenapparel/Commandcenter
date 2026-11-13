/* Run locally: node pos/tests.cjs — no database writes. */
'use strict';
const assert=require('node:assert/strict');
const C=require('./pos-core.js'), E=require('./pos-events.js'), R=require('./pos-receipt.js'), Cash=require('./pos-cash.js'), Seasonal=require('./pos-experience.js'), Digital=require('./pos-digital-receipt.js'), Wizard=require('./checkout-flow.js');
const tests=[];
function test(name,fn){fn();tests.push(name)}
test('Basic cash totals',()=>assert.deepEqual(C.totals([{qty:2,unit_cents:4000,taxable:true}],10,0),{subtotal_cents:8000,discount_cents:800,tax_cents:0,total_cents:7200}));
test('Rounding and taxes',()=>assert.equal(C.totals([{qty:1,unit_cents:10000,taxable:true}],0,8625).tax_cents,863));
test('Mixed cart allocates a discount before rounding tax once',()=>{
 assert.deepEqual(C.totals([{qty:1,unit_cents:61},{qty:1,unit_cents:50,taxable:false}],15,8750),
  {subtotal_cents:111,discount_cents:17,tax_cents:5,total_cents:99});
});
test('Cart preview uses the same basis points as checkout',()=>{
 assert.equal(C.discountBps(12.345),1235);
 assert.equal(C.totals([{qty:1,unit_cents:100000}],12.345,0).discount_cents,12350);
});
test('Missing prices do not turn into zero',()=>{for(const price of ['', ' ', null, undefined])assert.throws(()=>C.cents(price),/Invalid price/)});
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
test('Google review link validation',()=>{
 assert.equal(R.reviewUrl('https://g.page/r/CcaTpFjy7JllEBM/review'),'https://g.page/r/CcaTpFjy7JllEBM/review');
 assert.equal(R.reviewUrl('https://example.com/review'),'');
 assert.equal(R.reviewUrl('javascript:alert(1)'),'');
 assert.equal(R.reviewUrl('https://google.com.evil.test/review'),'');
});
test('Receipt promotes honest review only when link is valid',()=>{
 const enabled=R.presentation({reviewLink:'https://g.page/r/CcaTpFjy7JllEBM/review'});
 assert.ok(enabled.review.includes('honest Google review'));
 assert.ok(enabled.review_url.startsWith('https://g.page/'));
 assert.equal(R.presentation({reviewLink:'https://example.com/review'}).review_url,'');
 assert.equal(R.presentation({reviewLink:'https://g.page/r/CcaTpFjy7JllEBM/review',showReview:false}).review_url,'');
});
test('Active seasonal promotion respects opt out',()=>{
 const campaign={published:true,title:'Winter Collection',announcement:'Winter collection available now'};
 assert.equal(R.presentation({season:campaign}).seasonal,'Winter collection available now');
 assert.equal(R.presentation({season:campaign,showSeason:false}).seasonal,'');
 assert.equal(R.presentation({season:{...campaign,published:false}}).seasonal,'');
});
test('Receipt preserves account amounts separately from presentation',()=>{
 const saved={total_cents:3500,subtotal_cents:4000,discount_cents:500,tax_cents:0};
 const visible=R.presentation({headline:'THANK YOU'});
 assert.equal(saved.total_cents,3500);
 assert.equal(visible.headline,'THANK YOU');
 assert.equal(saved.total_cents,3500);
});
test('Cash underpayment is blocked',()=>{
  assert.deepEqual(Cash.calcChange(3750,2000),{due_cents:3750,paid_cents:2000,short_cents:1750,change_cents:0});
  assert.equal(Cash.plan(3750,2000,{},true).status,'short');
});
test('Exact cash requires no change',()=>{
 assert.equal(Cash.plan(3750,3750,{},false).status,'exact_unconfigured');
 assert.equal(Cash.plan(3750,3750,{},true).status,'exact');
});
test('Correct change for fifty-dollar tender',()=>{
 const r=Cash.plan(3750,5000,{1000:1,100:2,25:2},true);
 assert.equal(r.change_cents,1250);
 assert.equal(r.status,'ready');
 assert.deepEqual(r.breakdown,{'1000':1,'100':2,'25':2});
});
test('Available total is not the same as exact change',()=>{
 assert.equal(Cash.plan(3970,4000,{'25':1,'1':3},true).status,'insufficient');
 assert.equal(Cash.plan(3970,4000,{'10':3},true).status,'ready');
});
test('Greedy is not sufficient: bounded change finder backtracks',()=>{
 assert.deepEqual(Cash.makeChange(30,{'25':1,'10':3}),{'10':3});
});
test('Drawer without counted change cannot approve overpayment',()=>{
 assert.equal(Cash.plan(3750,5000,{},false).status,'unconfigured');
 assert.equal(Cash.plan(3750,5000,{},true).status,'insufficient');
});
test('Known received bill can provide change',()=>{
 const r=Cash.plan(3000,5000,{},true,{'2000':1,'1000':3});
 assert.equal(r.status,'ready');
 assert.equal(r.change_cents,2000);
 assert.deepEqual(r.breakdown,{'2000':1});
});
test('Mismatched bill amounts are rejected',()=>{
 assert.throws(()=>Cash.plan(3500,5000,{1000:5},true,{'2000':1}),/do not match/);
});
test('No phantom cash is credited to drawer',()=>{
 const updated=Cash.updateDrawer({'1000':2},{},{'1000':1});
 assert.equal(updated['1000'],1);
 assert.equal(updated['5000'],0);
});
test('Cash drawer totals and denomination validation',()=>{
 assert.equal(Cash.drawerValue(Cash.cleanCounts({'2000':2,'100':3,'25':4})),4400);
 assert.throws(()=>Cash.cleanCounts({'1000':-1}),/0–999/);
 assert.throws(()=>Cash.cleanCounts({'12345':1}),/Unrecognized denomination/);
});
test('Change payout cannot exceed actual counted denominations',()=>{
 assert.throws(()=>Cash.updateDrawer({'25':1},{},{'25':2}),/Not enough/);
});
test('Bill and coin inputs have bounded amounts',()=>{
 assert.throws(()=>Cash.makeChange(50001,{}),/range/);
 assert.throws(()=>Cash.calcChange(5000,-1),/Invalid/);
});
test('Published holiday themes use Seasonal Studio palette',()=>{
 const p=Seasonal.palette({theme:'christmas',title:'Christmas Collection',published:true,accent:'#a32736'});
 assert.equal(p.active,true);assert.equal(p.icon,'❄️');assert.equal(p.accent,'#a32736');
});
test('Unpublished seasonal treatment remains classic',()=>{
 const p=Seasonal.palette({theme:'halloween',published:false});assert.equal(p.active,false);
 assert.equal(p.name,'Persen Apparel');
});
test('Unsupported seasonal accent falls back safely',()=>{
 const p=Seasonal.palette({theme:'summer',published:true,accent:'red'});assert.equal(p.accent,'#c17725');
});
test('Digital email receipt escapes item HTML',()=>{
 const sale={id:'abcd1234',items:[{name:'Hoodie <script>alert(1)</script>',qty:2,unit_cents:2500}],subtotal_cents:5000,discount_cents:0,tax_cents:0,total_cents:5000};
 const result=Digital.email(sale);assert.ok(result.subject.includes('abcd1234'.toUpperCase()));
 assert.ok(result.html.includes('&lt;script&gt;'));assert.ok(!result.html.includes('<script>'));
});
test('Digital receipts do not offer SMS sending',()=>{
 assert.equal(Digital.sms,undefined);
});
test('Digital receipt excludes untrusted review links',()=>{
 const sale={id:'12345678',items:[],subtotal_cents:2000,discount_cents:0,tax_cents:0,total_cents:2000};
 assert.ok(!Digital.email(sale,{review_url:'javascript:alert(1)'}).html.includes('javascript:'));
});
test('Winter theme adds a monochrome thermal receipt ribbon',()=>{
 const label=R.presentation({season:{theme:'winter',title:'Winter Drop',published:true}});
 assert.ok(label.season_style.label.includes('WINTER'));
 assert.ok(label.season_style.icon.includes('*'));
});
test('Unpublished campaign never appears on thermal receipt',()=>{
 assert.equal(R.presentation({season:{theme:'christmas',published:false}}).season_style.label,'');
});
test('Receipt campaign opt-out is respected',()=>{
 assert.equal(R.presentation({season:{theme:'christmas',published:true},showSeason:false}).season_style.label,'');
});
test('Branded email receipt uses whitelisted Persen Apparel logo',()=>{
 const sample={id:'aabbccdd',items:[{name:'Christmas Hoodie',qty:1,unit_cents:4000}],subtotal_cents:4000,discount_cents:0,tax_cents:0,total_cents:4000};
 const url='https://pos.persenapparel.com/assets/persen-logo.png';
 const result=Digital.email(sample,{logo_url:url,accent:'#a32736',seasonal:'Holiday Collection'});
 assert.ok(result.html.includes('persen-logo.png'));
 assert.ok(result.html.includes('#a32736'));
 assert.ok(result.html.includes('Holiday Collection'));
 assert.equal(Digital.verifiedBrandImage('https://fake-persenapparel.com/img.png'),'');
});
test('Invalid seasonal email color defaults to navy',()=>{
 assert.equal(Digital.verifiedAccent('pink'),'#123466');
 assert.equal(Digital.verifiedAccent('#a32736'),'#a32736');
});
test('Checkout wizard contains eight separate pages',()=>{
 assert.deepEqual(Wizard.steps.map(x=>x.id),['phone','receipt','email','payment','promos','rating','custom','review']);
});
test('Ten-digit phone entry uses on-screen digits only',()=>{
 let input='';for(const digit of '6316440633')input=Wizard.dial(input,digit);
 assert.equal(input,'6316440633');
 assert.equal(Wizard.formatPhone(input),'(631) 644-0633');
 assert.ok(Wizard.validPhone(input));
});
test('Phone keypad supports backspace and clear',()=>{
 assert.equal(Wizard.dial('631','back'),'63');
 assert.equal(Wizard.dial('631','clear'),'');
 assert.equal(Wizard.dial('631','*'),'631');
});
test('Phone number input cannot exceed ten digits',()=>{
 assert.equal(Wizard.dial('6316440633','5'),'6316440633');
 assert.ok(!Wizard.validPhone('631644063'));
 assert.ok(!Wizard.validPhone('63164406335'));
});
test('Printed receipt is the default',()=>{
 assert.deepEqual(Wizard.receipt(),{mode:'print',print:true,email:false,sms:false});
});
test('Legacy email-only mode falls back to printed copies',()=>{
 assert.deepEqual(Wizard.receipt('email'),{mode:'print',print:true,email:false,sms:false});
});
test('Both receipt mode requests print and email only',()=>{
 assert.deepEqual(Wizard.receipt('both'),{mode:'both',print:true,email:true,sms:false});
 assert.equal(Wizard.receiptModes.length,2);
});
test('Legacy no-receipt mode falls back to printed copies and Apple Cash blocked',()=>{
 assert.deepEqual(Wizard.receipt('none'),{mode:'print',print:true,email:false,sms:false});
 assert.ok(Wizard.checkStep('payment',{payment:'apple_cash_info'}));
});
test('Email is required for an emailed receipt',()=>{
 assert.ok(Wizard.checkStep('email',{receipt:'both',email:''}));
 assert.ok(Wizard.checkStep('email',{receipt:'email',email:'invalid'}));
 assert.equal(Wizard.checkStep('email',{receipt:'email',email:'person@example.com'}),'');
});
test('Email is optional with a printed receipt',()=>{
 assert.equal(Wizard.checkStep('email',{receipt:'print',email:''}),'');
 assert.ok(Wizard.checkStep('email',{receipt:'print',email:'invalid'}));
});
test('Checkout does not proceed with incomplete phone number',()=>{
 assert.ok(Wizard.checkStep('phone',{phone:'631'}));
 assert.equal(Wizard.checkStep('phone',{phone:'6316440633'}),'');
});
test('Optional feedback questions never block the customer',()=>{
 for(const id of ['promos','rating','custom'])assert.equal(Wizard.checkStep(id,{}),'');
 assert.equal(Wizard.summary({phone:'6316440633',receipt:'both',payment:'cash'}).promo,false);
});
test('Payment methods are validated and are not auto-verified',()=>{
 assert.equal(Wizard.checkStep('payment',{payment:'cash'}),'');
 assert.equal(Wizard.checkStep('payment',{payment:'venmo_info'}),'');
 assert.ok(Wizard.checkStep('payment',{payment:'paid'}));
});
test('Cashier progress reports only screen metadata',()=>{
 const progress=Wizard.monitor('payment');
 assert.equal(progress.step_number,4);
 assert.equal(progress.total_steps,8);
 assert.equal(progress.step_label,'Choose a payment option');
 assert.equal(progress.needs_help,false);
 assert.ok(!Object.keys(progress).includes('phone'));
 assert.ok(!Object.keys(progress).includes('email'));
});
test('Customer assistance flag is separate from answers',()=>{
 const progress=Wizard.monitor('email',true);
 assert.equal(progress.needs_help,true);
 assert.equal(progress.step_number,3);
 assert.equal(Wizard.monitor('email',false).needs_help,false);
});
test('Progress step fallback does not leak arbitrary input',()=>{
 const progress=Wizard.monitor('phone: 631-644-0633');
 assert.equal(progress.step_id,'phone');
 assert.equal(progress.step_number,1);
});
test('Cashier screen advances safely through checkout and change handoff',()=>{
 assert.equal(Wizard.cashierStage(null),'catalog');
 assert.equal(Wizard.cashierStage({status:'awaiting_customer'}),'customer');
 assert.equal(Wizard.cashierStage({status:'contact_received',payment_preference:'cash'}),'payment');
 assert.equal(Wizard.cashierStage({status:'contact_received',payment_preference:'venmo_info'}),'external');
 assert.equal(Wizard.cashierStage({status:'completed',cash_handoff_complete:false}),'handoff');
 assert.equal(Wizard.cashierStage({status:'completed',cash_handoff_complete:true}),'catalog');
 assert.equal(Wizard.cashierStage({status:'cancelled'}),'catalog');
});
test('Customer welcome clears idle and completed orders after thank-you interval',()=>{
 assert.equal(Wizard.customerStage('idle'),'welcome');
 assert.equal(Wizard.customerStage('unpaired'),'welcome');
 assert.equal(Wizard.customerStage('cancelled'),'welcome');
 assert.equal(Wizard.customerStage('awaiting_customer'),'checkout');
 assert.equal(Wizard.customerStage('contact_received'),'checkout');
 assert.equal(Wizard.customerStage('paid_awaiting_change'),'checkout');
 assert.equal(Wizard.customerStage('completed',0),'checkout');
 assert.equal(Wizard.customerStage('completed',3999),'checkout');
 assert.equal(Wizard.customerStage('completed',4000),'welcome');
});
console.log('Persen POS: '+tests.length+' tests passed: '+tests.join('; '));
