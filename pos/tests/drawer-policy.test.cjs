'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {countDenominations,drawerSummary,authorizeAction}=require('../drawer-policy.js');
test('denomination counts produce cents',()=>assert.equal(countDenominations({2000:2,100:3,25:2,1:4}),4354));
test('cash tenders minus change and refunds, variance',()=>{
 assert.deepEqual(drawerSummary({openingCents:10000,cashTenders:[2500,500],cashChange:[700],cashRefunds:[300],countedCents:12050}),{expectedCents:12000,countedCents:12050,varianceCents:50});
});
test('two count methods rejected',()=>assert.throws(()=>drawerSummary({openingCents:0,countedCents:0,countedDenominations:{}}),/one counting method/));
test('bad amounts and negative expected rejected',()=>{
 assert.throws(()=>drawerSummary({openingCents:0,cashChange:[1]}),/Negative/);
 assert.throws(()=>drawerSummary({openingCents:0,cashTenders:[1.5]}),/Invalid/);
 assert.throws(()=>countDenominations({3:1}),/Invalid/);
});
test('owner action approval contract fails closed for missing, expired or mismatched evidence',()=>{
 const a={serverVerified:true,action:'refund',ownerId:'owner-id',actorId:'cashier-id',verifiedAt:100,expiresAt:110};
 assert.equal(authorizeAction({actorRole:'staff',action:'refund'}),false);
 assert.equal(authorizeAction({actorRole:'staff',action:'discount',approval:a}),false);
 assert.equal(authorizeAction({actorRole:'staff',action:'refund',approval:{...a,expiresAt:100}}),false);
 assert.equal(authorizeAction({actorRole:'staff',action:'refund',approval:a}),true);
});
