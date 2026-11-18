(()=>{'use strict';
const $=id=>document.getElementById(id);
const notice=value=>{$('notice').textContent=String(value||'').slice(0,260)};
const db=window.PA?.db;
async function ownerSession(){
 if(!db)return false;
 const {data,error}=await db.auth.getUser();
 return !error&&!!data?.user;
}
(async()=>{
 notice(await ownerSession()
  ?'Ready for badge test. Scan an active employee barcode and enter the employee PIN.'
  :'The owner must sign into the POS staging register in this browser first. No employee email is required.');
})();
$('test-pin').addEventListener('submit',async event=>{
 event.preventDefault();
 const form=event.currentTarget,button=form.querySelector('button'),f=new FormData(form);
 const badge=String(f.get('badge')||'').trim(),pin=String(f.get('pin')||'');
 if(!/^[0-9]{8}$/.test(badge)||pin.length<6){notice('Scan an 8-digit barcode and enter the employee PIN.');return}
 if(!(await ownerSession())){
  notice('Ask the owner to sign into the POS register in this browser first. No employee account is needed.');return;
 }
 button.disabled=true;notice('Checking cashier badge and PIN…');
 try{
  const {data,error}=await db.rpc('pos_staff_test_badge_pin',{p_badge:badge,p_pin:pin});
  if(error)throw error;
  notice(data?.verified===true&&data?.role==='cashier'
    ?'Employee badge and PIN verified! Start Shift in the POS register to test Sales.'
    :'Employee badge/PIN was not verified. Ask the owner to check the badge setup and PIN.');
 }catch(_){notice('Staging could not verify the cashier badge and PIN. No access was granted.')}
 finally{form.querySelector('[name=pin]').value='';button.disabled=false;}
});
})();