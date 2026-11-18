(()=>{'use strict';
const $=id=>document.getElementById(id);
const notice=value=>{$('notice').textContent=String(value||'').slice(0,280)};
let db=null;
async function init(){
 db=window.PA?.db;
 if(!db){notice('Staging Supabase connection not available.');return;}
 await update();
}
async function update(){
 const {data,error}=await db.auth.getUser();
 if(error||!data.user){
  $('sign-out').hidden=true;notice('Sign in with your own separate staging account to test your badge.');
  return;
 }
 $('sign-out').hidden=false;
 notice('Staging account signed in. If the owner has activated your badge, scan it and enter your employee PIN.');
}
function formPayload(form){return new FormData(form)}
$('sign-in').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),f=formPayload(form);
 button.disabled=true;notice('Signing into staging…');
 try{
  const {error}=await db.auth.signInWithPassword({
   email:String(f.get('email')||'').trim(),password:String(f.get('password')||'')
  });
  if(error)throw Error('Sign-in not confirmed');
  form.querySelector('[name=password]').value='';
  await update();
 }catch(_){notice('Sign-in failed. Verify your separate employee email and password, then try again.')}
 finally{form.querySelector('[name=password]').value='';button.disabled=false;}
});
$('sign-up').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),f=formPayload(form);
 const email=String(f.get('email')||'').trim(),password=String(f.get('password')||'');
 if(!email||password.length<12){notice('Use your own email and a unique password of at least 12 characters.');return;}
 button.disabled=true;notice('Creating separate staging account…');
 try{
  const {error}=await db.auth.signUp({email,password,options:{emailRedirectTo:location.origin+'/staff-test.html'}});
  if(error)throw Error('Account registration failed');
  notice('Check your email for confirmation. After confirming, tell the owner to activate your reserved badge, then sign in and test your PIN.');
 }catch(_){notice('Account registration unavailable. Check your email, or ask the owner to verify staging sign-up settings.')}
 finally{form.querySelector('[name=password]').value='';button.disabled=false;}
});
$('test-pin').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),f=formPayload(form);
 const badge=String(f.get('badge')||'').trim(),pin=String(f.get('pin')||'');
 if(!/^[0-9]{8}$/.test(badge)||pin.length<6){notice('Scan your 8-digit employee badge and enter your private employee PIN.');return;}
 button.disabled=true;notice('Checking employee credentials on the staging server…');
 try{
  const result=await db.rpc('pos_staff_test_badge_pin',{p_badge:badge,p_pin:pin});
  if(result.error)throw Error('Verification unavailable');
  notice(result.data?.verified===true
   ?'Employee badge and PIN verified! Cashier credentials are active. This page is a login test; it does not open the register.'
   :'Could not verify. Confirm your account is activated and your employee badge/PIN are correct; failed attempts may temporarily lock the test.');
 }catch(_){notice('Employee verification unavailable. Confirm your account and badge have been activated.')}
 finally{form.querySelector('[name=pin]').value='';button.disabled=false;}
});
$('sign-out').addEventListener('click',async()=>{
 await db.auth.signOut();$('test-pin').reset();await update();
});
void init();
})();