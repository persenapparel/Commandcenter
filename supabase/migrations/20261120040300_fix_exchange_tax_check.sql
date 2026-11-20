create or replace function public.pos_manual_adjustment(p_shift uuid,p_secret text,p_register uuid,p_action text,p_sale uuid default null,p_request uuid default null,p_amount integer default null,p_method text default null,p_reason text default null,p_confirmed boolean default false,p_original uuid default null,p_replacement uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare visible jsonb; lines jsonb; choices jsonb; chosen jsonb; prev public.pos_item_exchanges%rowtype; discounted integer; used integer;
begin
 visible:=public.pos_manual_adjustment_internal(p_shift,p_secret,p_register,'list',p_sale);
 if p_action='list' then return visible;end if;
 if p_sale is null or jsonb_array_length(visible->'sales')<>1 then raise exception 'Choose an original sale';end if;
 select ch.items,s.discount_cents into strict lines,discounted from public.pos_sales s join public.pos_checkouts ch on ch.id=s.checkout_id where s.id=p_sale for update of s;
 if p_action in ('return','refund') then
 if exists(select 1 from public.pos_item_exchanges where sale_id=p_sale) then raise exception 'An exchanged sale needs manual review';end if;
 return public.pos_manual_adjustment_internal(p_shift,p_secret,p_register,p_action,p_sale,p_request,p_amount,p_method,p_reason,p_confirmed);
 end if;
 if p_action not in ('exchange_options','exchange') then raise exception 'Unsupported action';end if;
 if discounted<>0 or exists(select 1 from public.pos_merchandise_returns where sale_id=p_sale) or exists(select 1 from public.pos_manual_refunds where sale_id=p_sale) then raise exception 'Discounted, returned or refunded sale needs manual review';end if;
 if p_action='exchange_options' then
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.product_name,'size',i.size,'color',i.color,'price',v.price_cents,'taxable',v.taxable) order by i.product_name,i.color,i.size),'[]') into choices from public.stock_items i join public.pos_variant_details v on v.stock_id=i.id where i.quantity>0 and exists(select 1 from jsonb_array_elements(lines) l where (l->>'unit_cents')::int=v.price_cents and (l->>'taxable')::boolean=v.taxable);
 return jsonb_build_object('originals',(select coalesce(jsonb_agg(l),'[]') from jsonb_array_elements(lines) l where (l->>'qty')::integer>(select count(*) from public.pos_item_exchanges e where e.sale_id=p_sale and e.original_id=(l->>'stock_id')::uuid)),'choices',choices);
 end if;
 if p_confirmed is distinct from true or p_original=p_replacement or p_request is null then raise exception 'Confirm the exchange';end if;
 select * into prev from public.pos_item_exchanges where id=p_request;
 if found then
 if prev.sale_id=p_sale and prev.original_id=p_original and prev.replacement_id=p_replacement then return jsonb_build_object('ok',true);end if;
 raise exception 'Conflicting exchange';end if;
 select l into strict chosen from jsonb_array_elements(lines) l where (l->>'stock_id')::uuid=p_original;
 select count(*) into used from public.pos_item_exchanges where sale_id=p_sale and original_id=p_original;
 if used >= (chosen->>'qty')::integer then raise exception 'Already exchanged';end if;
 perform id from public.stock_items where id in (p_original,p_replacement) order by id for update;
 perform 1 from public.pos_variant_details where stock_id=p_replacement and price_cents=(chosen->>'unit_cents')::integer and taxable=(chosen->>'taxable')::boolean for share;
 if not found then raise exception 'Replacement must have the same value and tax treatment';end if;
 update public.stock_items set quantity=quantity-1 where id=p_replacement and quantity>0;
 if not found then raise exception 'Replacement sold out';end if;
 update public.stock_items set quantity=quantity+1 where id=p_original;
 if not found then raise exception 'Original inventory item unavailable';end if;
 insert into public.pos_item_exchanges(id,sale_id,original_id,replacement_id,staff_id) select p_request,p_sale,p_original,p_replacement,staff_id from public.pos_staff_shifts where id=p_shift;
 return jsonb_build_object('ok',true);
end $$;