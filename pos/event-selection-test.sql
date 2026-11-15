-- Rollback-only integration checks. Supply an existing authorized owner using request.jwt.claim.sub.
begin;
set local role authenticated;
do $$
declare eid uuid; eid2 uuid; reg uuid; chk uuid; sid uuid; sid2 uuid; stockid uuid; n integer; names text[];
begin
 if auth.uid() is null then raise exception 'Test requires owner JWT claim';end if;
 perform public.inventory_save_size_grid('POS EVENT TEST SALES','sales',4000,'[{"color":"Test","size":"M","quantity":3}]');
 perform public.inventory_save_size_grid('POS EVENT TEST BLANK','blanks',null,'[{"color":"Test","size":"M","quantity":3}]');
 eid:=public.pos_save_event_selection(null,'POS EVENT TEST',current_date,array['POS EVENT TEST SALES']);
 eid2:=public.pos_save_event_selection(null,'POS EVENT TEST',current_date,array['POS EVENT TEST SALES']);
 if eid<>eid2 then raise exception 'Duplicate event on repeated save';end if;
 select array_agg(t.product_name) into names from public.pos_events e join public.inventory_event_quick_products t on t.event_id=e.inventory_profile_id where e.id=eid;
 if names<>array['POS EVENT TEST SALES'] then raise exception 'Shared event selection failed';end if;
 begin
  perform public.pos_save_event_selection(eid,'POS EVENT TEST',current_date,array['POS EVENT TEST BLANK']);
  raise exception 'TEST FAILURE: blank accepted';
 exception when others then if sqlerrm='TEST FAILURE: blank accepted' then raise;end if;end;
 insert into public.pos_registers(owner_id,label) values(auth.uid(),'ROLLBACK ONLY') returning id into reg;
 select id into stockid from public.stock_items where product_name='POS EVENT TEST SALES';
 begin
  perform public.pos_begin_checkout(reg,jsonb_build_array(jsonb_build_object('stock_id',stockid,'qty',1,'unit_cents',1,'taxable',true)),0,0,eid);
  raise exception 'TEST FAILURE: tampered price accepted';
 exception when others then if sqlerrm='TEST FAILURE: tampered price accepted' then raise;end if;end;
 chk:=public.pos_begin_checkout(reg,jsonb_build_array(jsonb_build_object('stock_id',stockid,'qty',1,'unit_cents',4000,'taxable',true)),0,0,eid);
 perform public.pos_submit_customer(public.pos_issue_display_pairing(reg),chk,'2025550100','',false,null,'not_answered','cash',true,false);
 sid:=public.pos_complete_cash(chk,4000);
 sid2:=public.pos_complete_cash(chk,4000);
 if sid<>sid2 then raise exception 'Duplicate sale';end if;
 select quantity into n from public.stock_items where id=stockid;
 if n<>2 then raise exception 'Stock was not deducted exactly once';end if;
 if not exists(select 1 from public.pos_sales where id=sid and event_id=eid) then raise exception 'Event report attribution failed';end if;
 -- Stock edited in the shared inventory path is immediately read by the register source.
 perform public.inventory_save_size_grid('POS EVENT TEST SALES','sales',4000,'[{"color":"Test","size":"M","quantity":5}]');
 select quantity into n from public.stock_items where id=stockid;
 if n<>5 then raise exception 'Shared inventory update failed';end if;
end $$;
reset role;
select 'PASS: shared inventory, event persistence, blanks rejected, tampered price rejected, stock deduction, idempotent sale and event attribution' as result;
rollback;
