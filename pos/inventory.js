'use strict';
async function bootInventory(){
 const notice=document.getElementById('notice');
 try{
  const user=await PA.me();if(!user){notice.textContent='Sign in to manage inventory.';return}
  if(!await PA.isAdmin(user))throw Error('Owner access required');
  document.getElementById('inventory-login').hidden=true;
  if(!document.getElementById('inventory-hub-root')){const host=document.createElement('section');host.id='inventory-hub-root';document.getElementById('inventory-mount').append(host)}
  notice.textContent='Same inventory editor and Sales Products tables as Command Center. This preview uses test stock.';
 }catch(e){notice.textContent=e.message}
}
document.getElementById('inventory-login').onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);await PA.signIn(f.get('email'),f.get('password'));await bootInventory()}catch(err){document.getElementById('notice').textContent=err.message}};
bootInventory();
