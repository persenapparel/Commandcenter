/* Shared Supabase client for the storefront and owner dashboard.
   Production access is enforced by Supabase Row Level Security, not by this JavaScript. */
'use strict';
(function(){
  const cfg=window.PERSEN_CONFIG||{};
  const ready=Boolean(cfg.supabaseUrl && cfg.supabasePublishableKey && window.supabase?.createClient);
  const db=ready?window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey):null;
  async function checked(promise){const {data,error}=await promise;if(error)throw error;return data}
  async function me(){if(!db)return null; const {data,error}=await db.auth.getUser();if(error)return null;return data.user||null}
  async function isAdmin(user){if(!db||!user)return false;const d=await checked(db.from('admin_users').select('user_id').eq('user_id',user.id).maybeSingle());return !!d}
  async function getProducts(){if(!db)return null;return checked(db.from('products').select('id,name,category,kind,colors,description,sort_order').eq('active',true).order('sort_order'))}
  async function getContent(){if(!db)return null;return checked(db.from('site_content').select('key,value'))}
  async function signIn(email,password){if(!db)throw Error('Customer accounts need Supabase setup first.');const {data,error}=await db.auth.signInWithPassword({email,password});if(error)throw error;return data}
  async function signUp(email,password){if(!db)throw Error('Customer accounts need Supabase setup first.');const {data,error}=await db.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname+'#/account'}});if(error)throw error;return data}
  async function signOut(){if(db)await db.auth.signOut()}
  async function myDesigns(){const user=await me();if(!user)return [];return checked(db.from('saved_designs').select('id,name,draft,created_at').eq('user_id',user.id).order('created_at',{ascending:false}))}
  async function saveDesign(name,draft){const user=await me();if(!user)throw Error('Sign in first to save designs to your account.');const json=JSON.stringify(draft);if(json.length>350000)throw Error('This design includes a large image. Download your proof and try a smaller uploaded image before cloud saving.');return checked(db.from('saved_designs').insert({user_id:user.id,name,draft}).select('id').single())}
  async function deleteDesign(id){const user=await me();if(!user)throw Error('Sign in first.');return checked(db.from('saved_designs').delete().eq('id',id).eq('user_id',user.id))}
  async function submitQuote(payload){const user=await me();if(!user)throw Error('Sign in to submit a trackable quote request.');return checked(db.from('quote_requests').insert({user_id:user.id,name:String(payload.name).slice(0,100),email:user.email,category:String(payload.category).slice(0,120),quantity:Math.min(100000,Math.max(1,Number(payload.quantity)||1)),details:String(payload.details).slice(0,5000),design_summary:payload.design_summary||null,contact_phone:String(payload.phone||'').slice(0,40),sms_consent:!!payload.smsConsent}).select('id,created_at').single())}
  async function myQuotes(){const user=await me();if(!user)return [];return checked(db.from('quote_requests').select('id,category,quantity,details,status,created_at').eq('user_id',user.id).order('created_at',{ascending:false}))}
  async function placeLimitedOrder(o){const user=await me();if(!user)throw Error('Sign in to place an order.');const data=await checked(db.rpc('place_limited_collection_order',{p_item_id:o.itemId,p_name:o.name,p_size:o.size,p_qty:o.qty,p_fulfillment:o.fulfillment,p_phone:o.phone,p_notes:o.notes,p_sms_consent:o.smsConsent,p_checkout_token:o.checkoutToken}));if(!data?.id)throw Error('Order did not return a confirmation number.');return data}
  async function myOrders(){const user=await me();if(!user)return [];return checked(db.from('customer_orders').select('id,title,status,fulfillment,tracking_reference,updated_at,created_at,order_source,item_size,item_quantity,item_subtotal,payment_status').eq('user_id',user.id).order('created_at',{ascending:false}))}
  window.PA={db,ready,checked,me,isAdmin,getProducts,getContent,signIn,signUp,signOut,myDesigns,saveDesign,deleteDesign,submitQuote,placeLimitedOrder,myQuotes,myOrders};
})();
