/* SCBS Book Logistics public and owner dashboard interface */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (value) => `ZMW ${Number(value || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  let publicOptions = [];
  let adminOptions = [];
  let bookingRows = [];
  const setText = (id, text) => { const node=$(id); if(node) node.textContent=text; };
  async function api(url, options={}) {
    const response = await fetch(url, {credentials:'same-origin', ...options, headers:{'Content-Type':'application/json', ...(options.headers||{})}});
    const data = await response.json().catch(()=>({success:false,error:'Unexpected server response.'}));
    if (!response.ok || !data.success) throw new Error(data.error || 'Request failed.');
    return data;
  }
  function renderPublic() {
    const host=$('scbs-logistics-list'); if(!host) return;
    host.replaceChildren();
    if(!publicOptions.length){ setText('scbs-logistics-status','No logistics options have been published yet. Please check again later.'); return; }
    setText('scbs-logistics-status',`${publicOptions.length} logistics option(s) available.`);
    publicOptions.forEach(item=>{
      const card=document.createElement('article'); card.className='scbs-logistics-card';
      const images=(item.vehicle_image_url||item.driver_image_url)?`<div class="scbs-logistics-images">${item.vehicle_image_url?`<figure><img loading="lazy" src="${esc(item.vehicle_image_url)}" alt="Vehicle for ${esc(item.carrier_name)}"><figcaption>Vehicle</figcaption></figure>`:''}${item.driver_image_url?`<figure><img loading="lazy" src="${esc(item.driver_image_url)}" alt="Driver for ${esc(item.carrier_name)}"><figcaption>Driver</figcaption></figure>`:''}</div>`:'';
      card.innerHTML=`${images}<h3>${esc(item.carrier_name)}</h3><p><strong>Cargo:</strong> ${esc(item.cargo_type)}</p><p><strong>Carrier phone:</strong> ${esc(item.carrier_phone)}</p><p><strong>Vehicle plate:</strong> ${esc(item.vehicle_plate)}</p><p class="scbs-logistics-price">${money(item.price_per_kg_zmw)} per kg</p>${item.description?`<p>${esc(item.description)}</p>`:''}<button class="primary" type="button" data-book-id="${Number(item.id)}">Book this logistics</button>`;
      host.append(card);
    });
    host.querySelectorAll('[data-book-id]').forEach(button=>button.addEventListener('click',()=>openBooking(Number(button.dataset.bookId))));
  }
  async function loadPublic() {
    if(!$('scbs-logistics-list')) return;
    try { const data=await api('/api/logistics'); publicOptions=data.logistics||[]; renderPublic(); }
    catch(error){setText('scbs-logistics-status',error.message||'Unable to load logistics.');}
  }
  function openBooking(id) {
    const option=publicOptions.find(item=>Number(item.id)===id); if(!option)return;
    $('scbs-logistics-id').value=String(id); $('scbs-logistics-booking-panel').hidden=false;
    setText('scbs-logistics-selected',`${option.carrier_name} • ${option.cargo_type} • ${money(option.price_per_kg_zmw)} per kg`);
    $('scbs-logistics-booking-form').dataset.rate=String(option.price_per_kg_zmw);
    setText('scbs-logistics-booking-status',''); updateEstimate(); $('scbs-logistics-booking-panel').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function updateEstimate(){const weight=Number($('scbs-logistics-weight')?.value);const rate=Number($('scbs-logistics-booking-form')?.dataset.rate);setText('scbs-logistics-estimate',Number.isFinite(weight)&&weight>0?`Estimated total: ${money(weight*rate)} (${weight} kg × ${money(rate)} per kg)`: 'Estimated total: —');}
  async function submitBooking(event){event.preventDefault();const form=event.currentTarget;const button=$('scbs-logistics-submit');button.disabled=true;setText('scbs-logistics-booking-status','Submitting booking request...');const fd=new FormData(form);const body=Object.fromEntries(fd.entries());body.weight_kg=Number(body.weight_kg);const selectedOption=publicOptions.find(item=>Number(item.id)===Number(body.logistics_id));if(selectedOption)body.cargo_type=selectedOption.cargo_type;try{const data=await api('/api/logistics/bookings',{method:'POST',body:JSON.stringify(body)});setText('scbs-logistics-booking-status',`${data.message} Booking reference: BL-${data.booking_id}. Estimated total: ${money(data.estimated_total_zmw)}.`);form.reset();$('scbs-logistics-booking-panel').hidden=true;}catch(error){setText('scbs-logistics-booking-status',error.message||'Unable to submit booking.');}finally{button.disabled=false;}}
  function renderAdmin(){const list=$('scbs-logistics-admin-list');const bookings=$('scbs-logistics-bookings-list');if(list){list.replaceChildren();if(!adminOptions.length)list.textContent='No carrier options created yet.';adminOptions.forEach(item=>{const row=document.createElement('div');row.className='scbs-logistics-admin-item';row.innerHTML=`<strong>${esc(item.carrier_name)}</strong> — ${esc(item.cargo_type)}<br>Phone: ${esc(item.carrier_phone)} | Plate: ${esc(item.vehicle_plate)}<br>${money(item.price_per_kg_zmw)} per kg<br>Status: ${item.is_active?'Public / active':'Hidden / inactive'}<br><button type="button" class="ghost" data-toggle-logistics="${Number(item.id)}" data-active="${item.is_active?0:1}">${item.is_active?'Hide from public':'Publish / activate'}</button>`;list.append(row);});list.querySelectorAll('[data-toggle-logistics]').forEach(btn=>btn.addEventListener('click',async()=>{btn.disabled=true;try{await api(`/api/admin/logistics/${btn.dataset.toggleLogistics}`,{method:'PATCH',body:JSON.stringify({is_active:Number(btn.dataset.active)})});await loadAdmin();}catch(error){setText('scbs-logistics-admin-status',error.message);}finally{btn.disabled=false;}}));}
    if(bookings){bookings.replaceChildren();if(!bookingRows.length)bookings.textContent='No customer booking requests received yet.';bookingRows.forEach(item=>{const row=document.createElement('article');row.className='scbs-logistics-booking-item';row.innerHTML=`<strong>Booking BL-${Number(item.id)} — ${esc(item.customer_name)}</strong><p>${esc(item.customer_email)} • ${esc(item.customer_phone)}</p><p>Carrier: ${esc(item.carrier_name||'Carrier unavailable')} • ${esc(item.cargo_type)} • ${esc(item.weight_kg)} kg</p><p>Rate: ${money(item.rate_per_kg_zmw)}/kg • Estimated total: <strong>${money(item.estimated_total_zmw)}</strong></p><p>Vehicle: ${esc(item.vehicle_plate||'—')} • Submitted: ${esc(new Date(item.created_at).toLocaleString())}</p>${item.notes?`<p>Notes: ${esc(item.notes)}</p>`:''}<label>Status <select data-booking-status="${Number(item.id)}"><option value="pending" ${item.status==='pending'?'selected':''}>Pending</option><option value="confirmed" ${item.status==='confirmed'?'selected':''}>Confirmed</option><option value="in_transit" ${item.status==='in_transit'?'selected':''}>In transit</option><option value="completed" ${item.status==='completed'?'selected':''}>Completed</option><option value="cancelled" ${item.status==='cancelled'?'selected':''}>Cancelled</option></select></label>`;bookings.append(row);});bookings.querySelectorAll('[data-booking-status]').forEach(select=>select.addEventListener('change',async()=>{try{await api(`/api/admin/logistics-bookings/${select.dataset.bookingStatus}`,{method:'PATCH',body:JSON.stringify({status:select.value})});setText('scbs-logistics-admin-status','Booking status updated.');await loadAdmin();}catch(error){setText('scbs-logistics-admin-status',error.message);}}));}}
  async function loadAdmin(){if(!$('scbs-logistics-admin-list'))return;setText('scbs-logistics-admin-status','Loading logistics and bookings...');try{const data=await api('/api/admin/logistics');adminOptions=data.logistics||[];bookingRows=data.bookings||[];renderAdmin();setText('scbs-logistics-admin-status','Logistics and customer bookings refreshed.');}catch(error){setText('scbs-logistics-admin-status',error.message||'Sign in as administrator to manage logistics.');}}
  async function saveOption(event){event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button[type="submit"]');button.disabled=true;setText('scbs-logistics-admin-status','Saving carrier...');const body=Object.fromEntries(new FormData(form).entries());body.price_per_kg_zmw=Number(body.price_per_kg_zmw);try{await api('/api/admin/logistics',{method:'POST',body:JSON.stringify(body)});form.reset();setText('scbs-logistics-admin-status','Carrier saved and available on the public Book Logistics tab.');await loadAdmin();await loadPublic();}catch(error){setText('scbs-logistics-admin-status',error.message||'Unable to save carrier.');}finally{button.disabled=false;}}
  document.addEventListener('DOMContentLoaded',()=>{loadPublic();$('scbs-logistics-weight')?.addEventListener('input',updateEstimate);$('scbs-logistics-booking-form')?.addEventListener('submit',submitBooking);$('scbs-logistics-cancel')?.addEventListener('click',()=>{$('scbs-logistics-booking-panel').hidden=true;});$('scbs-logistics-admin-form')?.addEventListener('submit',saveOption);$('scbs-logistics-refresh')?.addEventListener('click',loadAdmin);$('admin-open')?.addEventListener('click',()=>setTimeout(loadAdmin,250));$('admin-logout')?.addEventListener('click',()=>{setTimeout(()=>{setText('scbs-logistics-admin-status','Sign in as administrator to manage logistics.');},100);});});
})();
