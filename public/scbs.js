const region=document.getElementById('toast-region');
function notify(title,message,type='info',duration=5000){const t=document.createElement('div');t.className='toast '+type;const m=document.createElement('div');m.className='mark';m.textContent=type==='success'?'+':type==='error'?'! ':'i';const c=document.createElement('div');const h=document.createElement('strong');h.textContent=title;const p=document.createElement('p');p.textContent=message;c.append(h,p);const x=document.createElement('button');x.className='close';x.textContent='x';x.setAttribute('aria-label','Dismiss notification');x.onclick=()=>t.remove();t.append(m,c,x);region.append(t);setTimeout(()=>t.remove(),duration)}
document.getElementById('year').textContent=new Date().getFullYear();
document.querySelectorAll('.action').forEach(b=>b.addEventListener('click',()=>notify(b.dataset.title,b.dataset.msg)));

// ============================================
 // SCBS CUSTOMER AUTHENTICATION - single click and submit handler
 // ============================================
 (() => {
   'use strict';
   const login = document.getElementById('login-backdrop');
   const openButton = document.getElementById('customer-login');
   const closeButton = document.getElementById('close-login');
   const form = document.getElementById('login-form');
   const status = document.getElementById('customer-login-status');
   const submitButton = document.getElementById('customer-submit');
   const registerForm = document.getElementById('register-form');
   const dashboard = document.getElementById('customer-dashboard');

   if (!login || !openButton || !closeButton || !form || !status) return;

   function openLogin() {
     login.hidden = false;
     form.hidden = false;
     if (registerForm) registerForm.hidden = true;
     status.textContent = '';
     document.getElementById('customer-register-status')?.replaceChildren();
     document.getElementById('login-email')?.focus({ preventScroll: true });
   }
   function closeLogin() { login.hidden = true; }
   function emitCustomerReady() {
     window.dispatchEvent(new CustomEvent('scbs:customer-session-ready'));
   }
   async function parseResponse(response) {
     const raw = await response.text();
     try { return JSON.parse(raw); }
     catch {
       throw new Error(response.status === 429
         ? 'Too many requests. Please wait a little and try again.'
         : `The server returned an unexpected response (HTTP ${response.status}). Please try again.`);
     }
   }

   openButton.addEventListener('click', async () => {
     openButton.disabled = true;
     try {
       const response = await fetch('/api/customer/me', {
         credentials: 'same-origin',
         headers: { Accept: 'application/json' }
       });
       const result = await parseResponse(response);
       if (response.ok && result.success === true && result.customer) {
         closeLogin();
         emitCustomerReady();
         dashboard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
       } else {
         openLogin();
       }
     } catch {
       // Keep sign-in available even if session-check endpoint has a temporary issue.
       openLogin();
     } finally {
       openButton.disabled = false;
     }
   });

   closeButton.addEventListener('click', closeLogin);
   login.addEventListener('click', event => {
     if (event.target === login) closeLogin();
   });
   document.addEventListener('keydown', event => {
     if (event.key === 'Escape') closeLogin();
   });

   form.addEventListener('submit', async event => {
     event.preventDefault();
     if (submitButton) {
       submitButton.disabled = true;
       submitButton.textContent = 'Signing in...';
     }
     status.textContent = 'Securely signing you in...';
     try {
       const response = await fetch('/api/customer/login', {
         method: 'POST',
         credentials: 'same-origin',
         headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
         body: JSON.stringify({
           email: document.getElementById('login-email').value.trim(),
           password: document.getElementById('login-password').value
         })
       });
       const result = await parseResponse(response);
       if (!response.ok || result.success !== true) {
         throw new Error(result.error || result.message || 'Customer sign-in failed.');
       }
       form.reset();
       closeLogin();
       openButton.textContent = 'My Account';
       emitCustomerReady();
       notify('Welcome to SCBS', 'Your account is opening.', 'success');
       // The dashboard loader displays the customer account after checking the session.
       window.setTimeout(() => dashboard?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
     } catch (error) {
       status.textContent = error.message || 'Unable to sign in. Please try again.';
     } finally {
       if (submitButton) {
         submitButton.disabled = false;
         submitButton.textContent = 'Sign In';
       }
     }
   });

   console.info('SCBS customer authentication initialized.');
 })();
const admin=document.getElementById('admin-backdrop');
const loginPanel=document.getElementById('admin-login-panel');
const dashboardPanel=document.getElementById('admin-dashboard-panel');
const loginForm=document.getElementById('admin-login-form');
const loginError=document.getElementById('admin-login-error');
const dashboardMessage=document.getElementById('admin-dashboard-message');
const passwordInput=document.getElementById('admin-password');
const displayName=document.getElementById('admin-display-name');
let currentSCBSAdminRole = null;

function applySCBSAdminRole(role) {
  const allowedRoles = ['owner', 'manager', 'staff'];

  if (!allowedRoles.includes(role)) {
    currentSCBSAdminRole = null;
    return false;
  }

  currentSCBSAdminRole = role;

  const paymentSection = document.getElementById('payment-management');
  if (paymentSection) {
    paymentSection.hidden = role !== 'owner';
  }
  const accountOrderSection = document.getElementById('scbs-account-order-management');
  if (accountOrderSection) accountOrderSection.hidden = role !== 'owner';

  const dashboard = document.getElementById('admin-dashboard-panel');
  if (dashboard) {
    dashboard.dataset.adminRole = role;
  }

  if (dashboardMessage) {
    const descriptions = {
      owner: 'Owner access: full administration.',
      manager: 'Manager access: business management; payments and team administration are restricted.',
      staff: 'Staff access: read-only business access.'
    };
    dashboardMessage.textContent = descriptions[role];
  }

  return true;
}

function closeAdmin(){admin.classList.remove('open')}
document.getElementById('admin-open').onclick=async()=>{
admin.classList.add('open');
loginError.textContent='';
dashboardMessage.textContent='';
try{
const response=await fetch('/api/auth/me',{credentials:'same-origin'});
const result=await response.json();
const account=result.admin||{};
const authenticated=result.authenticated===true&&['owner','manager','staff'].includes(account.role);
loginPanel.hidden=authenticated;
dashboardPanel.hidden=!authenticated;
if(authenticated){displayName.textContent=account.display_name||account.email||'Administrator';applySCBSAdminRole(account.role);}
}catch(error){
loginPanel.hidden=false;
dashboardPanel.hidden=true;currentSCBSAdminRole=null;
loginError.textContent='Unable to contact the server. Please try again.';
}
};
document.getElementById('close-admin').onclick=closeAdmin;
admin.addEventListener('click',e=>{if(e.target===admin)closeAdmin()});
loginForm.addEventListener('submit',async e=>{
e.preventDefault();
loginError.textContent='';
const button=loginForm.querySelector('button[type="submit"]');
button.disabled=true;
button.textContent='Signing in...';
try{
const response=await fetch('/api/auth/login',{
method:'POST',
credentials:'same-origin',
headers:{'Content-Type':'application/json'},
body:JSON.stringify({
email:document.getElementById('admin-email').value.trim(),
password:passwordInput.value
})
});
const result=await response.json();
passwordInput.value='';
if(!response.ok||result.success===false){
throw new Error(result.error||'Sign-in failed. Check your details.');
}
const check=await fetch('/api/auth/me',{credentials:'same-origin'});
const account=await check.json();
const signedInAdmin=account.admin||{};
if(!check.ok||account.authenticated!==true||!['owner','manager','staff'].includes(signedInAdmin.role)){
throw new Error('The server could not verify administrator access.');
}
loginPanel.hidden=true;
dashboardPanel.hidden=false;
displayName.textContent=signedInAdmin.display_name||signedInAdmin.email||'Administrator';if(!applySCBSAdminRole(signedInAdmin.role)){throw new Error('Unsupported administrator role.');}
notify('SCBS Admin','Administrator signed in successfully.','success');
}catch(error){
loginError.textContent=error.message||'Sign-in failed. Please try again.';
}finally{
button.disabled=false;
button.textContent='Sign In Securely';
}
});
document.getElementById('admin-logout').onclick=async()=>{
try{
const response=await fetch('/api/auth/logout',{
method:'POST',
credentials:'same-origin'
});
const result=await response.json();
if(!response.ok||result.success===false){
throw new Error(result.error||'Sign-out failed.');
}
dashboardPanel.hidden=true;currentSCBSAdminRole=null;
loginPanel.hidden=false;
loginForm.reset();
passwordInput.value='';
loginError.textContent='';
notify('SCBS Admin','You have signed out.','success');
}catch(error){
dashboardMessage.textContent=error.message||'Unable to sign out. Please try again.';
}
};document.getElementById('hero-contact').onclick=()=>{document.getElementById('contact').scrollIntoView({behavior:'smooth'});notify('Talk to SCBS','Opening communication options.')};
document.getElementById('message-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;const button=document.getElementById('send-scb-message');const status=document.getElementById('message-form-status');const name=document.getElementById('full-name').value.trim();const reply=document.getElementById('reply-contact').value.trim();const message=document.getElementById('message').value.trim();const isEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reply);const isPhone=/^[+0-9()\s-]{7,30}$/.test(reply);if(!isEmail&&!isPhone){status.textContent='Enter a valid email address or phone number so SCBS can reply.';notify('Check your contact details','Enter a valid email address or phone number.','error');return}const originalText=button.textContent;button.disabled=true;button.textContent='Sending...';status.textContent='Sending your message to SCBS...';try{const response=await fetch('/api/messages',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({name,email:isEmail?reply:'',phone:isPhone?reply:'',subject:'Website message',message})});const result=await response.json();if(!response.ok||result.success!==true)throw new Error(result.error||'SCBS could not save your message. Please try again.');status.textContent='Message received by SCBS. Reference: '+result.reference+'. You can also contact us on WhatsApp if you need a faster reply.';form.reset();notify('Message received','Your message was saved for the SCBS team. Reference: '+result.reference,'success',6500)}catch(error){status.textContent=error.message||'Unable to send your message. Please try again.';notify('Message not sent',status.textContent,'error',6500)}finally{button.disabled=false;button.textContent=originalText}});
document.getElementById('whatsapp').onclick=()=>window.open('https://wa.me/260967575366','_blank','noopener,noreferrer');
document.getElementById('call').onclick=()=>{window.location.href='tel:+260967575366'};
document.getElementById('email').onclick=()=>{window.location.href='mailto:chabuemmanuel6@gmail.com?subject=SCBS%20Enquiry'};
document.getElementById('facebook').onclick=()=>window.open('https://www.facebook.com/emmanuel.chabu.92','_blank','noopener,noreferrer');
document.getElementById('instagram').onclick=()=>window.open('https://www.instagram.com/sergiochabu/','_blank','noopener,noreferrer');
document.getElementById('youtube').onclick=()=>window.open('https://www.youtube.com/results?search_query=SCBS+Sergio+Chabu','_blank','noopener,noreferrer');
window.addEventListener('load',()=>notify('SCBS is ready','Homepage loaded successfully. Notifications are enabled.','success',4000));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeLogin();closeAdmin()}});
// SCBS tab navigation: make every navigation item a real top-level section.
function createStandaloneSection(cardId, sectionId, eyebrow, title, description) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const section = document.createElement('section');
  section.className = 'content';
  section.id = sectionId;
  const head = document.createElement('div');
  head.className = 'section-head';
  const tag = document.createElement('div');
  tag.className = 'eyebrow';
  tag.textContent = eyebrow;
  const h = document.createElement('h2');
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = description;
  head.append(tag, h, p);
  const grid = document.createElement('div');
  grid.className = 'grid';
  card.removeAttribute('id');
  grid.appendChild(card);
  section.append(head, grid);
  const contactSection = document.getElementById('contact');
  document.querySelector('main').insertBefore(section, contactSection);
}
createStandaloneSection('phones', 'phones', 'Devices', 'Phones & Accessories', 'Phones, chargers, earphones, cases and cables.');
createStandaloneSection(
  'rentals',
  'rentals',
  'GSM SOFTWARE',
  'SERGIO GSM Tools & Software',
  'Explore GSM servicing tools and software, including UnlockTool, TSM, Octoplus and Hydra. View available listings and contact SCBS about supported services.'
);createStandaloneSection('ads', 'ads', 'Promote', 'Advertisements & Promotions', 'Business announcements, offers and promotions.');
const mainSections = Array.from(document.querySelectorAll('main > section'));
const navAnchors = Array.from(document.querySelectorAll('nav a[href^="#"], .brand[href^="#"], main a[href^="#"]'));
function showSection(id, updateAddress = true) {
  const target = document.getElementById(id);
  if (!target || !mainSections.includes(target)) return;
  document.body.classList.add('tabs-ready');
  if (updateAddress && location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  mainSections.forEach(section => section.classList.toggle('active', section === target));
  document.querySelectorAll('nav a[href^="#"]').forEach(link => {
    const selected = link.getAttribute('href').slice(1) === id;
    link.classList.toggle('active', selected);
    if (selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  window.scrollTo({top: 0, behavior: 'auto'});
}
navAnchors.forEach(link => link.addEventListener('click', event => {
  const id = link.getAttribute('href').slice(1);
  if (mainSections.some(section => section.id === id)) {
    event.preventDefault();
    showSection(id);
  }
}));
document.querySelectorAll('.actions a[href^="#"]').forEach(link => link.addEventListener('click', event => {
  const id = link.hash.slice(1);
  if (mainSections.some(section => section.id === id)) {
    event.preventDefault();
    showSection(id);
  }
}));
document.getElementById('hero-contact').onclick = () => {
  showSection('contact');
  notify('Talk to SCBS', 'Opening communication options.');
};
showSection(location.hash && mainSections.some(section => section.id === location.hash.slice(1)) ? location.hash.slice(1) : 'home', true);
window.addEventListener('popstate', () => {
  const id = location.hash.slice(1);
  showSection(mainSections.some(section => section.id === id) ? id : 'home', false);
});// SCBS PRODUCT MANAGEMENT
// Uses the existing product API and administrator-protected creation route.

const productForm = document.getElementById('product-form');
const productList = document.getElementById('product-list');
const productStatus = document.getElementById('product-status');
const loadProductsButton = document.getElementById('load-products');
let editingProductId = null;
const cancelProductEditButton =
  document.getElementById('cancel-product-edit');

function formatSCBSPrice(ngwee) {
  return 'K' + (Number(ngwee) / 100).toFixed(2);
}

async function loadSCBSProducts() {
  productStatus.textContent = 'Loading products...';
  loadProductsButton.disabled = true;

  try {
    const response = await fetch('/api/products', {
      credentials: 'same-origin'
    });

    const result = await response.json();

    if (!response.ok || result.success !== true) {
      throw new Error(result.error || 'Unable to load products.');
    }

    productList.replaceChildren();

    if (!result.products || result.products.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.textContent = 'No active products found.';
      row.appendChild(cell);
      productList.appendChild(row);
       } else {
      result.products.forEach(product => {
  const row = document.createElement('tr');

  // Picture column
  const pictureCell = document.createElement('td');
  pictureCell.style.padding = '8px';

  if (product.image_url) {
    const picture = document.createElement('img');
    picture.src = product.image_url;
    picture.alt = product.name + ' product picture';
    picture.loading = 'lazy';
    picture.style.width = '60px';
    picture.style.height = '60px';
    picture.style.objectFit = 'contain';
    picture.style.borderRadius = '8px';

    picture.onerror = () => {
      pictureCell.textContent = 'Image unavailable';
    };

    pictureCell.appendChild(picture);
  } else {
    pictureCell.textContent = 'No picture';
  }

  row.appendChild(pictureCell);

  // Existing product information
  [
    product.sku,
    product.name,
    product.product_type,
    formatSCBSPrice(product.price_ngwee),
    product.stock_quantity
  ].forEach(value => {
    const cell = document.createElement('td');
    cell.style.padding = '8px';
    cell.textContent = String(value ?? '');
    row.appendChild(cell);
  });
        const actionCell = document.createElement('td');
        actionCell.style.padding = '8px';

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.textContent = 'Edit';
        editButton.className = 'ghost';

        editButton.addEventListener('click', () => {
          editingProductId = product.id;
          cancelProductEditButton.hidden = false;
          document.getElementById('product-sku').value = product.sku;
          document.getElementById('product-name').value = product.name;
          document.getElementById('product-type').value = product.product_type;
          document.getElementById('product-description').value =
  product.description || '';

const productImageField = document.getElementById('product-image-url');

if (productImageField) {
  productImageField.value = product.image_url || '';
}

document.getElementById('product-price').value =
  (Number(product.price_ngwee) / 100).toFixed(2);
          document.getElementById('product-stock').value =
            product.stock_quantity;

          productStatus.textContent =
            'Editing product: ' + product.name;
          const saveButton = productForm.querySelector('button[type="submit"]');
saveButton.textContent = 'Save Changes';

          productForm.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        });

        actionCell.appendChild(editButton);
        row.appendChild(actionCell);
        productList.appendChild(row);
      });
    }

    productStatus.textContent =
      'Loaded ' + result.products.length + ' active product(s).';
  } catch (error) {
    productStatus.textContent =
      error.message || 'Unable to load products.';
  } finally {
    loadProductsButton.disabled = false;
  }
}

loadProductsButton.addEventListener('click', loadSCBSProducts);
function resetProductEditing() {
  editingProductId = null;
  productForm.reset();

  document.getElementById('product-stock').value = '0';

  const saveButton = productForm.querySelector(
    'button[type="submit"]'
  );

  saveButton.textContent = 'Save Product';
  cancelProductEditButton.hidden = true;
  productStatus.textContent = 'Ready to add a new product.';
}

cancelProductEditButton.addEventListener('click', () => {
  resetProductEditing();
});

productForm.addEventListener('submit', async event => {
  event.preventDefault();

  if (!productForm.reportValidity()) return;

  const priceZMW = Number(
    document.getElementById('product-price').value
  );

  const stockQuantity = Number(
    document.getElementById('product-stock').value
  );

  if (
    !Number.isFinite(priceZMW) ||
    priceZMW < 0 ||
    !Number.isSafeInteger(Math.round(priceZMW * 100))
  ) {
    productStatus.textContent = 'Enter a valid product price.';
    return;
  }

  if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0) {
    productStatus.textContent =
      'Stock quantity must be a non-negative whole number.';
    return;
  }

  const saveButton = productForm.querySelector(
    'button[type="submit"]'
  );

  saveButton.disabled = true;
  productStatus.textContent = 'Saving product...';

  try {
    const editing = editingProductId !== null;

const response = await fetch(
  editing ? '/api/products/' + editingProductId : '/api/products',
  {
    method: editing ? 'PUT' : 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    },
      body: JSON.stringify({
        sku: document.getElementById('product-sku').value.trim(),
        name: document.getElementById('product-name').value.trim(),
        product_type: document.getElementById('product-type').value,
        description:
  document.getElementById('product-description').value.trim(),
image_url:
  document.getElementById('product-image-url').value.trim(),
price_ngwee: Math.round(priceZMW * 100),
        stock_quantity: stockQuantity
      })
    });

    const result = await response.json();

    if (!response.ok || result.success !== true) {
      throw new Error(result.error || 'Unable to save product.');
    }

    productStatus.textContent =
  (editing ? 'Product updated successfully: ' : 'Product saved successfully: ') +
  result.product.name;

editingProductId = null;
productForm.reset();
document.getElementById('product-stock').value = '0';
saveButton.textContent = 'Add Product';

await loadSCBSProducts();
    if (typeof window.scbsLoadPublicPhoneProducts === 'function') {
      await window.scbsLoadPublicPhoneProducts();
    }

    notify(
      'SCBS Product Management',
      'The product was saved to the database.',
      'success'
    );
  } catch (error) {
    productStatus.textContent =
      error.message || 'Unable to save product.';

    notify(
      'Product not saved',
      productStatus.textContent,
      'error'
    );
  } finally {
    saveButton.disabled = false;
  }
});


// ============================================
// SCBS MULTI-TECH SERVICES MANAGEMENT
// Administrator dashboard integration
// ============================================

(() => {
  const serviceForm = document.getElementById('service-form');
  const serviceList = document.getElementById('service-list');
  const serviceStatus = document.getElementById('service-status');
  const loadServicesButton = document.getElementById('load-services');
  const cancelServiceEditButton = document.getElementById('cancel-service-edit');
  const saveServiceButton = document.getElementById('save-service');
  const serviceImageFile = document.getElementById('service-image-file');
  const serviceImageUrl = document.getElementById('service-image-url');
  const serviceImagePreview = document.getElementById('service-image-preview');

  if (
    !serviceForm ||
    !serviceList ||
    !serviceStatus ||
    !loadServicesButton ||
    !cancelServiceEditButton ||
    !saveServiceButton
  ) {
    console.error('SCBS Services Management: required HTML elements are missing.');
    return;
  }

  let editingServiceId = null;

  const serviceFields = {
    code: document.getElementById('service-code'),
    name: document.getElementById('service-name'),
    category: document.getElementById('service-category'),
    description: document.getElementById('service-description'),
    price: document.getElementById('service-price'),
    pricingType: document.getElementById('service-pricing-type'),
    duration: document.getElementById('service-duration')
  };

  function formatServicePrice(service) {
    if (service.price_ngwee === null || service.price_ngwee === undefined) {
      return 'Request a quote';
    }

    const price = 'K' + (Number(service.price_ngwee) / 100).toFixed(2);

    if (service.pricing_type === 'from') {
      return 'From ' + price;
    }

    return price;
  }

  function resetServiceForm() {
    editingServiceId = null;
    serviceForm.reset();
    if (serviceImageFile) serviceImageFile.value = '';
    if (serviceImageUrl) serviceImageUrl.value = '';
    if (serviceImagePreview) {
      serviceImagePreview.removeAttribute('src');
      serviceImagePreview.hidden = true;
    }
    saveServiceButton.textContent = 'Save Service';
    cancelServiceEditButton.hidden = true;
    serviceStatus.textContent = 'Ready to add a new service.';
  }

  async function loadServices() {
    loadServicesButton.disabled = true;
    serviceStatus.textContent = 'Loading services...';

    try {
      const response = await fetch('/api/admin/services', {
        credentials: 'same-origin'
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || 'Unable to load services.');
      }

      serviceList.replaceChildren();

      if (!result.services || result.services.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 7;
        cell.textContent = 'No services found.';
        row.appendChild(cell);
        serviceList.appendChild(row);
      } else {
        result.services.forEach(service => {
          const row = document.createElement('tr');

          [
            service.service_code,
            service.name,
            service.category,
            formatServicePrice(service),
            Number(service.is_active) === 1 ? 'Active' : 'Inactive'
          ].forEach(value => {
            const cell = document.createElement('td');
            cell.style.padding = '8px';
            cell.textContent = String(value ?? '');
            row.appendChild(cell);
          });

          const actions = document.createElement('td');
          actions.style.padding = '8px';

          const editButton = document.createElement('button');
          editButton.type = 'button';
          editButton.className = 'ghost';
          editButton.textContent = 'Edit';

          editButton.addEventListener('click', () => {
            editingServiceId = service.id;

            serviceFields.code.value = service.service_code;
            serviceFields.name.value = service.name;
            serviceFields.category.value = service.category;
            serviceFields.description.value = service.description || '';
            serviceFields.price.value =
              service.price_ngwee === null ||
              service.price_ngwee === undefined
                ? ''
                : (Number(service.price_ngwee) / 100).toFixed(2);
            serviceFields.pricingType.value = service.pricing_type;
            serviceFields.duration.value = service.estimated_duration || '';
            if (serviceImageUrl) serviceImageUrl.value = service.image_url || '';
            if (serviceImagePreview) {
              if (service.image_url) {
                serviceImagePreview.src = service.image_url;
                serviceImagePreview.hidden = false;
              } else {
                serviceImagePreview.removeAttribute('src');
                serviceImagePreview.hidden = true;
              }
            }

            saveServiceButton.textContent = 'Save Changes';
            cancelServiceEditButton.hidden = false;
            serviceStatus.textContent = 'Editing service: ' + service.name;

            serviceForm.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });
          });

          const statusButton = document.createElement('button');
          statusButton.type = 'button';
          statusButton.className = 'ghost';
          statusButton.style.marginTop = '6px';
          statusButton.textContent =
            Number(service.is_active) === 1 ? 'Deactivate' : 'Activate';

          statusButton.addEventListener('click', async () => {
            statusButton.disabled = true;

            try {
              const response = await fetch(
                '/api/services/' + service.id + '/status',
                {
                  method: 'PATCH',
                  credentials: 'same-origin',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    is_active: Number(service.is_active) === 1 ? 0 : 1
                  })
                }
              );

              const result = await response.json();

              if (!response.ok || result.success !== true) {
                throw new Error(result.error || 'Unable to change service status.');
              }

              serviceStatus.textContent = result.message;
              await loadServices();
            } catch (error) {
              serviceStatus.textContent =
                error.message || 'Unable to change service status.';
              statusButton.disabled = false;
            }
          });

          actions.appendChild(editButton);
          actions.appendChild(document.createElement('br'));
          actions.appendChild(statusButton);
          row.appendChild(actions);
          serviceList.appendChild(row);
        });
      }

      serviceStatus.textContent =
        'Loaded ' + result.services.length + ' service(s).';
    } catch (error) {
      serviceStatus.textContent =
        error.message || 'Unable to load services.';
    } finally {
      loadServicesButton.disabled = false;
    }
  }

  loadServicesButton.addEventListener('click', loadServices);

  cancelServiceEditButton.addEventListener('click', resetServiceForm);

  serviceForm.addEventListener('submit', async event => {
    event.preventDefault();

    if (!serviceForm.reportValidity()) return;

    const priceText = serviceFields.price.value.trim();
    const priceZMW = priceText === '' ? null : Number(priceText);

    if (
      priceZMW !== null &&
      (!Number.isFinite(priceZMW) || priceZMW < 0 ||
       !Number.isSafeInteger(Math.round(priceZMW * 100)))
    ) {
      serviceStatus.textContent = 'Enter a valid non-negative service price.';
      return;
    }

    let uploadedImageUrl = serviceImageUrl ? serviceImageUrl.value : '';
    if (serviceImageFile && serviceImageFile.files && serviceImageFile.files[0]) {
      saveServiceButton.disabled = true;
      serviceStatus.textContent = 'Uploading service image...';
      try {
        const imageData = new FormData();
        imageData.append('image', serviceImageFile.files[0]);
        const uploadResponse = await fetch('/api/services/image', {
          method: 'POST',
          credentials: 'same-origin',
          body: imageData
        });
        const uploadResult = await uploadResponse.json();
        if (!uploadResponse.ok || uploadResult.success !== true) {
          throw new Error(uploadResult.error || 'Unable to upload service image.');
        }
        uploadedImageUrl = uploadResult.image_url;
        if (serviceImageUrl) serviceImageUrl.value = uploadedImageUrl;
        if (serviceImagePreview) {
          serviceImagePreview.src = uploadedImageUrl;
          serviceImagePreview.hidden = false;
        }
      } catch (error) {
        serviceStatus.textContent = error.message || 'Unable to upload service image.';
        saveServiceButton.disabled = false;
        return;
      }
    }

    const payload = {
      service_code: serviceFields.code.value.trim(),
      name: serviceFields.name.value.trim(),
      category: serviceFields.category.value,
      description: serviceFields.description.value.trim(),
      price_ngwee: priceZMW === null ? null : Math.round(priceZMW * 100),
      pricing_type: serviceFields.pricingType.value,
      estimated_duration: serviceFields.duration.value.trim(),
      image_url: uploadedImageUrl || null
    };

    saveServiceButton.disabled = true;
    serviceStatus.textContent = 'Saving service...';

    try {
      const response = await fetch(
        editingServiceId === null
          ? '/api/services'
          : '/api/services/' + editingServiceId,
        {
          method: editingServiceId === null ? 'POST' : 'PUT',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || 'Unable to save service.');
      }

      serviceStatus.textContent = result.message || 'Service saved successfully.';
      resetServiceForm();
      await loadServices();
    } catch (error) {
      serviceStatus.textContent =
        error.message || 'Unable to save service.';
    } finally {
      saveServiceButton.disabled = false;
    }
  });

  console.log('SCBS Services Management initialized.');
})();

// ============================================
// SCBS PUBLIC PRODUCTS AND SERVICES
// Load active records from the existing database
// ============================================

(() => {
  const productList = document.getElementById('public-product-list');
  const productStatus = document.getElementById('public-product-status');

  const serviceList = document.getElementById('public-service-list');
  const serviceStatus = document.getElementById('public-service-status');
  const phonesSection = document.getElementById('phones');
  const deviceTypes = new Set(['phone', 'accessory', 'electronics']);
  let phoneProductList = document.getElementById('public-phone-product-list');
  let phoneProductStatus = document.getElementById('public-phone-product-status');

  if (phonesSection && !phoneProductList) {
    const heading = createElement('div', 'section-head');
    heading.append(
      createElement('h2', '', 'Browse Phones & Accessories'),
      createElement('p', 'muted', 'Devices and accessories listed by SCBS. New listings added in the Owner Dashboard appear here after saving.')
    );
    phoneProductStatus = createElement('p', 'muted', 'Loading device listings...');
    phoneProductStatus.id = 'public-phone-product-status';
    phoneProductStatus.setAttribute('role', 'status');
    phoneProductList = createElement('div', 'grid');
    phoneProductList.id = 'public-phone-product-list';
    phonesSection.append(heading, phoneProductStatus, phoneProductList);
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) {
      element.className = className;
    }

    if (text !== undefined) {
      element.textContent = String(text);
    }

    return element;
  }

  function contactButton(message) {
    const button = createElement('button', 'primary', 'Enquire on WhatsApp');
    button.type = 'button';

    button.addEventListener('click', () => {
      const url = 'https://wa.me/260967575366?text=' +
        encodeURIComponent(message);

      window.open(url, '_blank', 'noopener,noreferrer');
    });

    return button;
  }

  async function loadPublicProducts() {
    if (!productList || !productStatus) return;

    productStatus.textContent = 'Loading products...';

    try {
      const response = await fetch('/api/products', {
        credentials: 'same-origin'
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || 'Unable to load products.');
      }

      productList.replaceChildren();

      const allProducts = Array.isArray(result.products) ? result.products : [];
      const deviceTypes = new Set(['phone', 'accessory', 'electronics']);
      const products = allProducts.filter(product =>
        !deviceTypes.has(String(product.product_type || 'general').toLowerCase())
      );

      if (products.length === 0) {
        productStatus.textContent = 'No products are currently available.';
        return;
      }

      products.forEach(product => {
        const card = createElement('article', 'card');
       // SCBS public product picture
if (product.image_url) {
  const picture = document.createElement('img');

  picture.src = product.image_url;
  picture.alt = product.name + ' product picture';
  picture.loading = 'lazy';
  picture.style.width = '100%';
  picture.style.maxWidth = '280px';
  picture.style.height = '220px';
  picture.style.objectFit = 'contain';
  picture.style.display = 'block';
  picture.style.margin = '0 auto 16px';
  picture.style.borderRadius = '12px';

  picture.onerror = () => {
    picture.remove();
  };

  card.appendChild(picture);
}
        const heading = createElement('h3', '', product.name);
        const category = createElement(
          'p',
          'muted',
          'Category: ' + (product.product_type || 'General')
        );

        const description = createElement(
          'p',
          '',
          product.description || 'Contact SCBS for more information.'
        );

        const price = createElement(
          'p',
          '',
          'Price: K' + (Number(product.price_ngwee) / 100).toFixed(2)
        );

        const stockNumber = Number(product.stock_quantity);

        const availability = createElement(
          'p',
          'muted',
          stockNumber > 0 ? 'Available' : 'Currently out of stock'
        );

                card.append(heading, category, description, price, availability);

        if (stockNumber > 0) {
          const addToCartButton = createElement(
            'button',
            'primary',
            'Add to Cart'
          );

          addToCartButton.type = 'button';

          addToCartButton.addEventListener('click', () => {
            if (typeof window.scbsAddProductToCart !== 'function') {
              alert('The shopping cart is not ready yet. Please refresh the page.');
              return;
            }

            window.scbsAddProductToCart(product);
          });

          card.appendChild(addToCartButton);

          card.appendChild(
            contactButton(
              'Hello SCBS, I would like to enquire about ' +
              product.name + ' (SKU: ' + product.sku + ').'
            )
          );
        }

        productList.appendChild(card);
      });

      productStatus.textContent = 'Showing ' + products.length + ' product(s).';
    } catch (error) {
      productStatus.textContent =
        error.message || 'Unable to load products.';
    }
  }

  async function loadPublicPhoneProducts() {
    if (!phoneProductList || !phoneProductStatus) return;
    phoneProductStatus.textContent = 'Loading phone and accessory listings...';

    try {
      const response = await fetch('/api/products', { credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok || result.success !== true) {
        throw new Error(result.error || 'Unable to load phone listings.');
      }

      const devices = (Array.isArray(result.products) ? result.products : [])
        .filter(product => deviceTypes.has(String(product.product_type || '').toLowerCase()));

      phoneProductList.replaceChildren();
      if (devices.length === 0) {
        phoneProductStatus.textContent = 'No phones, accessories or electronics are currently listed. Please check again soon.';
        return;
      }

      devices.forEach(product => {
        const card = createElement('article', 'card');
        if (product.image_url) {
          const picture = document.createElement('img');
          picture.src = product.image_url;
          picture.alt = (product.name || 'SCBS device') + ' product picture';
          picture.loading = 'lazy';
          picture.style.cssText = 'width:100%;max-width:280px;height:220px;object-fit:contain;display:block;margin:0 auto 16px;border-radius:12px;';
          picture.onerror = () => picture.remove();
          card.appendChild(picture);
        } else {
          card.appendChild(createElement('div', 'card-icon', 'ðŸ“±'));
        }

        const stock = Number(product.stock_quantity || 0);
        card.append(
          createElement('h3', '', product.name || 'SCBS device'),
          createElement('p', 'muted', 'Category: ' + String(product.product_type || 'phone')),
          createElement('p', '', product.description || 'Contact SCBS for more information.'),
          createElement('p', '', 'Price: K' + (Number(product.price_ngwee || 0) / 100).toFixed(2)),
          createElement('p', 'muted', stock > 0 ? 'Available Â· ' + stock + ' in stock' : 'Currently out of stock')
        );

        if (stock > 0) {
          const addToCart = createElement('button', 'primary', 'Add to Cart');
          addToCart.type = 'button';
          addToCart.addEventListener('click', () => {
            if (typeof window.scbsAddProductToCart !== 'function') {
              notify('Cart unavailable', 'Please refresh the page and try again.', 'error');
              return;
            }
            window.scbsAddProductToCart(product);
          });
          card.appendChild(addToCart);

          card.appendChild(contactButton(
            'Hello SCBS, I would like to enquire about ' +
            (product.name || 'a device') + ' (SKU: ' + (product.sku || 'not listed') + ').'
          ));
        }
        phoneProductList.appendChild(card);
      });

      phoneProductStatus.textContent =
        'Showing ' + devices.length + ' phone, accessory or electronics listing(s).';
    } catch (error) {
      phoneProductStatus.textContent = error.message || 'Unable to load phone listings.';
    }
  }

  async function loadPublicServices() {
    if (!serviceList || !serviceStatus) return;

    serviceStatus.textContent = 'Loading services...';

    try {
      const response = await fetch('/api/services', {
        credentials: 'same-origin'
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || 'Unable to load services.');
      }

      serviceList.replaceChildren();

      const services = result.services || [];

      if (services.length === 0) {
        serviceStatus.textContent =
          'No services are currently available.';
        return;
      }

      services.forEach(service => {
        const card = createElement('article', 'card');
        const heading = createElement('h3', '', service.name);
        let serviceImage = null;
        if (service.image_url) {
          serviceImage = document.createElement('img');
          serviceImage.src = service.image_url;
          serviceImage.alt = service.name + ' service';
          serviceImage.loading = 'lazy';
          serviceImage.style.cssText = 'width:100%;max-height:220px;object-fit:cover;border-radius:12px;margin-bottom:10px';
          serviceImage.onerror = () => serviceImage.remove();
        }

        const category = createElement(
          'p',
          'muted',
          'Category: ' + (service.category || 'Multi-Tech')
        );

        const description = createElement(
          'p',
          '',
          service.description || 'Contact SCBS for more information.'
        );

        let priceText = 'Price available on request';

        if (service.price_ngwee !== null &&
            service.price_ngwee !== undefined) {
          priceText = 'Price: K' +
            (Number(service.price_ngwee) / 100).toFixed(2);

          if (service.pricing_type === 'from') {
            priceText = 'Starting from K' +
              (Number(service.price_ngwee) / 100).toFixed(2);
          }
        } else if (service.pricing_type === 'quote') {
          priceText = 'Request a quotation';
        }

        const price = createElement('p', '', priceText);

        const duration = createElement(
          'p',
          'muted',
          service.estimated_duration
            ? 'Estimated duration: ' + service.estimated_duration
            : 'Contact SCBS to confirm the duration.'
        );

        const button = contactButton(
          'Hello SCBS, I would like to enquire about your ' +
          service.name + ' service.'
        );

        if (serviceImage) card.appendChild(serviceImage);
        card.append(heading, category, description, price, duration, button);
        serviceList.appendChild(card);
      });

      serviceStatus.textContent =
        'Showing ' + services.length + ' active service(s).';
    } catch (error) {
      serviceStatus.textContent =
        error.message || 'Unable to load services.';
    }
  }

  loadPublicProducts();
  loadPublicPhoneProducts();
  loadPublicServices();
  window.scbsLoadPublicPhoneProducts = loadPublicPhoneProducts;

  // The Phones & Accessories card scrolls to its separate live catalogue.
  const browseDevicesButton = phonesSection?.querySelector('button');
  browseDevicesButton?.addEventListener('click', () => {
    phoneProductList?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    loadPublicPhoneProducts();
  });
})();
// ============================================
// SCBS PRODUCTS & ESSENTIALS CARD BUTTONS
// ============================================

(() => {
  const buttons = document.querySelectorAll('[data-open-products]');

  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const productList = document.getElementById('public-product-list');
      const productStatus = document.getElementById('public-product-status');

      if (!productList || !productStatus) {
        alert('The SCBS product list could not be found. Please refresh the page.');
        return;
      }

      // Bring the existing Available Products list into view.
      productList.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });

      // Refresh products from the existing SCBS database.
      productStatus.textContent = 'Refreshing available products...';

      fetch('/api/products', {
        credentials: 'same-origin'
      })
        .then(response => {
          if (!response.ok) {
            throw new Error('Could not refresh products.');
          }
          return response.json();
        })
        .then(result => {
          if (result.success !== true) {
            throw new Error(result.error || 'Could not load products.');
          }

          // Reuse the existing product loader if available.
          // The normal loader already handles cards, prices and Add to Cart.
          window.location.hash = 'products';

          if (typeof window.scbsLoadPublicProducts === 'function') {
            window.scbsLoadPublicProducts();
          } else {
            window.location.reload();
          }
        })
        .catch(error => {
          console.error('SCBS product refresh error:', error);
          productStatus.textContent =
            'Unable to refresh products. Please try again.';
        });
    });
  });
})();

// ============================================
// SCBS ADVERTISEMENT MANAGEMENT
// ============================================
(() => {
  'use strict';

  const form = document.getElementById('advertisement-form');
  const list = document.getElementById('advertisement-list');
  const status = document.getElementById('advertisement-status');
  const refreshButton = document.getElementById('load-advertisements');
  const cancelButton = document.getElementById('cancel-advertisement-edit');
  const saveButton = document.getElementById('save-advertisement');
  const formHeading = document.getElementById('advertisement-form-heading');
  const imageFileField = document.getElementById('advertisement-image-file');
  const imageUrlField = document.getElementById('advertisement-image');
  const imagePreview = document.getElementById('advertisement-image-preview');
  let editingTargetUrl = null;

  // Do nothing if the advertisement form is not on this page.
  if (!form || !list || !status) return;

  let editingId = null;
  window.scbsEditingBookId = null;
  let advertisements = [];

  const field = (id) => document.getElementById(id);

  function showStatus(message) {
    status.textContent = message;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('The server returned an unreadable response.');
    }

    if (!response.ok || result.success === false) {
      throw new Error(result.error || 'The request failed.');
    }

    return result;
  }

  function makeElement(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) {
      element.textContent = String(text);
    }
    if (className) element.className = className;
    return element;
  }

  function resetForm() {
    form.reset();
    editingId = null;
    saveButton.textContent = 'Save Advertisement';
    formHeading.textContent = 'Create Advertisement';
    cancelButton.hidden = true;
    editingTargetUrl = null;
    if (imageFileField) imageFileField.value = '';
    if (imageUrlField) imageUrlField.value = '';
    if (imagePreview) { imagePreview.removeAttribute('src'); imagePreview.hidden = true; imagePreview.style.display = 'none'; }
  }

  function toLocalDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function toIsoOrNull(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error('Please enter a valid advertisement date.');
    }
    return date.toISOString();
  }

  function readForm() {
    const start = field('advertisement-start').value;
    const end = field('advertisement-end').value;

    const startsAt = toIsoOrNull(start);
    const endsAt = toIsoOrNull(end);

    if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
      throw new Error('The end date must be after the start date.');
    }

    return {
      ad_code: field('advertisement-code').value.trim(),
      title: field('advertisement-title').value.trim(),
      description: field('advertisement-description').value.trim() || null,
      image_url: field('advertisement-image').value.trim() || null,
      target_url: editingTargetUrl,
      starts_at: startsAt,
      ends_at: endsAt,
      status: field('advertisement-state').value
    };
  }

  function renderAdvertisements() {
    list.replaceChildren();

    if (!advertisements.length) {
      list.appendChild(
        makeElement('p', 'No advertisements yet. Create your first promotion below.', 'muted')
      );
      return;
    }

    advertisements.forEach((ad) => {
      const card = makeElement('article', undefined, 'card');
      const heading = makeElement('h4', ad.title);
      const code = makeElement('p', 'Code: ' + ad.ad_code, 'muted');
      const description = makeElement(
        'p',
        ad.description || 'No description provided.'
      );
      const state = makeElement('p', 'Status: ' + ad.status);

      if (ad.image_url) {
        const image = makeElement('img');
        image.src = ad.image_url;
        image.alt = ad.title || 'Advertisement image';
        image.loading = 'lazy';
        image.style.cssText = 'max-width:100%;max-height:180px;object-fit:contain;border-radius:12px;margin:8px 0';
        card.appendChild(image);
      }
      card.append(heading, code, description, state);

      if (ad.starts_at) {
        card.appendChild(makeElement('p', 'Starts: ' + ad.starts_at));
      }

      if (ad.ends_at) {
        card.appendChild(makeElement('p', 'Ends: ' + ad.ends_at));
      }

      const actions = makeElement('div', undefined, 'actions');

      const editButton = makeElement('button', 'Edit', 'ghost');
      editButton.type = 'button';
      editButton.addEventListener('click', () => editAdvertisement(ad));

      const statusButton = makeElement(
        'button',
        ad.status === 'published' ? 'Pause' : 'Publish',
        ad.status === 'published' ? 'ghost' : 'primary'
      );
      statusButton.type = 'button';
      statusButton.addEventListener('click', () => changeStatus(ad));

      actions.append(editButton, statusButton);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  async function loadAdvertisements() {
    showStatus('Loading advertisements...');
    if (refreshButton) refreshButton.disabled = true;

    try {
      const result = await api('/api/admin/advertisements');
      advertisements = Array.isArray(result.advertisements)
        ? result.advertisements
        : [];

      renderAdvertisements();
      showStatus('Loaded ' + advertisements.length + ' advertisement(s).');
    } catch (error) {
      showStatus(error.message || 'Unable to load advertisements.');
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  function editAdvertisement(ad) {
    editingId = ad.id;
    field('advertisement-code').value = ad.ad_code || '';
    field('advertisement-title').value = ad.title || '';
    field('advertisement-description').value = ad.description || '';
    field('advertisement-image').value = ad.image_url || '';
    editingTargetUrl = ad.target_url || null;
    if (imageFileField) imageFileField.value = '';
    if (imagePreview) {
      if (ad.image_url) { imagePreview.src = ad.image_url; imagePreview.hidden = false; imagePreview.style.display = 'block'; }
      else { imagePreview.removeAttribute('src'); imagePreview.hidden = true; imagePreview.style.display = 'none'; }
    }
    field('advertisement-start').value = toLocalDateTime(ad.starts_at);
    field('advertisement-end').value = toLocalDateTime(ad.ends_at);
    field('advertisement-state').value = ad.status || 'draft';

    saveButton.textContent = 'Update Advertisement';
    formHeading.textContent = 'Edit Advertisement';
    cancelButton.hidden = false;

    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    field('advertisement-title').focus();
    showStatus('Editing ' + ad.ad_code + '.');
  }

  async function changeStatus(ad) {
    const newStatus = ad.status === 'published' ? 'draft' : 'published';
    const action = newStatus === 'published' ? 'publish' : 'pause';

    if (!window.confirm('Are you sure you want to ' + action + ' "' + ad.title + '"?')) {
      return;
    }

    try {
      showStatus('Updating advertisement status...');
      await api('/api/advertisements/' + encodeURIComponent(ad.id) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });

      showStatus('Advertisement status updated.');
      await loadAdvertisements();
    } catch (error) {
      showStatus(error.message || 'Unable to update advertisement status.');
    }
  }

  if (imageFileField && imagePreview) {
    imageFileField.addEventListener('change', () => {
      const file = imageFileField.files && imageFileField.files[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
        imageFileField.value = '';
        showStatus('Choose a JPEG, PNG, or WebP image no larger than 2 MB.');
        return;
      }
      imagePreview.src = URL.createObjectURL(file);
      imagePreview.hidden = false;
      imagePreview.style.display = 'block';
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    try {
      const data = readForm();
      showStatus(editingId ? 'Updating advertisement...' : 'Creating advertisement...');
      saveButton.disabled = true;

      const selectedImage = imageFileField && imageFileField.files && imageFileField.files[0];
      if (selectedImage) {
        const uploadBody = new FormData();
        uploadBody.append('image', selectedImage);
        const uploadResponse = await fetch('/api/advertisements/image', {
          method: 'POST', credentials: 'same-origin', body: uploadBody
        });
        let uploadResult;
        try { uploadResult = await uploadResponse.json(); }
        catch { throw new Error('The server returned an unreadable image-upload response.'); }
        if (!uploadResponse.ok || uploadResult.success !== true || !uploadResult.image_url) {
          throw new Error(uploadResult.error || 'Unable to upload advertisement image.');
        }
        data.image_url = uploadResult.image_url;
        imageUrlField.value = uploadResult.image_url;
      } else {
        data.image_url = imageUrlField.value.trim() || null;
      }

      if (editingId !== null) {
        await api('/api/advertisements/' + encodeURIComponent(editingId), {
          method: 'PUT',
          body: JSON.stringify(data)
        });
        showStatus('Advertisement updated successfully.');
      } else {
        await api('/api/advertisements', {
          method: 'POST',
          body: JSON.stringify(data)
        });
        showStatus('Advertisement created successfully.');
      }

      resetForm();
      await loadAdvertisements();
    } catch (error) {
      showStatus(error.message || 'Unable to save advertisement.');
    } finally {
      saveButton.disabled = false;
    }
  });

  if (refreshButton) {
    refreshButton.addEventListener('click', loadAdvertisements);
  }

  cancelButton.addEventListener('click', () => {
    resetForm();
    showStatus('Editing cancelled.');
  });

  // The server will reject this request if the visitor is not an administrator.
  loadAdvertisements();
})();// ============================================
// SCBS PUBLIC ADVERTISEMENTS
// ============================================
(() => {
  'use strict';

  const list = document.getElementById('public-advertisement-list');
  const status = document.getElementById('public-advertisement-status');
    // Place live promotions inside the standalone Advertisements section.
  const adsSection = document.getElementById('ads');

  if (adsSection && list && status) {
    const adsGrid = adsSection.querySelector('.grid');

    if (adsGrid) {
      const promotionsHeading =
        document.getElementById('public-advertisements-heading');

      if (promotionsHeading) {
        adsSection.appendChild(promotionsHeading);
      }

      adsSection.appendChild(status);
      adsSection.appendChild(list);
    }
  }

  if (!list || !status) return;

  function makeElement(tag, text, className) {
    const element = document.createElement(tag);

    if (text !== undefined && text !== null) {
      element.textContent = String(text);
    }

    if (className) element.className = className;

    return element;
  }

  async function loadPublicAdvertisements() {
    status.textContent = 'Loading promotions...';

    try {
      const response = await fetch('/api/advertisements');
      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error('Unable to load promotions.');
      }

      const advertisements = Array.isArray(result.advertisements)
        ? result.advertisements
        : [];

      list.replaceChildren();

      if (advertisements.length === 0) {
        status.textContent =
          'There are no published promotions at the moment.';
        return;
      }

      advertisements.forEach((ad) => {
        const card = makeElement('article', undefined, 'card scbs-promo-card');
        card.appendChild(makeElement('div', '✦ SCBS SPECIAL OFFER ✦', 'scbs-promo-badge'));

        if (ad.image_url) {
          try {
            const imageUrl = new URL(ad.image_url, window.location.origin);

            if (['https:', 'http:'].includes(imageUrl.protocol)) {
              const image = makeElement('img');
              image.src = imageUrl.href;
              image.alt = ad.title || 'SCBS promotion';
              image.loading = 'lazy';
              image.style.maxWidth = '100%';
              image.style.height = 'auto';
              card.appendChild(image);
            }
          } catch {
            // Ignore invalid image URLs.
          }
        }

        card.appendChild(makeElement('h3', ad.title));

        if (ad.description) {
          card.appendChild(makeElement('p', ad.description));
        }

        if (ad.target_url) {
          try {
            const target = new URL(ad.target_url);

            if (['https:', 'http:'].includes(target.protocol)) {
              const link = makeElement('a', 'View Promotion', 'primary');
              link.href = target.href;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              card.appendChild(link);
            }
          } catch {
            // Ignore invalid destination links.
          }
        }

        list.appendChild(card);
      });

      status.textContent =
        'Showing ' + advertisements.length + ' published promotion(s).';
    } catch (error) {
      console.error('SCBS public advertisements:', error);
      status.textContent =
        'Promotions could not be loaded. Please try again later.';
    }
  }

  loadPublicAdvertisements();
})();// ============================================
// SCBS CUSTOMER MESSAGES INBOX
// ============================================
(() => {
  'use strict';

  const list = document.getElementById('customer-messages-list');
  const statusText = document.getElementById('admin-customer-messages-status');
  const refreshButton = document.getElementById('refresh-customer-messages');
  const filter = document.getElementById('message-status-filter');

  if (!list || !statusText || !refreshButton || !filter) return;

  function showStatus(message, isError = false) {
    statusText.textContent = message;
    statusText.style.color = isError ? '#ffaaaa' : '';
  }

  function createLabel(text) {
    const label = document.createElement('label');
    label.textContent = text;
    return label;
  }

  async function loadMessages() {
    list.replaceChildren();
    showStatus('Loading customer messages...');

    try {
      const query = filter.value
        ? '?status=' + encodeURIComponent(filter.value)
        : '';

      const response = await fetch('/api/admin/messages' + query, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(
          result.error || 'Unable to load customer messages.'
        );
      }

      if (!result.messages.length) {
        showStatus('No customer messages found.');
        return;
      }

      showStatus('Showing ' + result.messages.length + ' message(s).');

      for (const item of result.messages) {
        const card = document.createElement('article');
        card.className = 'card';

        const heading = document.createElement('h3');
        heading.textContent = item.subject;

        const reference = document.createElement('p');
        reference.textContent = 'Reference: ' + item.reference_code;

        const sender = document.createElement('p');
        sender.textContent = 'Customer: ' + item.name;

        const contact = document.createElement('p');
        contact.textContent =
          'Email: ' + (item.email || 'Not provided') +
          ' | Phone: ' + (item.phone || 'Not provided');

        const date = document.createElement('p');
        date.textContent = 'Received: ' + item.created_at;

        const message = document.createElement('p');
        message.textContent = item.message;
        message.style.whiteSpace = 'pre-wrap';

        const statusLabel = createLabel('Message status');
        const statusSelect = document.createElement('select');

        for (const value of [
          'new', 'read', 'in_progress', 'resolved', 'spam'
        ]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value.replace('_', ' ');
          statusSelect.appendChild(option);
        }

        statusSelect.value = item.status;

        const replyLabel = createLabel('Reply to customer (visible in Customer Portal)');
        const reply = document.createElement('textarea');
        reply.maxLength = 5000;
        reply.rows = 4;
        reply.value = item.admin_reply || '';
        reply.placeholder = 'Write a response the customer can read in their Messages tab';

        const notesLabel = createLabel('Private administrator notes');
        const notes = document.createElement('textarea');
        notes.maxLength = 2000;
        notes.rows = 3;
        notes.value = item.admin_notes || '';
        notes.placeholder = 'Private notes for SCBS administrators';

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'primary';
        saveButton.textContent = 'Save Changes';

        saveButton.addEventListener('click', async () => {
          saveButton.disabled = true;

          try {
            const updateResponse = await fetch(
              '/api/admin/messages/' + encodeURIComponent(item.id),
              {
                method: 'PATCH',
                credentials: 'same-origin',
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json'
                },
                body: JSON.stringify({
                  status: statusSelect.value,
                  admin_notes: notes.value,
                  admin_reply: reply.value
                })
              }
            );

            const updateResult = await updateResponse.json();

            if (!updateResponse.ok || updateResult.success !== true) {
              throw new Error(
                updateResult.error || 'Unable to update message.'
              );
            }

            showStatus('Customer message updated successfully.');
            await loadMessages();
          } catch (error) {
            showStatus(error.message, true);
          } finally {
            saveButton.disabled = false;
          }
        });

        card.append(
          heading,
          reference,
          sender,
          contact,
          date,
          message,
          statusLabel,
          statusSelect,
          replyLabel,
          reply,
          notesLabel,
          notes,
          saveButton
        );

        list.appendChild(card);
      }
    } catch (error) {
      showStatus(error.message, true);
    }
  }

  refreshButton.addEventListener('click', loadMessages);
  filter.addEventListener('change', loadMessages);

  console.log('SCBS Customer Messages Inbox initialized.');
})();// ============================================
// SCBS BOOKS MANAGEMENT DASHBOARD
// ============================================
(() => {
  'use strict';

  const form = document.getElementById('book-form');
  const list = document.getElementById('book-list');
  const statusText = document.getElementById('book-status');
  const loadButton = document.getElementById('load-books');
  const cancelButton = document.getElementById('cancel-book-edit');

  if (!form || !list || !statusText || !loadButton || !cancelButton) {
    return;
  }

  const fields = {
    book_code: document.getElementById('book-code'),
    title: document.getElementById('book-title'),
    author: document.getElementById('book-author'),
    description: document.getElementById('book-description'),
    category: document.getElementById('book-category'),
    format: document.getElementById('book-format'),
    price: document.getElementById('book-price'),
    stock: document.getElementById('book-stock'),
    cover: document.getElementById('book-cover'),
    publication_status: document.getElementById('book-publication-status')
  };

  let editingId = null;
  let books = [];

  function showStatus(message, isError = false) {
    statusText.textContent = message;
    statusText.style.color = isError ? '#ffaaaa' : '';
  }

  function money(ngwee) {
    return 'K' + (Number(ngwee || 0) / 100).toFixed(2);
  }

  function makeCell(text) {
    const cell = document.createElement('td');
    cell.textContent = String(text ?? '');
    return cell;
  }

  async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });

    const result = await response.json();

    if (!response.ok || result.success !== true) {
      throw new Error(result.error || 'The request failed.');
    }

    return result;
  }

  function resetForm() {
    editingId = null;
    window.scbsEditingBookId = null;
    form.reset();

    fields.author.value = 'Sergio Chabu';
    fields.format.value = 'print';
    fields.price.value = '0';
    fields.stock.value = '0';
    fields.publication_status.value = 'draft';

    form.querySelector('button[type="submit"]').textContent = 'Save Book';
    cancelButton.hidden = true;
  }

  function startEditing(book) {
    editingId = book.id;
    window.scbsEditingBookId = book.id;

    fields.book_code.value = book.book_code;
    fields.title.value = book.title;
    fields.author.value = book.author;
    fields.description.value = book.description || '';
    fields.category.value = book.category || '';
    fields.format.value = book.format;
    fields.price.value = (Number(book.price_ngwee) / 100).toFixed(2);
    fields.stock.value = book.stock_quantity;
    fields.cover.value = book.cover_image_url || '';
    fields.publication_status.value = book.publication_status;

    form.querySelector('button[type="submit"]').textContent = 'Update Book';
    cancelButton.hidden = false;

    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function updateStatus(book, publicationStatus) {
    try {
      await apiRequest('/api/books/' + encodeURIComponent(book.id) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({
          publication_status: publicationStatus
        })
      });

      showStatus('Book status updated successfully.');
      await loadBooks();
    } catch (error) {
      showStatus(error.message, true);
    }
  }

  function renderBooks() {
    list.replaceChildren();

    if (!books.length) {
      const row = document.createElement('tr');
      const cell = makeCell('No books found.');
      cell.colSpan = 8;
      row.appendChild(cell);
      list.appendChild(row);
      return;
    }

    for (const book of books) {
      const row = document.createElement('tr');

      row.append(
        makeCell(book.book_code),
        makeCell(book.title),
        makeCell(book.author),
        makeCell(book.format),
        makeCell(money(book.price_ngwee)),
        makeCell(book.stock_quantity),
        makeCell(book.publication_status)
      );

      const actions = document.createElement('td');

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'ghost';
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', () => startEditing(book));

      const statusSelect = document.createElement('select');

      for (const value of ['draft', 'published', 'archived']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        statusSelect.appendChild(option);
      }

      statusSelect.value = book.publication_status;

      const statusButton = document.createElement('button');
      statusButton.type = 'button';
      statusButton.className = 'primary';
      statusButton.textContent = 'Update Status';

      statusButton.addEventListener('click', () => {
        statusButton.disabled = true;

        updateStatus(book, statusSelect.value)
          .finally(() => {
            statusButton.disabled = false;
          });
      });

      actions.append(editButton, document.createElement('br'), statusSelect,
        document.createElement('br'), statusButton);

      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  async function loadBooks() {
    loadButton.disabled = true;
    showStatus('Loading books...');

    try {
      const result = await apiRequest('/api/admin/books');
      books = result.books || [];
      renderBooks();
      showStatus('Loaded ' + books.length + ' book(s).');
    } catch (error) {
      books = [];
      renderBooks();
      showStatus(error.message, true);
    } finally {
      loadButton.disabled = false;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const priceZmw = Number(fields.price.value);
    const stock = Number(fields.stock.value);

    if (
      !Number.isFinite(priceZmw) ||
      priceZmw < 0 ||
      !Number.isSafeInteger(Math.round(priceZmw * 100)) ||
      !Number.isSafeInteger(stock) ||
      stock < 0
    ) {
      showStatus('Enter a valid price and non-negative whole-number stock.', true);
      return;
    }

    const book = {
      book_code: fields.book_code.value.trim(),
      title: fields.title.value.trim(),
      author: fields.author.value.trim(),
      description: fields.description.value.trim(),
      category: fields.category.value.trim(),
      format: fields.format.value,
      price_ngwee: Math.round(priceZmw * 100),
      stock_quantity: stock,
      publication_status: fields.publication_status.value,
      cover_image_url: fields.cover.value.trim() || null
    };

    const saveButton = form.querySelector('button[type="submit"]');
    saveButton.disabled = true;

    try {
      const result = await apiRequest(
        editingId === null ? '/api/books' : '/api/books/' + editingId,
        {
          method: editingId === null ? 'POST' : 'PUT',
          body: JSON.stringify(book)
        }
      );

      showStatus(result.message || 'Book saved successfully.');
      resetForm();
      await loadBooks();
    } catch (error) {
      showStatus(error.message, true);
    } finally {
      saveButton.disabled = false;
    }
  });

  loadButton.addEventListener('click', loadBooks);

  cancelButton.addEventListener('click', () => {
    resetForm();
    window.scbsEditingBookId = null;
    showStatus('Book editing cancelled.');
});

  console.log('SCBS Books Management initialized.');
})();// SCBS PUBLIC BOOKS - Search, categories and published books
(() => {
  const bookList = document.getElementById("public-book-list");
  const bookStatus = document.getElementById("public-book-status");
  const searchInput = document.getElementById("public-book-search");
  const categorySelect = document.getElementById("public-book-category");

  if (!bookList || !bookStatus) {
    console.info("SCBS Public Books section not found.");
    return;
  }

  let publishedBooks = [];

  const money = (ngwee) =>
    "K" + (Number(ngwee || 0) / 100).toFixed(2);

  function populateCategories() {
    if (!categorySelect) return;

    const previousCategory = categorySelect.value;
    const categories = [
      ...new Set(
        publishedBooks
          .map((book) => String(book.category || "").trim())
          .filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b));

    categorySelect.replaceChildren();

    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All categories";
    categorySelect.appendChild(allOption);

    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      categorySelect.appendChild(option);
    });

    if (categories.includes(previousCategory)) {
      categorySelect.value = previousCategory;
    }
  }

  function renderBooks() {
    const query = (searchInput?.value || "").trim().toLowerCase();
    const selectedCategory = categorySelect?.value || "";

    const filteredBooks = publishedBooks.filter((book) => {
      const searchableText = [
        book.title,
        book.author,
        book.description,
        book.category,
        book.book_code
      ].join(" ").toLowerCase();

      const matchesSearch = searchableText.includes(query);
      const matchesCategory =
        !selectedCategory || book.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });

    bookList.replaceChildren();

    if (filteredBooks.length === 0) {
      bookStatus.textContent = publishedBooks.length === 0
        ? "No books have been published yet. Please check back soon."
        : "No books match your search. Try another title or category.";
      return;
    }

    bookStatus.textContent =
      `Showing ${filteredBooks.length} of ${publishedBooks.length} published book(s).`;

    filteredBooks.forEach((book) => {
      const card = document.createElement("article");
      card.className = "card";

      if (book.cover_image_url) {
        const cover = document.createElement("img");
        cover.src = book.cover_image_url;
        cover.alt = `Cover of ${book.title || "SCBS book"}`;
        cover.loading = "lazy";
        cover.style.maxWidth = "100%";
        cover.style.maxHeight = "260px";
        cover.style.objectFit = "contain";
        cover.addEventListener("error", () => cover.remove());
        card.appendChild(cover);
      } else {
        const icon = document.createElement("div");
        icon.className = "card-icon";
        icon.textContent = "ðŸ“š";
        card.appendChild(icon);
      }

      const title = document.createElement("h3");
      title.textContent = book.title || "Untitled book";
      card.appendChild(title);

      const author = document.createElement("p");
      author.textContent = `Author: ${book.author || "Sergio Chabu"}`;
      card.appendChild(author);

      if (book.category) {
        const category = document.createElement("p");
        category.textContent = `Category: ${book.category}`;
        card.appendChild(category);
      }

      const description = document.createElement("p");
      description.textContent =
        book.description || "Discover this publication from SCBS.";
      card.appendChild(description);

      const format = document.createElement("p");
      format.textContent =
        `Format: ${String(book.format || "print").toUpperCase()}`;
      card.appendChild(format);

      const price = document.createElement("p");
      price.textContent = `Price: ${money(book.price_ngwee)}`;
      card.appendChild(price);

      if (book.format !== "digital") {
        const stock = document.createElement("p");
        const quantity = Number(book.stock_quantity || 0);
        stock.textContent = quantity > 0
          ? `Availability: ${quantity} in stock`
          : "Availability: Please enquire";
        card.appendChild(stock);
      }

      const enquire = document.createElement("button");
      enquire.type = "button";
      enquire.className = "ghost";
      enquire.textContent = "Enquire about this book";

      enquire.addEventListener("click", () => {
        const message =
          `Hello SCBS, I would like to enquire about this book:\n` +
          `Title: ${book.title || "Untitled book"}\n` +
          `Author: ${book.author || "Sergio Chabu"}\n` +
          `Price: ${money(book.price_ngwee)}\n` +
          `Book code: ${book.book_code || "Not provided"}`;

        const whatsappUrl =
          `https://wa.me/260967575366?text=${encodeURIComponent(message)}`;

        window.open(whatsappUrl, "_blank", "noopener,noreferrer");
      });

      card.appendChild(enquire);
      bookList.appendChild(card);
    });
  }

  async function loadPublicBooks() {
    bookStatus.textContent = "Loading published books...";
    bookList.replaceChildren();

    try {
      const response = await fetch("/api/books", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error("Could not load published books.");
      }

      publishedBooks = Array.isArray(result.books)
        ? result.books
        : Array.isArray(result.data)
          ? result.data
          : [];

      populateCategories();
      renderBooks();
    } catch (error) {
      console.error("SCBS Public Books error:", error);
      bookStatus.textContent =
        "Books could not be loaded. Please refresh the page and try again.";
    }
  }

  searchInput?.addEventListener("input", renderBooks);
  categorySelect?.addEventListener("change", renderBooks);

  loadPublicBooks();
  window.addEventListener("focus", loadPublicBooks);

  console.info("SCBS Public Books initialized.");
})();

// SCBS BOOK COVER UPLOAD - Admin dashboard
(() => {
  'use strict';

  const fileInput = document.getElementById('book-cover-file');
  const preview = document.getElementById('book-cover-preview');
  const uploadButton = document.getElementById('upload-book-cover');
  const coverUrlInput = document.getElementById('book-cover');
  const status = document.getElementById('book-cover-upload-status');

  if (!fileInput || !preview || !uploadButton || !coverUrlInput || !status) {
    console.info('SCBS book-cover upload controls not found.');
    return;
  }

  let previewUrl = null;

  function showUploadStatus(message, isError = false) {
    status.textContent = message;
    status.style.color = isError ? '#ffaaaa' : '';
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }

    preview.removeAttribute('src');
    preview.hidden = true;

    if (!file) {
      showUploadStatus('');
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(file.type)) {
      fileInput.value = '';
      showUploadStatus('Choose a JPG, PNG, or WebP image.', true);
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      fileInput.value = '';
      showUploadStatus('The cover image must be 2 MB or smaller.', true);
      return;
    }

    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.hidden = false;
    showUploadStatus('Cover preview ready. Save the book before uploading.');
  });

    uploadButton.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    const bookId = Number(window.scbsEditingBookId);

    if (!file) {
      showUploadStatus('Choose a cover image first.', true);
      return;
    }

    if (!Number.isSafeInteger(bookId) || bookId < 1) {
      showUploadStatus(
        'Save the book first, then click Edit on that book before uploading its cover.',
        true
      );
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      showUploadStatus('The cover image must be 2 MB or smaller.', true);
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(file.type)) {
      showUploadStatus('Choose a JPG, PNG, or WebP image.', true);
      return;
    }

    const formData = new FormData();
    formData.append('cover', file);

    uploadButton.disabled = true;
    showUploadStatus('Uploading cover image...');

    try {
      const response = await fetch(
        `/api/admin/books/${bookId}/cover`,
        {
          method: 'POST',
          credentials: 'same-origin',
          body: formData
        }
      );

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || 'Cover upload failed.');
      }

      coverUrlInput.value = result.cover_image_url;

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      previewUrl = null;
      fileInput.value = '';

      showUploadStatus('Cover uploaded successfully and saved to the book.');

      // Refresh the current preview using the saved cover URL.
      preview.src = result.cover_image_url;
      preview.hidden = false;

      preview.onerror = () => {
        showUploadStatus(
          'Cover was saved, but its preview could not be loaded.',
          true
        );
      };

      preview.onload = () => {
        showUploadStatus('Cover uploaded and displayed successfully.');
      };

      // Refresh the Books Management list if its reload function is available.
      document.getElementById('load-books')?.click();

    } catch (error) {
      console.error('SCBS cover upload failed:', error);
      showUploadStatus(error.message || 'Cover upload failed.', true);
    } finally {
      uploadButton.disabled = false;
    }
  });
  window.addEventListener('beforeunload', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });

  console.info('SCBS book-cover preview initialized.');
})();

// ============================================
// SCBS OWNER PAYMENT MANAGEMENT
// ============================================
(() => {
  'use strict';

  const refreshButton = document.getElementById('load-admin-payments');
  const list = document.getElementById('admin-payment-list');
  const status = document.getElementById('admin-payment-status');

  if (!refreshButton || !list || !status) return;

  function addCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value == null || value === '' ? '-' : String(value);
    row.appendChild(cell);
  }

  async function loadPayments() {
    refreshButton.disabled = true;
    status.textContent = 'Loading payment records...';
    list.replaceChildren();

    try {
      const response = await fetch('/api/admin/payments', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(
          result.error || 'Unable to load payments. Check owner login.'
        );
      }

      const payments = Array.isArray(result.payments)
        ? result.payments
        : Array.isArray(result.data)
          ? result.data
          : [];
           // Update live payment summary cards.
      const countStatus = (wantedStatus) =>
        payments.filter(
          (payment) =>
            String(payment.status || "").toLowerCase() === wantedStatus
        ).length;

      const summaryValues = {
        "admin-payment-total": payments.length,
        "admin-payment-pending": countStatus("pending"),
        "admin-payment-successful": countStatus("successful"),
        "admin-payment-failed": countStatus("failed")
      };

      for (const [elementId, value] of Object.entries(summaryValues)) {
        const element = document.getElementById(elementId);
        if (element) element.textContent = String(value);
      }

      if (payments.length === 0) {
        status.textContent = 'No payment records were returned.';
        return;
      }

      const table = document.createElement('table');
      const head = document.createElement('thead');
      const headerRow = document.createElement('tr');

      [
  'Payment ID',
  'Customer',
  'Customer Email',
  'Order Number',
  'Provider',
  'Amount',
  'Currency',
  'Status',
  'Date Requested',
  'Actions'
].forEach((heading) => {
        const th = document.createElement('th');
        th.textContent = heading;
        headerRow.appendChild(th);
      });

      head.appendChild(headerRow);
      table.appendChild(head);

      const body = document.createElement('tbody');

      for (const payment of payments) {
  const row = document.createElement('tr');

  addCell(row, payment.id);
  addCell(row, payment.customer_name);
  addCell(row, payment.customer_email);
  addCell(row, payment.order_number);
  addCell(
    row,
    payment.provider === 'mtn_momo'
      ? 'MTN MoMo'
      : payment.provider === 'airtel_money'
        ? 'Airtel Money'
        : payment.provider
  );
        addCell(
          row,
          Number.isSafeInteger(payment.amount_ngwee)
            ? 'K' + (payment.amount_ngwee / 100).toFixed(2)
            : 'Amount unavailable'
        );
        addCell(row, payment.currency);
        addCell(row, payment.status);
        addCell(row, payment.created_at);

        const actions = document.createElement('td');
        const reviewButton = document.createElement('button');
        reviewButton.type = 'button';
        reviewButton.className = 'ghost';
        reviewButton.textContent = 'Review';
        reviewButton.addEventListener('click', () => {
          const reference = payment.provider_reference || 'Not supplied';
          const reason = payment.failure_reason || 'None';
          window.alert(
            'Payment #' + payment.id + '\n' +
            'Order: ' + (payment.order_number || '-') + '\n' +
            'Customer: ' + (payment.customer_name || '-') + '\n' +
            'Provider: ' + (payment.provider || '-') + '\n' +
            'Amount: ' + (payment.currency || 'ZMW') + ' ' +
              (Number.isSafeInteger(payment.amount_ngwee) ? (payment.amount_ngwee / 100).toFixed(2) : '-') + '\n' +
            'Status: ' + (payment.status || '-') + '\n' +
            'Provider reference: ' + reference + '\n' +
            'Failure/rejection reason: ' + reason + '\n\n' +
            'SCBS demo requests do not confirm that money was received.'
          );
        });
        actions.appendChild(reviewButton);

        if (String(payment.status || '').toLowerCase() === 'pending') {
          const rejectButton = document.createElement('button');
          rejectButton.type = 'button';
          rejectButton.className = 'ghost';
          rejectButton.textContent = 'Reject';
          rejectButton.addEventListener('click', async () => {
            const reason = window.prompt(
              'Enter the reason for rejecting this pending payment request. No money is collected by this demo.'
            );
            if (reason === null) return;
            if (reason.trim().length < 3) {
              window.alert('Please enter a reason of at least 3 characters.');
              return;
            }
            if (!window.confirm('Mark payment #' + payment.id + ' as failed? This does not move money.')) return;

            rejectButton.disabled = true;
            try {
              const rejectResponse = await fetch('/api/admin/payments/' + encodeURIComponent(payment.id) + '/reject', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                },
                body: JSON.stringify({ reason: reason.trim() })
              });
              const rejectResult = await rejectResponse.json();
              if (!rejectResponse.ok || rejectResult.success !== true) {
                throw new Error(rejectResult.error || 'Unable to reject payment request.');
              }
              status.textContent = rejectResult.message || 'Payment request rejected.';
              await loadPayments();
            } catch (error) {
              window.alert(error.message || 'Unable to reject payment request.');
              rejectButton.disabled = false;
            }
          });
          actions.appendChild(rejectButton);
        }

        row.appendChild(actions);
        body.appendChild(row);
      }

      table.appendChild(body);
      list.appendChild(table);

      status.textContent =
        'Loaded ' + payments.length + ' payment record(s).';
    } catch (error) {
      status.textContent =
        error.message || 'Unable to load payment records.';
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', loadPayments);

// Load payment summaries and records automatically.
loadPayments();

console.info('SCBS owner payment management initialized.');
})();

// ============================================
// SCBS CUSTOMER REGISTRATION
// ============================================
(() => {
  "use strict";

  const registerForm = document.getElementById("register-form");
  const loginForm = document.getElementById("login-form");
  const showRegister = document.getElementById("show-register");
  const showLogin = document.getElementById("show-login");
  const registerStatus = document.getElementById(
    "customer-register-status"
  );
  const loginStatus = document.getElementById(
    "customer-login-status"
  );

  if (!registerForm || !loginForm || !showRegister || !showLogin) {
    console.warn("SCBS registration: required HTML elements were not found.");
    return;
  }

  // Switch between customer sign-in and registration.
  showRegister.addEventListener("click", () => {
    loginForm.hidden = true;
    registerForm.hidden = false;

    if (loginStatus) loginStatus.textContent = "";
    if (registerStatus) registerStatus.textContent = "";
  });

  showLogin.addEventListener("click", () => {
    registerForm.hidden = true;
    loginForm.hidden = false;

    if (loginStatus) loginStatus.textContent = "";
    if (registerStatus) registerStatus.textContent = "";
  });

  // Submit a new customer registration.
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitButton = document.getElementById(
      "customer-register-submit"
    );

    const fullName = document.getElementById("register-name").value.trim();
    const email = document.getElementById("register-email").value.trim();
    const phone = document.getElementById("register-phone").value.trim();
    const password = document.getElementById("register-password").value;
    const pictureInput = document.getElementById("register-picture");

    if (password.length < 12 || password.length > 72) {
      registerStatus.textContent =
        "Your password must contain between 12 and 72 characters.";
      return;
    }

    if (pictureInput.files.length > 0) {
      const picture = pictureInput.files[0];
      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
      ];

      if (!allowedTypes.includes(picture.type)) {
        registerStatus.textContent =
          "Choose a JPEG, PNG, or WebP profile picture.";
        return;
      }

      if (picture.size > 2 * 1024 * 1024) {
        registerStatus.textContent =
          "Your profile picture must be 2 MB or smaller.";
        return;
      }
    }

    submitButton.disabled = true;
    registerStatus.textContent = "Creating your SCBS account...";

    try {
      const response = await fetch("/api/customer/register", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          full_name: fullName,
          email,
          phone,
          password
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error || result.message || "Registration failed."
        );
      }

      // Registration creates a customer session.
      // Upload the optional picture using that session.
      if (pictureInput.files.length > 0) {
        const pictureData = new FormData();
        pictureData.append("picture", pictureInput.files[0]);

        registerStatus.textContent =
          "Account created. Uploading your profile picture...";

        const pictureResponse = await fetch(
          "/api/customer/profile-picture",
          {
            method: "POST",
            credentials: "same-origin",
            body: pictureData
          }
        );

        const pictureResult = await pictureResponse.json();

        if (!pictureResponse.ok || !pictureResult.success) {
          registerStatus.textContent =
            "Your account was created, but the profile picture upload failed. " +
            (pictureResult.error || "You can try uploading it again later.");
          registerForm.reset();
          return;
        }
      }

      registerForm.reset();

      registerStatus.textContent =
        "Your SCBS account was created successfully! You are signed in.";

      const customerBackdrop = document.getElementById("login-backdrop");
      if (customerBackdrop) customerBackdrop.hidden = true;
      document.getElementById("customer-login").textContent = "My Account";
      window.dispatchEvent(new CustomEvent("scbs:customer-session-ready"));
      notify("Welcome to SCBS", "Your customer account is ready.", "success");
      window.setTimeout(() => document.getElementById("customer-dashboard")?.scrollIntoView({
        behavior: "smooth", block: "start"
      }), 250);

      console.log("SCBS customer registration successful.");

    } catch (error) {
      registerStatus.textContent =
        error.message || "Unable to create your account. Please try again.";

    } finally {
      submitButton.disabled = false;
    }
  });
})();// ============================================
// SCBS CUSTOMER DASHBOARD
// ============================================
(() => {
  "use strict";

  const dashboard = document.getElementById("customer-dashboard");
  const openButton = document.getElementById("customer-login");
  const backdrop = document.getElementById("login-backdrop");
  const dashboardStatus = document.getElementById("customer-dashboard-status");

  if (!dashboard || !openButton || !backdrop) {
    console.warn("SCBS dashboard: required HTML elements were not found.");
    return;
  }

  let currentCustomer = null;

  async function loadCustomerProfile() {
    dashboardStatus.textContent = "Loading your account...";

    try {
      const response = await fetch("/api/customer/me", {
        credentials: "same-origin"
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        dashboardStatus.textContent = "";
        dashboard.hidden = true;
        openButton.textContent = "Customer Portal";
        return;
      }

      currentCustomer = result.customer;

      document.getElementById("customer-dashboard-name").textContent =
        currentCustomer.full_name || "SCBS Customer";

      document.getElementById("customer-dashboard-email").textContent =
        currentCustomer.email || "";

      document.getElementById("customer-dashboard-code").textContent =
        currentCustomer.customer_code
          ? "Customer code: " + currentCustomer.customer_code
          : "";

      document.getElementById("customer-profile-name").textContent =
        currentCustomer.full_name || "";

      document.getElementById("customer-profile-email").textContent =
        currentCustomer.email || "";

      document.getElementById("customer-profile-phone").textContent =
        currentCustomer.phone || "";

      const picture = document.getElementById("customer-profile-picture");
      const loginAvatar = document.getElementById("customer-login-avatar");
      const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop stop-color='%23438ff5'/%3E%3Cstop offset='1' stop-color='%238ce6d0'/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='60' cy='60' r='58' fill='%230c1e36'/%3E%3Ccircle cx='60' cy='43' r='22' fill='url(%23g)'/%3E%3Cpath d='M19 105c3-23 19-36 41-36s38 13 41 36' fill='url(%23g)'/%3E%3C/svg%3E";
      const pictureUrl = currentCustomer.profile_picture_url || defaultAvatar;
      if (picture) {
        picture.onerror = () => {
          picture.onerror = null;
          picture.src = defaultAvatar;
        };
        picture.src = currentCustomer.profile_picture_url
          ? currentCustomer.profile_picture_url + (currentCustomer.profile_picture_url.includes("?") ? "&" : "?") + "v=" + Date.now()
          : defaultAvatar;
        picture.alt = currentCustomer.profile_picture_url
          ? "Customer profile picture"
          : "Default SCBS customer avatar";
      }
      if (loginAvatar) {
        loginAvatar.onerror = () => {
          loginAvatar.onerror = null;
          loginAvatar.src = defaultAvatar;
        };
        loginAvatar.src = pictureUrl;
      }

      dashboard.hidden = false;
      backdrop.hidden = true;
      openButton.textContent = "My Account";
      dashboardStatus.textContent = "Your account is ready.";

    } catch (error) {
      dashboardStatus.textContent =
        "Unable to load your account. Please try again.";
      console.error("SCBS customer profile error:", error);
    }
  }

  // One event bridge lets the sign-in and registration handlers open the account
  // without a full-page reload or competing click handlers.
  window.addEventListener("scbs:customer-session-ready", async () => {
    await loadCustomerProfile();
  });

  // Restore the account after refresh only when a valid customer session exists.
  loadCustomerProfile();

  // Dashboard navigation.
  // Move the existing cart into My Cart without duplicating its IDs or logic.
  const existingCart = document.getElementById("scbs-shopping-cart");
  const cartMount = document.getElementById("customer-cart-mount");
  if (existingCart && cartMount) {
    cartMount.appendChild(existingCart);
    existingCart.style.marginTop = "12px";
  }

  const panels = {
  profile: document.getElementById("customer-panel-profile"),
  cart: document.getElementById("customer-panel-cart"),
  orders: document.getElementById("customer-panel-orders"),
  payments: document.getElementById("customer-panel-payments"),
  rentals: document.getElementById("customer-panel-rentals"),
  addresses: document.getElementById("customer-panel-addresses"),
  settings: document.getElementById("customer-panel-settings"),
  messages: document.getElementById("customer-panel-messages")
};

  function showPanel(name) {
    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) panel.hidden = key !== name;
    });
  }// ============================================
// SCBS CUSTOMER ADDRESS MANAGEMENT
// ============================================

async function loadCustomerAddresses() {
  const list = document.getElementById("customer-addresses-list");
  if (!list) return;

  list.textContent = "Loading your saved addresses...";

  try {
    const response = await fetch("/api/customer/addresses", {
      credentials: "same-origin"
    });

    const result = await response.json();

    if (!response.ok || result.success !== true) {
      throw new Error(result.error || "Unable to load addresses.");
    }

    const addresses = Array.isArray(result.addresses)
      ? result.addresses
      : [];

    if (addresses.length === 0) {
      list.textContent = "You have no saved delivery addresses yet.";
      return;
    }

    const container = document.createElement("div");

    addresses.forEach(address => {
      const card = document.createElement("article");
      const heading = document.createElement("h4");

      heading.textContent = address.address_label || "Delivery Address";
      card.appendChild(heading);

      const lines = [
        address.house_number,
        address.street,
        address.building_flat,
        address.area,
        address.district,
        address.city,
        address.province,
        address.country
      ].filter(Boolean);

      const details = document.createElement("p");
      details.textContent = lines.join(", ");
      card.appendChild(details);

      if (address.landmark) {
        const landmark = document.createElement("p");
        landmark.textContent = "Landmark: " + address.landmark;
        card.appendChild(landmark);
      }

      if (address.delivery_instructions) {
        const instructions = document.createElement("p");
        instructions.textContent =
          "Delivery instructions: " + address.delivery_instructions;
        card.appendChild(instructions);
      }

      if (address.is_default) {
        const badge = document.createElement("strong");
        badge.textContent = "Default address";
        card.appendChild(badge);
      }

      container.appendChild(card);
    });

    list.replaceChildren(container);

  } catch (error) {
    list.textContent =
      error.message || "Unable to load your saved addresses.";
  }
}

const customerAddressForm =
  document.getElementById("customer-address-form");

customerAddressForm?.addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const status = document.getElementById("customer-dashboard-status");

  const payload = {
    address_label: document.getElementById("address-label").value.trim(),
    country: document.getElementById("address-country").value.trim(),
    province: document.getElementById("address-province").value.trim(),
    city: document.getElementById("address-city").value.trim(),
    district: document.getElementById("address-district").value.trim(),
    area: document.getElementById("address-area").value.trim(),
    street: document.getElementById("address-street").value.trim(),
    house_number: document.getElementById("address-house-number").value.trim(),
    building_flat: document.getElementById("address-building").value.trim(),
    landmark: document.getElementById("address-landmark").value.trim(),
    delivery_instructions:
      document.getElementById("address-instructions").value.trim()
  };

  submitButton.disabled = true;
  status.textContent = "Saving your delivery address...";

  try {
    const response = await fetch("/api/customer/addresses", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok || result.success !== true) {
      throw new Error(result.error || "Unable to save the address.");
    }

    form.reset();
    document.getElementById("address-label").value = "Home";
    document.getElementById("address-country").value = "Zambia";

    status.textContent = "Delivery address saved successfully.";

    await loadCustomerAddresses();

  } catch (error) {
    status.textContent =
      error.message || "Unable to save your delivery address.";
  } finally {
    submitButton.disabled = false;
  }
});

document.getElementById("customer-tab-addresses")?.addEventListener(
  "click",
  () => {
    showPanel("addresses");
    loadCustomerAddresses();
  }
);

// ============================================
// SCBS CUSTOMER ORDER HISTORY
// ============================================
async function loadCustomerOrders() {
  const list = document.getElementById("customer-orders-list");

  list.textContent = "Loading your orders...";

  try {
    const response = await fetch("/api/customer/orders", {
      credentials: "same-origin"
    });

    const result = await response.json();

    if (!response.ok || result.success !== true) {
      throw new Error(result.error || "Unable to load your orders.");
    }

    const orders = Array.isArray(result.orders) ? result.orders : [];

    if (orders.length === 0) {
      list.textContent = "You have not placed any orders yet.";
      return;
    }

    const table = document.createElement("table");
    const header = document.createElement("tr");

    ["Order Number", "Date", "Total", "Status"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      header.appendChild(th);
    });

    const thead = document.createElement("thead");
    thead.appendChild(header);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    orders.forEach((order) => {
      const row = document.createElement("tr");

      const orderNumber = document.createElement("td");
      orderNumber.textContent = order.order_number || `Order #${order.id}`;

      const date = document.createElement("td");
      date.textContent = order.created_at
        ? new Date(order.created_at).toLocaleString()
        : "-";

      const total = document.createElement("td");
      const amount = Number(order.total_ngwee);

      total.textContent = Number.isFinite(amount)
        ? `${order.currency || "ZMW"} ${(amount / 100).toFixed(2)}`
        : "-";

      const status = document.createElement("td");
      const statusLabels = {
        pending: "Pending — awaiting confirmation",
        confirmed: "Confirmed",
        processing: "Being prepared",
        ready: "Ready for collection or dispatch",
        completed: "Completed",
        cancelled: "Cancelled"
      };
      const currentStatus = String(order.status || "pending").toLowerCase();
      status.textContent = statusLabels[currentStatus] || currentStatus.replace(/_/g, " ");

      row.append(orderNumber, date, total, status);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    list.replaceChildren(table);

  } catch (error) {
    list.textContent =
      error.message || "Unable to load your orders. Please try again.";
  }
}// ============================================
// SCBS CUSTOMER PAYMENT HISTORY
// ============================================
async function loadCustomerPayments() {
  const list = document.getElementById("customer-payments-list");

  if (!list) return;

  list.textContent = "Loading your payment history...";

  try {
    const response = await fetch("/api/customer/payments", {
      credentials: "same-origin"
    });

    const result = await response.json();

    if (!response.ok || result.success !== true) {
      throw new Error(
        result.error || "Unable to load your payment history."
      );
    }

    const payments = Array.isArray(result.payments)
      ? result.payments
      : [];

    if (payments.length === 0) {
      list.textContent = "You have no payment requests yet.";
      return;
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const header = document.createElement("tr");

    [
      "Payment Reference",
      "Order",
      "Provider",
      "Amount",
      "Status",
      "Date"
    ].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      header.appendChild(th);
    });

    thead.appendChild(header);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    payments.forEach((payment) => {
      const row = document.createElement("tr");

      const reference = document.createElement("td");
      reference.textContent =
        payment.provider_reference || `Payment #${payment.id}`;

      const order = document.createElement("td");
      order.textContent =
        payment.order_number || `Order #${payment.order_id}`;

      const provider = document.createElement("td");
      provider.textContent =
        payment.provider === "mtn_momo"
          ? "MTN Mobile Money"
          : payment.provider === "airtel_money"
            ? "Airtel Money"
            : payment.provider || "Unknown";

      const amount = document.createElement("td");
      const amountNgwee = Number(payment.amount_ngwee);

      amount.textContent = Number.isFinite(amountNgwee)
        ? `${payment.currency || "ZMW"} ${(amountNgwee / 100).toFixed(2)}`
        : "-";

      const status = document.createElement("td");
      status.textContent = payment.status || "Pending";

      const date = document.createElement("td");
      date.textContent = payment.created_at
        ? new Date(payment.created_at).toLocaleString()
        : "-";

      row.append(reference, order, provider, amount, status, date);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    list.replaceChildren(table);

  } catch (error) {
    list.textContent =
      error.message || "Unable to load your payment history.";
  }
}

document.getElementById("customer-tab-cart")?.addEventListener(
  "click", () => {
    showPanel("cart");
    const addressSelect = document.getElementById("scbs-delivery-address");
    if (addressSelect) {
      addressSelect.dispatchEvent(new Event("scbs-cart-open"));
    }
  }
);

document.getElementById("customer-tab-orders")?.addEventListener(
  "click", () => {
    showPanel("orders");
    loadCustomerOrders();
  }
);
document.getElementById("customer-tab-settings")?.addEventListener(
  "click",
  async () => {
    showPanel("settings");

    const status = document.getElementById("customer-settings-status");
    status.textContent = "";

    try {
      const response = await fetch("/api/customer/me", {
        credentials: "same-origin"
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || "Unable to load your settings.");
      }

      currentCustomer = result.customer;

      document.getElementById("customer-settings-name").value =
        currentCustomer.full_name || "";

      document.getElementById("customer-settings-phone").value =
        currentCustomer.phone || "";

      document.getElementById("customer-settings-country").value =
        currentCustomer.country || "Zambia";

    } catch (error) {
      status.textContent = error.message || "Unable to load your settings.";
    }
  }
);
// Save SCBS customer profile settings.
document.getElementById("customer-settings-profile-form")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const status = document.getElementById("customer-settings-status");
    const submitButton = event.currentTarget.querySelector(
      'button[type="submit"]'
    );

    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "Saving...";
    status.textContent = "";

    try {
      const response = await fetch("/api/customer/settings/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          full_name: document.getElementById("customer-settings-name").value,
          phone: document.getElementById("customer-settings-phone").value,
          country: document.getElementById("customer-settings-country").value
        })
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || "Unable to save profile settings.");
      }

      currentCustomer = result.customer;

      const profileName = document.getElementById("customer-profile-name");
      const profilePhone = document.getElementById("customer-profile-phone");

      if (profileName) {
        profileName.textContent = currentCustomer.full_name || "";
      }

      if (profilePhone) {
        profilePhone.textContent = currentCustomer.phone || "";
      }

      status.textContent = "Profile settings saved successfully.";
    } catch (error) {
      status.textContent =
        error.message || "Unable to save profile settings.";
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  });
// Send a message to SCBS customer support.
document.getElementById("customer-settings-support-form")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const status = document.getElementById("customer-settings-status");
    const submitButton = form.querySelector('button[type="submit"]');

    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "Sending...";
    status.textContent = "";

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: currentCustomer?.full_name || "",
          email: currentCustomer?.email || "",
          phone: currentCustomer?.phone || "",
          subject: document.getElementById(
            "customer-settings-subject"
          ).value,
          message: document.getElementById(
            "customer-settings-message"
          ).value
        })
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || "Unable to send your enquiry.");
      }

      status.textContent =
        "Your message was sent. Reference: " + result.reference;

      form.reset();
    } catch (error) {
      status.textContent =
        error.message || "Unable to contact SCBS support.";
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  });
// Securely change the signed-in customer's password.
document.getElementById("customer-settings-password-form")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const status = document.getElementById("customer-settings-status");
    const submitButton = form.querySelector('button[type="submit"]');

    const currentPassword =
      document.getElementById("customer-current-password").value;
    const newPassword =
      document.getElementById("customer-new-password").value;
    const confirmPassword =
      document.getElementById("customer-confirm-password").value;

    if (newPassword !== confirmPassword) {
      status.textContent = "The new passwords do not match.";
      return;
    }

    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "Changing password...";
    status.textContent = "";

    try {
      const response = await fetch("/api/customer/settings/password", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword
        })
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || "Unable to change your password.");
      }

      form.reset();
      status.textContent = "Your password has been changed successfully.";
    } catch (error) {
      status.textContent =
        error.message || "Unable to change your password.";
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  });
// SCBS CUSTOMER PORTAL MESSAGES: private history and admin replies.
(() => {
  const list = document.getElementById('customer-portal-messages-list');
  const status = document.getElementById('customer-messages-status');
  const form = document.getElementById('customer-message-compose');
  const refresh = document.getElementById('customer-messages-refresh');
  const tab = document.getElementById('customer-tab-messages');
  const badge = document.getElementById('customer-message-badge');
  if (!list || !status || !form || !tab) return;

  async function loadCustomerMessages() {
    list.replaceChildren();
    status.textContent = 'Loading your messages...';
    try {
      const response = await fetch('/api/customer/messages', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load messages.');
      const messages = Array.isArray(data.messages) ? data.messages : [];
      const unread = Number(data.unreadCount || 0);
      if (badge) { badge.textContent = String(unread); badge.hidden = true; }
      if (!messages.length) {
        status.textContent = 'No messages yet. Use the form above to contact SCBS.';
        return;
      }
      status.textContent = `${messages.length} message(s).`;
      for (const item of messages) {
        const card = document.createElement('article');
        card.className = 'card';
        const heading = document.createElement('h4'); heading.textContent = item.subject || 'SCBS message';
        const reference = document.createElement('p'); reference.textContent = `Reference: ${item.reference_code}`;
        const sent = document.createElement('p'); sent.textContent = `Sent: ${item.created_at}`;
        const body = document.createElement('p'); body.textContent = item.message; body.style.whiteSpace = 'pre-wrap';
        const state = document.createElement('p'); state.textContent = `Status: ${String(item.status || 'new').replaceAll('_', ' ')}`;
        card.append(heading, reference, sent, body, state);
        if (item.admin_reply) {
          const replyHeading = document.createElement('h5'); replyHeading.textContent = 'Reply from SCBS';
          const replyBody = document.createElement('p'); replyBody.textContent = item.admin_reply; replyBody.style.whiteSpace = 'pre-wrap';
          const replyDate = document.createElement('p'); replyDate.className = 'muted'; replyDate.textContent = `Reply date: ${item.admin_replied_at || 'Available'}`;
          card.append(replyHeading, replyBody, replyDate);
        } else {
          const waiting = document.createElement('p'); waiting.className = 'muted'; waiting.textContent = 'Waiting for an SCBS reply.';
          card.append(waiting);
        }
        list.append(card);
      }
    } catch (error) {
      status.textContent = error.message || 'Unable to load messages.';
    }
  }

  async function refreshUnreadCount() {
    try {
      const response = await fetch('/api/customer/messages/unread-count', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return; // Not signed in yet; keep the portal quiet.
      const data = await response.json();
      if (!data.success || !badge) return;
      const count = Number(data.unreadCount || 0);
      badge.textContent = String(count);
      badge.hidden = count < 1;
    } catch { /* Network may be offline; the next poll will retry. */ }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const send = document.getElementById('customer-message-send');
    send.disabled = true;
    status.textContent = 'Sending message...';
    try {
      const response = await fetch('/api/customer/messages', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          subject: document.getElementById('customer-message-subject').value,
          message: document.getElementById('customer-message-body').value
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to send message.');
      form.reset();
      status.textContent = `${data.message} Reference: ${data.reference}`;
      await loadCustomerMessages();
    } catch (error) {
      status.textContent = error.message || 'Unable to send message.';
    } finally { send.disabled = false; }
  });
  refresh?.addEventListener('click', loadCustomerMessages);
  refreshUnreadCount();
  window.setInterval(refreshUnreadCount, 60000);
  tab.addEventListener('click', () => {
    const panels = ['profile','cart','orders','payments','rentals','addresses','settings','messages'];
    for (const name of panels) {
      const panel = document.getElementById(`customer-panel-${name}`);
      if (panel) panel.hidden = name !== 'messages';
    }
    loadCustomerMessages();
  });
  console.log('SCBS Customer Portal Messages initialized.');
})();

document.getElementById("customer-tab-rentals")?.addEventListener(
  "click", () => {
    showPanel("rentals");
    loadCustomerRentals();
    loadCustomerRentalBookings();
  }
);
  
document.getElementById("customer-tab-profile")?.addEventListener(
    "click", () => showPanel("profile")
  );

  document.getElementById("customer-tab-payments")?.addEventListener(
  "click", () => {
    showPanel("payments");
    loadCustomerPayments();
  }
);

  document.getElementById("customer-tab-addresses")?.addEventListener(
    "click", () => showPanel("addresses")
  );

  document.getElementById("customer-tab-home")?.addEventListener(
    "click", () => {
      window.location.href = "/";
    }
  );

  // Return to the homepage without ending the customer session.
  document.getElementById("customer-tab-home")?.addEventListener(
    "click", () => {
      window.location.href = "/";
    }
  );

  // Sign out.
  document.getElementById("customer-dashboard-signout")?.addEventListener(
    "click", async () => {
      if (!confirm("Are you sure you want to sign out?")) return;

      dashboardStatus.textContent = "Signing out...";

      try {
        const response = await fetch("/api/customer/logout", {
          method: "POST",
          credentials: "same-origin"
        });

        const result = await response.json();

        if (!response.ok || result.success !== true) {
          throw new Error(result.error || "Sign out failed.");
        }

        currentCustomer = null;
        dashboard.hidden = true;
        backdrop.hidden = true;
        openButton.textContent = "Customer Portal";
        dashboardStatus.textContent = "";
        window.location.href = "/";

      } catch (error) {
        dashboardStatus.textContent =
          error.message || "Unable to sign out.";
      }
    }
  );
})();// ============================================
// SCBS CUSTOMER SHOPPING CART
// ============================================
(() => {
  "use strict";

  const cartContainer = document.getElementById("scbs-cart-items");
  const cartStatus = document.getElementById("scbs-cart-status");
  const cartTotal = document.getElementById("scbs-cart-total");

  if (!cartContainer || !cartStatus || !cartTotal) {
    console.error(
      "SCBS shopping cart could not initialize: one or more cart HTML elements are missing.",
      {
        cartItemsFound: Boolean(cartContainer),
        cartStatusFound: Boolean(cartStatus),
        cartTotalFound: Boolean(cartTotal)
      }
    );
    return;
  }

  const CART_KEY = "scbs-shopping-cart";
  let cart = [];

  try {
    const savedCart = JSON.parse(
      sessionStorage.getItem(CART_KEY) || "[]"
    );

    if (Array.isArray(savedCart)) {
      cart = savedCart.filter(item =>
        Number.isSafeInteger(item.id) &&
        item.id > 0 &&
        typeof item.name === "string" &&
        Number.isSafeInteger(item.price_ngwee) &&
        item.price_ngwee >= 0 &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0
      );
    }
  } catch {
    cart = [];
  }

  function saveCart() {
    sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
  }

  function formatMoney(ngwee) {
    return "ZMW " + (ngwee / 100).toFixed(2);
  }

  function renderCart() {
    cartContainer.replaceChildren();

    if (cart.length === 0) {
      cartStatus.textContent = "Your cart is empty.";
      cartTotal.textContent = formatMoney(0);
      return;
    }

    let total = 0;

    cart.forEach(item => {
      const row = document.createElement("div");
      row.className = "card";
      row.style.marginBottom = "12px";

      const name = document.createElement("h3");
      name.textContent = item.name;

      const price = document.createElement("p");
      price.textContent =
        formatMoney(item.price_ngwee) + " each";

      const quantity = document.createElement("p");
      quantity.textContent = "Quantity: " + item.quantity;

      const lineTotal = item.price_ngwee * item.quantity;
      total += lineTotal;

      const subtotal = document.createElement("p");
      subtotal.textContent = "Subtotal: " + formatMoney(lineTotal);

      const decrease = document.createElement("button");
      decrease.type = "button";
      decrease.className = "ghost";
      decrease.textContent = "âˆ’";
      decrease.setAttribute("aria-label", "Decrease quantity");

      decrease.addEventListener("click", () => {
        if (item.quantity > 1) {
          item.quantity -= 1;
        } else {
          cart = cart.filter(entry => entry.id !== item.id);
        }

        saveCart();
        renderCart();

      });

      const increase = document.createElement("button");
      increase.type = "button";
      increase.className = "ghost";
      increase.textContent = "+";
      increase.setAttribute("aria-label", "Increase quantity");

      increase.addEventListener("click", () => {
        if (item.quantity < 100) {
          item.quantity += 1;
          saveCart();
          renderCart();
        }
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ghost";
      remove.textContent = "Remove";

      remove.addEventListener("click", () => {
        cart = cart.filter(entry => entry.id !== item.id);
        saveCart();
        renderCart();
      });

      row.append(
        name,
        price,
        quantity,
        subtotal,
        decrease,
        increase,
        remove
      );

      cartContainer.appendChild(row);
    });

    cartStatus.textContent =
      cart.length + " product type(s) in your cart.";

    cartTotal.textContent = formatMoney(total);
  }

  // SCBS CHECKOUT: SAVED ADDRESSES AND ORDER SUBMISSION
  const addressSelect = document.getElementById("scbs-delivery-address");
  const orderNotes = document.getElementById("scbs-order-notes");
  const placeOrderButton = document.getElementById("scbs-place-order");

  async function loadCheckoutAddresses() {
    if (!addressSelect) return;

    addressSelect.replaceChildren();

    const initialOption = document.createElement("option");
    initialOption.value = "";
    initialOption.textContent = "Loading saved addresses...";
    addressSelect.appendChild(initialOption);

    try {
      const response = await fetch("/api/customer/addresses", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });

      const data = await response.json();

      addressSelect.replaceChildren();

      if (!response.ok || !data.success) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Sign in to load your saved addresses";
        addressSelect.appendChild(option);
        return;
      }

      if (!Array.isArray(data.addresses) || data.addresses.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Add a delivery address in My Account first";
        addressSelect.appendChild(option);
        return;
      }

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a delivery address";
      addressSelect.appendChild(placeholder);

      data.addresses.forEach(address => {
        const option = document.createElement("option");
        option.value = String(address.id);

        option.textContent = [
          address.address_label,
          address.area,
          address.city,
          address.province
        ].filter(Boolean).join(" - ");

        addressSelect.appendChild(option);
      });

      const defaultAddress = data.addresses.find(
        address => address.is_default === 1 || address.is_default === true
      );

      if (defaultAddress) {
        addressSelect.value = String(defaultAddress.id);
      }
    } catch {
      addressSelect.replaceChildren();

      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Could not load addresses. Please try again.";
      addressSelect.appendChild(option);
    }
  }

  if (addressSelect) {
    loadCheckoutAddresses();
  }

  if (placeOrderButton) {
    placeOrderButton.addEventListener("click", async () => {
      if (cart.length === 0) {
        cartStatus.textContent = "Add products to your cart first.";
        return;
      }

      if (!addressSelect || !addressSelect.value) {
        cartStatus.textContent =
          "Please select a saved delivery address.";
        return;
      }

      const addressId = Number(addressSelect.value);

      if (!Number.isSafeInteger(addressId) || addressId < 1) {
        cartStatus.textContent = "Please select a valid address.";
        return;
      }

      if (cart.length > 50) {
        cartStatus.textContent =
          "Your order can contain no more than 50 different items.";
        return;
      }

      const orderItems = cart.map(item => ({
        type: item.type || "product",
        id: item.id,
        quantity: item.quantity
      }));

      placeOrderButton.disabled = true;
      cartStatus.textContent = "Submitting your order...";

      try {
        const response = await fetch("/api/customer/orders", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            address_id: addressId,
            items: orderItems,
            customer_notes: orderNotes ? orderNotes.value.trim() : ""
          })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          cartStatus.textContent =
            data.error || "Your order could not be submitted.";
          return;
        }

        cart = [];
        saveCart();
        renderCart();

        if (orderNotes) {
          orderNotes.value = "";
        }

        cartStatus.textContent =
          "Order submitted successfully! Order number: " +
          data.order.order_number +
          ". Total: " +
          formatMoney(data.order.total_ngwee) +
          ". Status: " +
          data.order.status +
          ".";

        await loadCheckoutAddresses();
      } catch {
        cartStatus.textContent =
          "We could not confirm the order response. Check My Orders before trying again.";
      } finally {
        placeOrderButton.disabled = false;
      }
    });
  }

  window.scbsAddProductToCart = function (product) {
    const id = Number(product?.id);
    const price = Number(product?.price_ngwee);
    const stock = Number(product?.stock_quantity);

    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !Number.isSafeInteger(price) ||
      price < 0 ||
      !Number.isSafeInteger(stock) ||
      stock < 1
    ) {
      cartStatus.textContent =
        "This product cannot be added to the cart.";
      return;
    }

    const existing = cart.find(item => item.id === id);

    if (existing) {
      if (existing.quantity >= Math.min(stock, 100)) {
        cartStatus.textContent =
          "You cannot add more than the available stock.";
        return;
      }

      existing.quantity += 1;
    } else {
      cart.push({
        type: "product",
        id,
        name: String(product.name || "Product"),
        price_ngwee: price,
        quantity: 1
      });
    }

    saveCart();
    renderCart();

    cartStatus.textContent =
      String(product.name || "Product") + " added to your cart.";
  };

  renderCart();
  console.info("SCBS shopping cart initialized successfully.");
})();

// SCBS CART NAVIGATION: open Products, then bring the cart into view.
document.getElementById("scbs-cart-nav")?.addEventListener("click", () => {
  if (typeof window.showSection === "function") {
    window.showSection("products");
  }
  window.setTimeout(() => {
    const cartSection = document.getElementById("scbs-shopping-cart");
    if (cartSection) {
      cartSection.scrollIntoView({ behavior: "smooth", block: "start" });
      cartSection.setAttribute("tabindex", "-1");
      cartSection.focus({ preventScroll: true });
    } else {
      console.error("SCBS cart navigation: #scbs-shopping-cart was not found.");
    }
  }, 100);
});// ============================================
// SCBS CUSTOMER PAYMENT FORM
// ============================================
(() => {
  "use strict";

  const form = document.getElementById("customer-payment-request-form");
  const orderSelect = document.getElementById("customer-payment-order");
  const submitButton = document.getElementById("customer-payment-submit");
  const status = document.getElementById("customer-payment-request-status");

  if (!form || !orderSelect || !submitButton || !status) return;

  let loadedOrders = [];
  let loadingOrders = false;

  async function loadPaymentOrders() {
    if (loadingOrders) return;

    loadingOrders = true;
    orderSelect.disabled = true;
    orderSelect.replaceChildren(new Option("Loading your orders...", ""));

    try {
      const response = await fetch("/api/customer/orders", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || "Unable to load your orders.");
      }

      loadedOrders = Array.isArray(result.orders) ? result.orders : [];
      orderSelect.replaceChildren();

      const placeholder = new Option("Choose an order", "");
      orderSelect.appendChild(placeholder);

      const payableOrders = loadedOrders.filter(order => {
        const total = Number(order.total_ngwee);

        return (
          Number.isSafeInteger(Number(order.id)) &&
          Number(order.id) > 0 &&
          Number.isFinite(total) &&
          total > 0 &&
          String(order.status || "").toLowerCase() !== "cancelled"
        );
      });

      if (payableOrders.length === 0) {
        orderSelect.replaceChildren(
          new Option("No payable orders found", "")
        );
        status.textContent =
          "No payable orders were found. Check My Orders or contact SCBS support.";
        return;
      }

      for (const order of payableOrders) {
        const amount = (Number(order.total_ngwee) / 100).toFixed(2);
        const currency = order.currency || "ZMW";
        const number = order.order_number || `Order #${order.id}`;

        const option = new Option(
          `${number} - ${currency} ${amount} (${order.status || "Pending"})`,
          String(order.id)
        );

        orderSelect.appendChild(option);
      }

      status.textContent = `Loaded ${payableOrders.length} order(s) for payment requests.`;
    } catch (error) {
      orderSelect.replaceChildren(
        new Option("Could not load orders - retry", "")
      );
      status.textContent = error.message || "Unable to load your orders.";
    } finally {
      loadingOrders = false;
      orderSelect.disabled = false;
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const orderId = Number(orderSelect.value);
    const selectedOrder = loadedOrders.find(
      order => Number(order.id) === orderId
    );
    const provider = form.querySelector(
      'input[name="customer-payment-provider-choice"]:checked'
    )?.value;

    if (!selectedOrder || !provider) {
      status.textContent = "Choose a valid order and payment provider.";
      return;
    }

    if (!["mtn_momo", "airtel_money"].includes(provider)) {
      status.textContent = "Choose MTN MoMo or Airtel Money.";
      return;
    }

    const key = (
      "scbs_" +
      (globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}_${Math.random().toString(36).slice(2)}`)
    ).replace(/[^A-Za-z0-9_-]/g, "_");

    submitButton.disabled = true;
    status.textContent = "Creating your test payment request...";

    try {
      const response = await fetch(
        `/api/customer/orders/${encodeURIComponent(orderId)}/payments`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            provider,
            idempotency_key: key
          })
        }
      );

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || "Unable to create the payment request.");
      }

      const payment = result.payment || {};
      status.textContent =
        `${result.message || "Test payment request saved."} ` +
        `Reference: ${payment.id ? `Payment #${payment.id}` : "record saved"}.`;

      if (typeof loadCustomerPayments === "function") {
        await loadCustomerPayments();
      }
    } catch (error) {
      status.textContent =
        error.message || "Unable to create the payment request.";
    } finally {
      submitButton.disabled = false;
    }
  });

  orderSelect.addEventListener("focus", () => {
    if (loadedOrders.length === 0) loadPaymentOrders();
  });

  // Load orders when the payment form is initialized.
  loadPaymentOrders();

  console.info("SCBS customer payment form initialized.");
})();

// SCBS password recovery interface
(() => {
  "use strict";

  const forgotLink = document.getElementById("scbs-forgot-password");
  const recoverySection = document.getElementById("scbs-password-recovery");
  const recoveryForm = document.getElementById("scbs-recovery-request-form");
  const backButton = document.getElementById("scbs-recovery-back");
  const recoveryMessage = document.getElementById("scbs-recovery-message");

  if (!forgotLink || !recoverySection || !recoveryForm || !backButton) {
    console.warn("SCBS recovery interface elements were not found.");
    return;
  }

  forgotLink.addEventListener("click", (event) => {
    event.preventDefault();
    recoverySection.hidden = false;
    recoverySection.scrollIntoView({ behavior: "smooth", block: "center" });

    const emailInput = document.getElementById("scbs-recovery-email");
    if (emailInput) emailInput.focus();
  });

  backButton.addEventListener("click", () => {
    recoverySection.hidden = true;
    recoveryForm.reset();

    if (recoveryMessage) recoveryMessage.textContent = "";

    forgotLink.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  recoveryForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (recoveryMessage) {
      recoveryMessage.textContent =
        "Password recovery is not connected yet. Please try again after SCBS email verification has been configured.";
    }
  });

  console.info("SCBS password recovery interface initialized.");
})();

// ============================================
// SCBS PUBLIC SEARCH - PRODUCTS AND SERVICES
// ============================================
(() => {
  "use strict";

  const form = document.getElementById("scbs-public-search-form");
  const input = document.getElementById("scbs-public-search-input");
  const clearButton = document.getElementById("scbs-public-search-clear");
  const status = document.getElementById("scbs-public-search-status");
  const results = document.getElementById("scbs-public-search-results");

  if (!form || !input || !clearButton || !status || !results) {
    console.warn("SCBS public search elements were not found.");
    return;
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function makeWhatsAppButton(message) {
    const button = makeElement("button", "primary", "Enquire on WhatsApp");
    button.type = "button";

    button.addEventListener("click", () => {
      const url = "https://wa.me/260967575366?text=" +
        encodeURIComponent(message);

      window.open(url, "_blank", "noopener,noreferrer");
    });

    return button;
  }

  let searchableItems = [];

  async function loadSearchData() {
    status.textContent = "Loading available products and services...";

    const responses = await Promise.all([
      fetch("/api/products", { credentials: "same-origin" }),
      fetch("/api/services", { credentials: "same-origin" }),
      fetch("/api/books", { credentials: "same-origin" })
    ]);

    const [productResponse, serviceResponse, bookResponse] = responses;

    const [productData, serviceData, bookData] = await Promise.all(
      responses.map(async response => {
        if (!response.ok) {
          throw new Error("Some SCBS listings could not be loaded.");
        }
        return response.json();
      })
    );

    if (productData.success !== true || serviceData.success !== true) {
      throw new Error("SCBS could not load its product or service listings.");
    }

    searchableItems = [];

    (productData.products || []).forEach(product => {
      searchableItems.push({
        type: "Product",
        name: product.name || "Unnamed product",
        description: product.description || "",
        category: product.product_type || "General",
        price: Number.isFinite(Number(product.price_ngwee))
          ? "Price: K" + (Number(product.price_ngwee) / 100).toFixed(2)
          : "Contact SCBS for price",
        available: Number(product.stock_quantity) > 0,
        detail: product
      });
    });

    (serviceData.services || []).forEach(service => {
      let price = "Price available on request";

      if (service.price_ngwee !== null &&
          service.price_ngwee !== undefined) {
        price = (service.pricing_type === "from" ? "Starting from " : "Price: ") +
          "K" + (Number(service.price_ngwee) / 100).toFixed(2);
      } else if (service.pricing_type === "quote") {
        price = "Request a quotation";
      }

      searchableItems.push({
        type: "Service",
        name: service.name || "Unnamed service",
        description: service.description || "",
        category: service.category || "Multi-Tech",
        price,
        available: true,
        detail: service
      });
    });

    // Books are included when the public books API returns published books.
    if (bookData.success === true) {
      (bookData.books || []).forEach(book => {
        searchableItems.push({
          type: "Book",
          name: book.title || book.name || "SCBS Book",
          description: book.description || "",
          category: book.category || "SCBS Books",
          price: book.price_ngwee !== null &&
                 book.price_ngwee !== undefined
            ? "Price: K" + (Number(book.price_ngwee) / 100).toFixed(2)
            : "Contact SCBS for price",
          available: true,
          detail: book
        });
      });
    }

    status.textContent =
      "Search ready. " + searchableItems.length + " listing(s) loaded.";
  }

  function renderResults(query) {
    results.replaceChildren();

    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      status.textContent = "Enter a product, service, phone, accessory or book to search.";
      return;
    }

    const matches = searchableItems.filter(item => {
      const searchableText = [
        item.type,
        item.name,
        item.description,
        item.category
      ].join(" ").toLowerCase();

      return searchableText.includes(normalizedQuery);
    });

    if (matches.length === 0) {
      status.textContent = "No matching listings found. Try another search term.";
      return;
    }

    matches.forEach(item => {
      const card = makeElement("article", "card");
      card.append(
        makeElement("p", "eyebrow", item.type),
        makeElement("h3", "", item.name),
        makeElement("p", "muted", "Category: " + item.category),
        makeElement(
          "p",
          "",
          item.description || "Contact SCBS for more information."
        ),
        makeElement("p", "", item.price)
      );

      if (item.type === "Product" && !item.available) {
        card.appendChild(makeElement("p", "muted", "Currently out of stock"));
      } else {
        card.appendChild(
          makeWhatsAppButton(
            "Hello SCBS, I would like to enquire about " +
            item.type.toLowerCase() + ": " + item.name + "."
          )
        );
      }

      results.appendChild(card);
    });

    status.textContent =
      "Found " + matches.length + " matching listing(s).";
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    renderResults(input.value);
  });

  input.addEventListener("input", () => {
    if (!input.value.trim()) {
      results.replaceChildren();
      status.textContent =
        "Enter a product, service, phone, accessory or book to search.";
    }
  });

  clearButton.addEventListener("click", () => {
    input.value = "";
    results.replaceChildren();
    status.textContent = "Search cleared.";
    input.focus();
  });

  loadSearchData().catch(error => {
    console.error("SCBS public search:", error);
    status.textContent =
      "Search listings could not be loaded. Please refresh and try again.";
  });

  console.info("SCBS public search initialized.");
})();

// ======================================================
// SCBS RENTAL MANAGEMENT - OWNER DASHBOARD
// ======================================================

(() => {
  const rentalForm = document.getElementById('scbs-rental-form');
  const rentalInventory = document.getElementById('scbs-rental-inventory');
  const rentalStatus = document.getElementById('scbs-rental-status');
  const loadRentalsButton = document.getElementById('scbs-load-rentals');
  const rentalSaveButton = document.getElementById('scbs-rental-save');
  const rentalCancelEditButton = document.getElementById('scbs-rental-cancel-edit');
  const rentalFormTitle = document.getElementById('scbs-rental-form-title');
  let editingRentalId = null;

  const bookingList = document.getElementById('scbs-rental-bookings');
  const bookingStatus = document.getElementById('scbs-rental-booking-status');
  const loadBookingsButton = document.getElementById('scbs-load-rental-bookings');

  if (
    !rentalForm ||
    !rentalInventory ||
    !rentalStatus ||
    !loadRentalsButton ||
    !bookingList ||
    !bookingStatus ||
    !loadBookingsButton
  ) {
    console.warn('SCBS Rental Management: dashboard elements not found.');
    return;
  }

  const field = id => document.getElementById(id);

  const formatPrice = value =>
    value === null || value === undefined
      ? 'Not set'
      : 'K' + (Number(value) / 100).toFixed(2);

  function showMessage(element, message, isError = false) {
    element.textContent = message;
    element.style.color = isError ? '#d9534f' : '';
  }

  async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.headers || {})
      }
    });

    const result = await response.json().catch(() => ({
      success: false,
      error: 'The server returned an unreadable response.'
    }));

    if (!response.ok || result.success !== true) {
      throw new Error(result.error || 'The request failed.');
    }

    return result;
  }

  function addCell(row, value) {
    const cell = document.createElement('td');
    cell.style.padding = '8px';
    cell.textContent = String(value ?? '');
    row.appendChild(cell);
    return cell;
  }

  async function loadRentals() {
    loadRentalsButton.disabled = true;
    showMessage(rentalStatus, 'Loading rental inventory...');

    try {
      const result = await apiRequest('/api/rentals');

      rentalInventory.replaceChildren();

      if (!result.rentals || result.rentals.length === 0) {
        const row = document.createElement('tr');
        const cell = addCell(row, 'No rental tools have been added yet.');
        cell.colSpan = 7;
        rentalInventory.appendChild(row);
      } else {
        result.rentals.forEach(item => {
          const row = document.createElement('tr');

          addCell(row, item.item_code);

          const toolCell = addCell(row, item.name);

          if (item.image_url) {
            const thumbnail = document.createElement('img');
            thumbnail.src = item.image_url;
            thumbnail.alt = item.name + ' picture';
            thumbnail.loading = 'lazy';
            thumbnail.className = 'rental-tool-thumbnail';
            thumbnail.addEventListener('error', () => thumbnail.remove(), {
              once: true
            });
            toolCell.prepend(thumbnail);
          }

          addCell(row, formatPrice(item.hourly_rate_ngwee));
          addCell(row, formatPrice(item.daily_rate_ngwee));
          addCell(row, item.available_quantity);
          addCell(row, item.condition_status);

          const actions = addCell(row, '');
          const editButton = document.createElement('button');
          editButton.type = 'button';
          editButton.className = 'ghost';
          editButton.textContent = 'Edit';
          editButton.addEventListener('click', () => beginRentalEdit(item));
          actions.appendChild(editButton);

          const deleteButton = document.createElement('button');
          deleteButton.type = 'button';
          deleteButton.className = 'ghost';
          deleteButton.textContent = 'Delete';
          deleteButton.style.marginLeft = '6px';
          deleteButton.addEventListener('click', () => deactivateRental(item, deleteButton));
          actions.appendChild(deleteButton);

          rentalInventory.appendChild(row);
        });
      }

      showMessage(
        rentalStatus,
        'Loaded ' + (result.rentals || []).length + ' rental tool(s).'
      );
    } catch (error) {
      showMessage(
        rentalStatus,
        error.message || 'Unable to load rental inventory.',
        true
      );
    } finally {
      loadRentalsButton.disabled = false;
    }
  }

  function beginRentalEdit(item) {
    editingRentalId = Number(item.id);
    field('scbs-rental-code').value = item.item_code || '';
    field('scbs-rental-name').value = item.name || '';
    field('scbs-rental-description').value = item.description || '';
    field('scbs-rental-hourly-rate').value =
      item.hourly_rate_ngwee == null ? '' : String(Number(item.hourly_rate_ngwee) / 100);
    field('scbs-rental-daily-rate').value =
      item.daily_rate_ngwee == null ? '' : String(Number(item.daily_rate_ngwee) / 100);
    field('scbs-rental-quantity').value = String(item.available_quantity ?? 0);
    field('scbs-rental-condition').value = item.condition_status || 'good';
    field('scbs-rental-image').value = '';
    if (rentalSaveButton) rentalSaveButton.textContent = 'Update Rental Tool';
    if (rentalFormTitle) rentalFormTitle.textContent = 'Edit Rental Tool';
    if (rentalCancelEditButton) rentalCancelEditButton.hidden = false;
    showMessage(rentalStatus, 'Editing ' + (item.name || 'rental tool') +
      '. Choose a picture only if you want to replace the current one.');
    rentalForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetRentalEdit() {
    editingRentalId = null;
    rentalForm.reset();
    field('scbs-rental-quantity').value = '1';
    field('scbs-rental-condition').value = 'good';
    if (rentalSaveButton) rentalSaveButton.textContent = 'Save Rental Tool';
    if (rentalFormTitle) rentalFormTitle.textContent = 'Add a Rental Tool';
    if (rentalCancelEditButton) rentalCancelEditButton.hidden = true;
  }

  if (rentalCancelEditButton) {
    rentalCancelEditButton.addEventListener('click', () => {
      resetRentalEdit();
      showMessage(rentalStatus, 'Edit cancelled. You can add a rental tool.');
    });
  }

  async function deactivateRental(item, button) {
    if (!window.confirm(
      'Remove "' + item.name + '" from public rental listings? Booking history will be preserved.'
    )) return;

    button.disabled = true;
    showMessage(rentalStatus, 'Removing rental tool...');
    try {
      const result = await apiRequest(
        '/api/admin/rentals/' + encodeURIComponent(item.id),
        { method: 'DELETE' }
      );
      if (editingRentalId === Number(item.id)) resetRentalEdit();
      showMessage(rentalStatus, result.message || 'Rental tool deactivated.');
      await loadRentals();
    } catch (error) {
      showMessage(rentalStatus, error.message || 'Unable to remove rental tool.', true);
    } finally {
      button.disabled = false;
    }
  }
  rentalForm.addEventListener('submit', async event => {
    event.preventDefault();

    if (!rentalForm.reportValidity()) return;

    const hourlyText = field('scbs-rental-hourly-rate').value.trim();
    const dailyText = field('scbs-rental-daily-rate').value.trim();

    const hourlyZMW = hourlyText === '' ? null : Number(hourlyText);
    const dailyZMW = Number(dailyText);
    const quantity = Number(field('scbs-rental-quantity').value);
    const imageInput = field('scbs-rental-image');
    const imageFile = imageInput?.files?.[0] || null;
    const allowedImageTypes = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (
      (hourlyZMW !== null &&
        (!Number.isFinite(hourlyZMW) || hourlyZMW < 0)) ||
      !Number.isFinite(dailyZMW) ||
      dailyZMW < 0 ||
      !Number.isSafeInteger(quantity) ||
      quantity < 0
    ) {
      showMessage(
        rentalStatus,
        'Check the rental prices and quantity, then try again.',
        true
      );
      return;
    }

    if (imageFile && !allowedImageTypes.includes(imageFile.type)) {
      showMessage(
        rentalStatus,
        'Choose a JPEG, PNG, or WebP picture.',
        true
      );
      return;
    }

    if (imageFile && imageFile.size > 2 * 1024 * 1024) {
      showMessage(
        rentalStatus,
        'The rental picture must not exceed 2 MB.',
        true
      );
      return;
    }

    const saveButton = rentalForm.querySelector('button[type="submit"]');
    saveButton.disabled = true;
    showMessage(rentalStatus, 'Saving rental tool...');

    let rentalSaved = false;

    try {
      const payload = {
        item_code: field('scbs-rental-code').value.trim(),
        name: field('scbs-rental-name').value.trim(),
        description: field('scbs-rental-description').value.trim(),
        hourly_rate_ngwee:
          hourlyZMW === null ? null : Math.round(hourlyZMW * 100),
        daily_rate_ngwee: Math.round(dailyZMW * 100),
        available_quantity: quantity,
        condition_status: field('scbs-rental-condition').value
      };

      const requestId = editingRentalId;
      const result = await apiRequest(
        requestId === null
          ? '/api/admin/rentals'
          : '/api/admin/rentals/' + encodeURIComponent(requestId),
        {
          method: requestId === null ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      const savedRentalId = requestId === null ? result.rental_id : requestId;

      rentalSaved = true;
      let statusMessage = result.message || 'Rental tool saved successfully.';
      let uploadFailed = false;

      if (imageFile) {
        if (!Number.isSafeInteger(savedRentalId) || result.rental_id < 1) {
          uploadFailed = true;
          statusMessage = 'The rental tool was saved, but its picture could not be linked. Reload the inventory before retrying.';
        } else {
          try {
            showMessage(rentalStatus, 'Rental saved. Uploading picture...');

            const formData = new FormData();
            formData.append('image', imageFile);

            const uploadResult = await apiRequest(
              '/api/admin/rentals/' +
                encodeURIComponent(savedRentalId) +
                '/image',
              {
                method: 'POST',
                body: formData
              }
            );

            statusMessage =
              uploadResult.message || 'Rental tool and picture saved successfully.';
          } catch (uploadError) {
            uploadFailed = true;
            statusMessage =
              'Rental tool was saved, but the picture upload failed: ' +
              (uploadError.message || 'Unknown upload error.') +
              ' Do not submit the form again; reload the inventory before retrying.';
          }
        }
      }

      resetRentalEdit();

      showMessage(rentalStatus, statusMessage, uploadFailed);
      await loadRentals();
    } catch (error) {
      showMessage(
        rentalStatus,
        (rentalSaved
          ? 'Rental tool was saved, but a follow-up action failed: '
          : 'Unable to save the rental tool: ') +
          (error.message || 'Please try again.'),
        true
      );

      if (rentalSaved) {
        await loadRentals();
      }
    } finally {
      saveButton.disabled = false;
    }
  });

  async function updateBookingStatus(id, status, button) {
    const actionLabels = {
      approved: 'approve this booking',
      cancelled: 'cancel this booking',
      active: 'mark this rental as collected',
      returned: 'mark this rental as returned',
      overdue: 'mark this rental as overdue'
    };

    if (!window.confirm('Are you sure you want to ' + actionLabels[status] + '?')) {
      return;
    }

    button.disabled = true;
    showMessage(bookingStatus, 'Updating booking...');

    try {
      const result = await apiRequest(
        '/api/admin/rentals/bookings/' + encodeURIComponent(id) + '/status',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status })
        }
      );

      showMessage(
        bookingStatus,
        result.message || 'Booking status updated.'
      );

      await loadBookings();
    } catch (error) {
      showMessage(
        bookingStatus,
        error.message || 'Unable to update the booking.',
        true
      );
    } finally {
      button.disabled = false;
    }
  }

  function createBookingAction(row, booking, status, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost';
    button.textContent = label;
    button.style.margin = '3px';

    button.addEventListener('click', () => {
      updateBookingStatus(booking.id, status, button);
    });

    row.appendChild(button);
  }

  async function loadBookings() {
    loadBookingsButton.disabled = true;
    showMessage(bookingStatus, 'Loading customer bookings...');

    try {
      const result = await apiRequest('/api/admin/rentals/bookings');

      bookingList.replaceChildren();

      if (!result.bookings || result.bookings.length === 0) {
        const row = document.createElement('tr');
        const cell = addCell(row, 'No customer rental bookings yet.');
        cell.colSpan = 10;
        bookingList.appendChild(row);
      } else {
        result.bookings.forEach(booking => {
          const row = document.createElement('tr');

          addCell(row, booking.booking_number);
          addCell(row, booking.customer_name);
          addCell(row, booking.rental_name);
          addCell(row, booking.rental_period);
          addCell(row, booking.start_date);
          addCell(row, booking.due_date);
          addCell(row, booking.quantity);
          addCell(row, formatPrice(booking.total_ngwee));
          addCell(row, booking.status);

          const actions = document.createElement('td');
          actions.style.padding = '8px';

          if (booking.status === 'requested') {
            createBookingAction(row, booking, 'approved', 'Approve');
            createBookingAction(row, booking, 'cancelled', 'Cancel');
          } else if (booking.status === 'approved') {
            createBookingAction(row, booking, 'active', 'Mark Collected');
            createBookingAction(row, booking, 'cancelled', 'Cancel');
          } else if (
            booking.status === 'active' ||
            booking.status === 'overdue'
          ) {
            createBookingAction(row, booking, 'returned', 'Mark Returned');

            if (booking.status === 'active') {
              createBookingAction(row, booking, 'overdue', 'Mark Overdue');
            }
          } else {
            actions.textContent = 'No actions';
          }

          row.appendChild(actions);
          bookingList.appendChild(row);
        });
      }

      showMessage(
        bookingStatus,
        'Loaded ' + (result.bookings || []).length + ' booking(s).'
      );
    } catch (error) {
      showMessage(
        bookingStatus,
        error.message || 'Unable to load customer bookings.',
        true
      );
    } finally {
      loadBookingsButton.disabled = false;
    }
  }

  loadRentalsButton.addEventListener('click', loadRentals);
  loadBookingsButton.addEventListener('click', loadBookings);

  console.log('SCBS Rental Management initialized.');
})();

// ======================================================
// SCBS CUSTOMER RENTAL BROWSING AND BOOKINGS
// ======================================================

(() => {
  const toolList = document.getElementById('customer-rentals-list');
  const toolStatus = document.getElementById('customer-rentals-status');
  const loadToolsButton = document.getElementById('customer-load-rentals');

  const bookingList = document.getElementById('customer-rental-bookings');
  const bookingStatus = document.getElementById('customer-rental-bookings-status');
  const loadBookingsButton = document.getElementById('customer-load-rental-bookings');

  if (
    !toolList ||
    !toolStatus ||
    !loadToolsButton ||
    !bookingList ||
    !bookingStatus ||
    !loadBookingsButton
  ) {
    console.warn('SCBS Customer Rentals: required elements are missing.');
    return;
  }

  const formatPrice = value =>
    'K' + (Number(value) / 100).toFixed(2);

  function showStatus(element, message, error = false) {
    element.textContent = message;
    element.style.color = error ? '#d9534f' : '';
  }

  async function requestJSON(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.headers || {})
      }
    });

    const result = await response.json().catch(() => ({
      success: false,
      error: 'The server returned an unreadable response.'
    }));

    if (!response.ok || result.success !== true) {
      throw new Error(result.error || 'The request could not be completed.');
    }

    return result;
  }

  function addTextElement(parent, tag, text, className = '') {
    const element = document.createElement(tag);
    element.textContent = text;

    if (className) {
      element.className = className;
    }

    parent.appendChild(element);
    return element;
  }

  async function loadCustomerRentals() {
    loadToolsButton.disabled = true;
    showStatus(toolStatus, 'Loading available rental tools...');

    try {
      const result = await requestJSON('/api/rentals');
      toolList.replaceChildren();

      const rentals = Array.isArray(result.rentals)
        ? result.rentals
        : [];

      if (rentals.length === 0) {
        addTextElement(
          toolList,
          'p',
          'No rental tools are available yet. Please check again later.',
          'muted'
        );

        showStatus(toolStatus, 'No rental tools are currently listed.');
        return;
      }

      rentals.forEach(tool => {
        const card = document.createElement('article');
        card.className = 'card';

        if (tool.image_url) {
          const image = document.createElement('img');
          image.src = tool.image_url;
          image.alt = tool.name + ' picture';
          image.loading = 'lazy';
          image.className = 'rental-tool-image';
          image.addEventListener('error', () => image.remove(), { once: true });
          card.appendChild(image);
        }

        addTextElement(card, 'h3', tool.name);
        addTextElement(card, 'p', 'Item code: ' + tool.item_code);
        addTextElement(
          card,
          'p',
          tool.description || 'Contact SCBS for more information.'
        );
        addTextElement(
          card,
          'p',
          'Condition: ' + tool.condition_status
        );
        addTextElement(
          card,
          'p',
          'Available quantity: ' + tool.available_quantity
        );
        addTextElement(
          card,
          'p',
          'Hourly rate: ' +
            (tool.hourly_rate_ngwee === null
              ? 'Not configured'
              : formatPrice(tool.hourly_rate_ngwee))
        );
        addTextElement(
          card,
          'p',
          'Daily rate: ' + formatPrice(tool.daily_rate_ngwee)
        );

        const form = document.createElement('form');
        form.className = 'customer-rental-booking-form';

        addTextElement(form, 'h4', 'Request this rental');

        const quantityLabel = addTextElement(form, 'label', 'Quantity');
        const quantityInput = document.createElement('input');
        quantityInput.type = 'number';
        quantityInput.min = '1';
        quantityInput.max = String(tool.available_quantity);
        quantityInput.step = '1';
        quantityInput.value = '1';
        quantityInput.required = true;
        quantityLabel.htmlFor = 'rental-quantity-' + tool.id;
        quantityInput.id = quantityLabel.htmlFor;
        form.appendChild(quantityInput);

        const periodLabel = addTextElement(form, 'label', 'Rental period');
        const periodSelect = document.createElement('select');
        periodSelect.required = true;
        periodLabel.htmlFor = 'rental-period-' + tool.id;
        periodSelect.id = periodLabel.htmlFor;

        const dailyOption = document.createElement('option');
        dailyOption.value = 'day';
        dailyOption.textContent = 'Daily';
        periodSelect.appendChild(dailyOption);

        if (tool.hourly_rate_ngwee !== null) {
          const hourlyOption = document.createElement('option');
          hourlyOption.value = 'hour';
          hourlyOption.textContent = 'Hourly';
          periodSelect.appendChild(hourlyOption);
        }

        form.appendChild(periodSelect);

        const startLabel = addTextElement(form, 'label', 'Start date and time');
        const startInput = document.createElement('input');
        startInput.type = 'datetime-local';
        startInput.required = true;
        startLabel.htmlFor = 'rental-start-' + tool.id;
        startInput.id = startLabel.htmlFor;
        form.appendChild(startInput);

        const endLabel = addTextElement(form, 'label', 'End date and time');
        const endInput = document.createElement('input');
        endInput.type = 'datetime-local';
        endInput.required = true;
        endLabel.htmlFor = 'rental-end-' + tool.id;
        endInput.id = endLabel.htmlFor;
        form.appendChild(endInput);

        function configureDateInputs() {
          const isHourly = periodSelect.value === 'hour';

          startInput.type = isHourly ? 'datetime-local' : 'date';
          endInput.type = isHourly ? 'datetime-local' : 'date';

          startInput.value = '';
          endInput.value = '';

          if (isHourly) {
            addTextElement(
              form,
              'p',
              'Choose the exact start and end times.',
              'muted'
            );
          }
        }

        periodSelect.addEventListener('change', configureDateInputs);

        const notesLabel = addTextElement(form, 'label', 'Notes (optional)');
        const notesInput = document.createElement('textarea');
        notesInput.maxLength = 1000;
        notesLabel.htmlFor = 'rental-notes-' + tool.id;
        notesInput.id = notesLabel.htmlFor;
        form.appendChild(notesInput);

        const submitButton = document.createElement('button');
        submitButton.type = 'submit';
        submitButton.className = 'primary';
        submitButton.textContent = 'Submit Rental Request';
        form.appendChild(submitButton);

        const formStatus = addTextElement(form, 'p', '', 'muted');
        formStatus.setAttribute('role', 'status');

        form.addEventListener('submit', async event => {
          event.preventDefault();

          if (!form.reportValidity()) return;

          const quantity = Number(quantityInput.value);
          const period = periodSelect.value;
          const startDate = startInput.value;
          const dueDate = endInput.value;

          if (
            !Number.isSafeInteger(quantity) ||
            quantity < 1 ||
            quantity > Number(tool.available_quantity)
          ) {
            showStatus(
              formStatus,
              'Enter a valid quantity within the listed stock.',
              true
            );
            return;
          }

          if (!startDate || !dueDate || dueDate <= startDate) {
            showStatus(
              formStatus,
              'Choose a valid start and end, with the end after the start.',
              true
            );
            return;
          }

          submitButton.disabled = true;
          showStatus(formStatus, 'Submitting your rental request...');

          try {
            const booking = await requestJSON(
              '/api/customer/rentals/bookings',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  rental_item_id: Number(tool.id),
                  quantity,
                  rental_period: period,
                  start_date: startDate,
                  due_date: dueDate,
                  notes: notesInput.value.trim()
                })
              }
            );

            showStatus(
              formStatus,
              booking.message || 'Your request was submitted.'
            );

            await loadCustomerRentalBookings();
          } catch (error) {
            showStatus(
              formStatus,
              error.message || 'Unable to submit your rental request.',
              true
            );
          } finally {
            submitButton.disabled = false;
          }
        });

        card.appendChild(form);
        toolList.appendChild(card);
      });

      showStatus(toolStatus, 'Loaded ' + rentals.length + ' rental tool(s).');
    } catch (error) {
      showStatus(
        toolStatus,
        error.message || 'Unable to load rental tools.',
        true
      );
    } finally {
      loadToolsButton.disabled = false;
    }
  }

  async function loadCustomerRentalBookings() {
    loadBookingsButton.disabled = true;
    showStatus(bookingStatus, 'Loading your rental requests...');

    try {
      const result = await requestJSON('/api/customer/rentals/bookings');
      bookingList.replaceChildren();

      const bookings = Array.isArray(result.bookings)
        ? result.bookings
        : [];

      if (bookings.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 8;
        cell.textContent = 'You have not submitted any rental requests.';
        row.appendChild(cell);
        bookingList.appendChild(row);
      } else {
        bookings.forEach(booking => {
          const row = document.createElement('tr');

          [
            booking.booking_number,
            booking.rental_name,
            booking.rental_period,
            booking.start_date,
            booking.due_date,
            booking.quantity,
            formatPrice(booking.total_ngwee),
            booking.status
          ].forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = String(value ?? '');
            row.appendChild(cell);
          });

          bookingList.appendChild(row);
        });
      }

      showStatus(
        bookingStatus,
        'Loaded ' + bookings.length + ' rental request(s).'
      );
    } catch (error) {
      showStatus(
        bookingStatus,
        error.message || 'Unable to load your rental requests.',
        true
      );
    } finally {
      loadBookingsButton.disabled = false;
    }
  }

  loadToolsButton.addEventListener('click', loadCustomerRentals);
  loadBookingsButton.addEventListener('click', loadCustomerRentalBookings);

  // Expose functions for the existing customer dashboard tab handler.
  window.loadCustomerRentals = loadCustomerRentals;
  window.loadCustomerRentalBookings = loadCustomerRentalBookings;

  console.log('SCBS Customer Rentals initialized.');
})();

// SCBS PUBLIC TOOL RENTALS
(() => {
  const rentalSection = document.getElementById('rentals');

  if (!rentalSection) {
    console.warn('SCBS: GSM Tools & Software section not found.');
    return;
  }

  // Create the public tools display inside the GSM section.
  let rentalHeading = document.getElementById('public-rentals-heading');
  let rentalStatus = document.getElementById('public-rental-status');
  let rentalList = document.getElementById('public-rental-list');

  if (!rentalHeading) {
    rentalHeading = document.createElement('div');
    rentalHeading.id = 'public-rentals-heading';
    rentalHeading.className = 'section-head';

    const heading = document.createElement('h2');
    heading.textContent = 'Available GSM Tools & Software';

    const description = document.createElement('p');
    description.className = 'muted';
    description.textContent =
      'View available tools, prices and quantities. Contact SCBS for assistance.';

    rentalHeading.append(heading, description);
  }

  if (!rentalStatus) {
    rentalStatus = document.createElement('p');
    rentalStatus.id = 'public-rental-status';
    rentalStatus.className = 'muted';
    rentalStatus.setAttribute('role', 'status');
    rentalStatus.textContent = 'Loading available tools...';
  }

  if (!rentalList) {
    rentalList = document.createElement('div');
    rentalList.id = 'public-rental-list';
    rentalList.className = 'grid';
  }

  rentalSection.append(rentalHeading, rentalStatus, rentalList);

  function rentalText(parent, tag, text, className = '') {
    const element = document.createElement(tag);
    element.textContent = String(text ?? '');

    if (className) element.className = className;

    parent.appendChild(element);
    return element;
  }

  function rentalMoney(ngwee) {
    return 'K' + (Number(ngwee || 0) / 100).toFixed(2);
  }

  async function loadPublicRentals() {
    rentalStatus.textContent = 'Loading available GSM tools...';
    rentalList.replaceChildren();

    try {
      const response = await fetch('/api/rentals', {
        credentials: 'same-origin'
      });

      if (!response.ok) {
        throw new Error('Unable to retrieve available tools.');
      }

      const result = await response.json();
      const rentals = Array.isArray(result.rentals) ? result.rentals : [];

      if (!rentals.length) {
        rentalStatus.textContent = 'No tools are currently listed.';
        return;
      }

      rentalStatus.textContent = rentals.length +
        ' tool listing(s) available.';

      rentals.forEach(tool => {
        const card = document.createElement('article');
        card.className = 'card';

        if (tool.image_url) {
          const image = document.createElement('img');
          image.src = tool.image_url;
          image.alt = tool.name + ' picture';
          image.loading = 'lazy';
          image.className = 'rental-tool-image';
          image.addEventListener('error', () => image.remove(), { once: true });
          card.appendChild(image);
        }

        rentalText(card, 'h3', tool.name);
        rentalText(card, 'p', 'Code: ' + (tool.item_code || 'N/A'));
        rentalText(card, 'p', tool.description || 'Contact SCBS for details.');
        rentalText(card, 'p', 'Available quantity: ' +
          Number(tool.available_quantity ?? 0));
        rentalText(card, 'p', 'Hourly price: ' +
          rentalMoney(tool.hourly_rate_ngwee));
        rentalText(card, 'p', 'Daily price: ' +
          rentalMoney(tool.daily_rate_ngwee));

        rentalList.appendChild(card);
      });
    } catch (error) {
      console.error('SCBS rental listing error:', error);
      rentalStatus.textContent =
        'Could not load tools. Please refresh the page and try again.';
    }
  }

  window.loadPublicRentals = loadPublicRentals;
  loadPublicRentals();
})();
// SCBS: Show available GSM tools when the customer clicks View rental tools.
document.getElementById('open-public-rentals')
  ?.addEventListener('click', () => {
    const rentalSection = document.getElementById('rentals');
    const rentalHeading = document.getElementById('public-rentals-heading');
    const rentalList = document.getElementById('public-rental-list');

    if (rentalSection && typeof window.showSection === 'function') {
      window.showSection('rentals');
    }

    if (rentalHeading) {
      rentalHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (rentalList) {
      rentalList.hidden = false;
    }

    if (typeof window.loadPublicRentals === 'function') {
      window.loadPublicRentals();
    }
  });
// SCBS: Place public rental listings inside the independent Tool Rentals tab.
(() => {
  const rentalSection = document.getElementById('rentals');
  const rentalHeading = document.getElementById('public-rentals-heading');
  const rentalStatus = document.getElementById('public-rental-status');
  const rentalList = document.getElementById('public-rental-list');

  if (!rentalSection || !rentalHeading || !rentalStatus || !rentalList) {
    console.warn('SCBS: Public rental section could not be moved.');
    return;
  }

  rentalSection.append(rentalHeading, rentalStatus, rentalList);

  console.log('SCBS: Public rental listings moved to the Tool Rentals tab.');
})();

// SCBS Posts UI: uses textContent for user-provided text to avoid HTML injection.
(() => {
  const byId = (id) => document.getElementById(id);
  const statusText = (id, message) => {
    const node = byId(id);
    if (node) node.textContent = message;
  };
  const escapeDate = (value) => {
    if (!value) return 'Date not available';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date not available' : date.toLocaleString();
  };

  async function loadPublicPosts() {
    const container = byId('scbs-public-posts');
    if (!container) return;
    statusText('scbs-posts-status', 'Loading SCBS posts...');
    try {
      const response = await fetch('/api/posts', { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load posts.');
      container.replaceChildren();
      const bar = byId('scbs-announcement-bar');
      if (bar) {
        if (data.announcement) {
          bar.hidden = false;
          bar.textContent = `${data.announcement.title}: ${data.announcement.body}`;
        } else {
          bar.hidden = true;
          bar.textContent = '';
        }
      }
      for (const post of (data.posts || [])) {
        const card = document.createElement('article');
        card.className = 'scbs-post-card';
        if (post.image_url) {
          const image = document.createElement('img');
          image.src = post.image_url;
          image.alt = post.title;
          image.loading = 'lazy';
          image.referrerPolicy = 'no-referrer';
          image.addEventListener('error', () => image.remove(), { once: true });
          card.append(image);
        }
        const title = document.createElement('h3');
        title.textContent = post.title;
        const body = document.createElement('p');
        body.textContent = post.body;
        const date = document.createElement('p');
        date.className = 'scbs-post-date';
        date.textContent = `Published: ${escapeDate(post.published_at || post.created_at)}`;
        card.append(title, body, date);
        container.append(card);
      }
      statusText('scbs-posts-status', data.posts?.length ? `${data.posts.length} published post(s).` : 'No posts have been published yet.');
    } catch (error) {
      statusText('scbs-posts-status', error.message || 'Unable to load SCBS posts.');
    }
  }

  async function loadAdminPosts() {
    const container = byId('scbs-admin-post-list');
    if (!container) return;
    container.replaceChildren();
    statusText('scbs-post-admin-status', 'Loading posts...');
    try {
      const response = await fetch('/api/admin/posts', { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Administrator sign-in required.');
      if (!data.posts.length) {
        container.textContent = 'No posts created yet.';
      }
      for (const post of data.posts) {
        const row = document.createElement('div');
        row.className = 'scbs-admin-post-row';
        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = post.title;
        const meta = document.createElement('p');
        meta.className = 'muted';
        meta.textContent = `${post.status.toUpperCase()} Â· ${escapeDate(post.created_at)}${post.is_announcement ? ' Â· ANNOUNCEMENT' : ''}`;
        info.append(title, meta);
        const actions = document.createElement('div');
        if (post.status !== 'published') {
          const publish = document.createElement('button');
          publish.type = 'button';
          publish.textContent = 'Publish';
          publish.addEventListener('click', () => updatePostStatus(post.id, 'published'));
          actions.append(publish);
        }
        if (post.status !== 'paused') {
          const pause = document.createElement('button');
          pause.type = 'button';
          pause.textContent = 'Pause';
          pause.addEventListener('click', () => updatePostStatus(post.id, 'paused'));
          actions.append(pause);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Delete';
        remove.addEventListener('click', async () => {
          if (!window.confirm(`Delete the post "${post.title}"?`)) return;
          try {
            const result = await fetch(`/api/admin/posts/${post.id}`, {
              method: 'DELETE', credentials: 'same-origin'
            });
            const payload = await result.json();
            if (!result.ok || !payload.success) throw new Error(payload.error || 'Delete failed.');
            statusText('scbs-post-admin-status', 'Post deleted.');
            await loadAdminPosts();
            await loadPublicPosts();
          } catch (error) {
            statusText('scbs-post-admin-status', error.message || 'Delete failed.');
          }
        });
        actions.append(remove);
        row.append(info, actions);
        container.append(row);
      }
      statusText('scbs-post-admin-status', 'Post list updated.');
    } catch (error) {
      statusText('scbs-post-admin-status', error.message || 'Unable to load posts.');
    }
  }

  async function updatePostStatus(id, status) {
    try {
      const response = await fetch(`/api/admin/posts/${id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to update post.');
      statusText('scbs-post-admin-status', data.message || 'Post updated.');
      await loadAdminPosts();
      await loadPublicPosts();
    } catch (error) {
      statusText('scbs-post-admin-status', error.message || 'Unable to update post.');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadPublicPosts();
    byId('scbs-refresh-admin-posts')?.addEventListener('click', loadAdminPosts);
    byId('scbs-create-post-toggle')?.addEventListener('click', () => {
      const form = byId('scbs-create-post-form');
      if (form) {
        form.hidden = !form.hidden;
        if (!form.hidden) form.querySelector('input')?.focus();
      }
    });
    byId('scbs-create-post-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = {
        title: byId('scbs-post-title').value.trim(),
        body: byId('scbs-post-body').value.trim(),
        image_url: byId('scbs-post-image').value.trim(),
        is_announcement: byId('scbs-post-announcement').checked,
        status: byId('scbs-post-status').value
      };
      statusText('scbs-post-admin-status', 'Saving post...');
      try {
        const response = await fetch('/api/admin/posts', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Unable to save post.');
        statusText('scbs-post-admin-status', data.message || 'Post saved.');
        form.reset();
        form.hidden = true;
        await loadAdminPosts();
        await loadPublicPosts();
      } catch (error) {
        statusText('scbs-post-admin-status', error.message || 'Unable to save post.');
      }
    });
    // Load fresh public posts when the Posts tab is selected.
    document.querySelectorAll('nav a[href="#posts"]').forEach((link) => {
      link.addEventListener('click', () => loadPublicPosts());
    });
    // The administrator can manually refresh the private post list after signing in.
  });
})();


// ============================================
// SCBS ISSUE REPORTS - customer submission and private admin review
// ============================================
(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const setStatus = (text) => { const el = byId('scbs-issue-admin-status'); if (el) el.textContent = text; };
  const reportStatus = (text) => { const el = byId('scbs-report-status'); if (el) el.textContent = text; };
  const backdrop = byId('scbs-report-backdrop');
  byId('scbs-report-open')?.addEventListener('click', () => { if (backdrop) backdrop.hidden = false; byId('scbs-report-name')?.focus(); });
  byId('scbs-report-close')?.addEventListener('click', () => { if (backdrop) backdrop.hidden = true; });
  backdrop?.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.hidden = true; });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && backdrop) backdrop.hidden = true; });

  byId('scbs-report-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = byId('scbs-report-submit');
    const payload = {
      name: byId('scbs-report-name').value.trim(),
      contact: byId('scbs-report-contact').value.trim(),
      category: byId('scbs-report-category').value,
      description: byId('scbs-report-description').value.trim()
    };
    if (submit) submit.disabled = true;
    reportStatus('Submitting your report...');
    try {
      const response = await fetch('/api/issue-reports', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to submit report.');
      reportStatus(`${data.message} Reference: ${data.reference_code}`);
      byId('scbs-report-form').reset();
      if (typeof notify === 'function') notify('Report submitted', `Reference: ${data.reference_code}`, 'success');
    } catch (error) { reportStatus(error.message || 'Unable to submit report.'); }
    finally { if (submit) submit.disabled = false; }
  });

  async function loadIssueReports() {
    const container = byId('scbs-admin-issue-list');
    if (!container) return;
    setStatus('Loading private issue reports...');
    container.replaceChildren();
    try {
      const response = await fetch('/api/admin/issue-reports', { credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load reports.');
      if (!data.reports.length) { setStatus('No issue reports have been submitted.'); return; }
      for (const report of data.reports) {
        const row = document.createElement('article'); row.className = 'scbs-report-admin-row';
        const title = document.createElement('h3'); title.textContent = `${report.reference_code} - ${report.category}`;
        const detail = document.createElement('p'); detail.textContent = `${report.name} | ${report.contact}\nSubmitted: ${new Date(report.created_at).toLocaleString()}\n\n${report.description}`;
        const statusLabel = document.createElement('label'); statusLabel.textContent = 'Status';
        const select = document.createElement('select');
        for (const [value, label] of [['new','New'],['under_review','Under review'],['resolved','Resolved']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
        select.value = report.status;
        const notesLabel = document.createElement('label'); notesLabel.textContent = 'Private administrator notes';
        const notes = document.createElement('textarea'); notes.maxLength = 2000; notes.value = report.admin_notes || ''; notes.rows = 3;
        const save = document.createElement('button'); save.type = 'button'; save.className = 'primary'; save.textContent = 'Save review';
        save.addEventListener('click', async () => {
          save.disabled = true;
          try {
            const update = await fetch(`/api/admin/issue-reports/${report.id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: select.value, admin_notes: notes.value }) });
            const result = await update.json();
            if (!update.ok || !result.success) throw new Error(result.error || 'Unable to update report.');
            setStatus(result.message || 'Report updated.');
            await loadIssueReports();
          } catch (error) { setStatus(error.message || 'Unable to update report.'); }
          finally { save.disabled = false; }
        });
        row.append(title, detail, statusLabel, select, notesLabel, notes, save); container.append(row);
      }
      setStatus(`${data.reports.length} private issue report(s).`);
    } catch (error) { setStatus(error.message || 'Unable to load reports.'); }
  }
  byId('scbs-refresh-issue-reports')?.addEventListener('click', loadIssueReports);
})();


// ============================================
// SCBS OWNER DASHBOARD - DEDICATED PHONES & ACCESSORIES TAB
// Uses the existing protected product API and database.
// Multi-Tech Services management is intentionally unchanged.
// ============================================
(() => {
  const tabButton = document.getElementById('admin-tab-phones');
  const panel = document.getElementById('phone-management');
  const form = document.getElementById('phone-product-form');
  const list = document.getElementById('phone-product-list');
  const status = document.getElementById('phone-product-status');
  const refreshButton = document.getElementById('phone-load-products');
  const cancelButton = document.getElementById('phone-product-cancel');
  const saveButton = document.getElementById('phone-product-save');
  if (!tabButton || !panel || !form || !list || !status || !refreshButton || !cancelButton || !saveButton) {
    console.warn('SCBS phone management: one or more required elements are missing.');
    return;
  }

  const field = id => document.getElementById(id);
  const deviceTypes = new Set(['phone', 'accessory', 'electronics']);
  let editingId = null;

  const money = ngwee => 'K' + (Number(ngwee || 0) / 100).toFixed(2);
  async function requestJSON(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.headers || {}) }
    });
    const result = await response.json().catch(() => ({ success: false, error: 'The server returned an unreadable response.' }));
    if (!response.ok || result.success !== true) {
      throw new Error(result.error || 'The request failed. Confirm you are signed in as an owner or administrator.');
    }
    return result;
  }

  function resetForm() {
    editingId = null;
    form.reset();
    field('phone-product-stock').value = '0';
    saveButton.textContent = 'Save Device Listing';
    cancelButton.hidden = true;
    field('phone-product-form-heading').textContent = 'Add a Phone or Accessory';
    status.textContent = 'Ready to add a phone, accessory or electronic product.';
  }

  async function loadPhoneProducts() {
    refreshButton.disabled = true;
    status.textContent = 'Loading device listings...';
    try {
      const result = await requestJSON('/api/products');
      const devices = (Array.isArray(result.products) ? result.products : [])
        .filter(product => deviceTypes.has(String(product.product_type || '').toLowerCase()));
      list.replaceChildren();

      if (!devices.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 7;
        cell.textContent = 'No phone, accessory or electronics listings yet.';
        row.appendChild(cell);
        list.appendChild(row);
      }

      devices.forEach(product => {
        const row = document.createElement('tr');
        const imageCell = document.createElement('td');
        if (product.image_url) {
          const image = document.createElement('img');
          image.src = product.image_url;
          image.alt = (product.name || 'Device') + ' picture';
          image.loading = 'lazy';
          image.style.cssText = 'width:56px;height:56px;object-fit:contain;border-radius:8px;';
          image.onerror = () => { imageCell.textContent = 'Image unavailable'; };
          imageCell.appendChild(image);
        } else {
          imageCell.textContent = 'No picture';
        }
        row.appendChild(imageCell);

        [product.sku, product.name, product.product_type, money(product.price_ngwee), product.stock_quantity]
          .forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = String(value ?? '');
            row.appendChild(cell);
          });

        const actions = document.createElement('td');
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'ghost';
        edit.textContent = 'Edit';
        edit.addEventListener('click', () => {
          editingId = product.id;
          field('phone-product-sku').value = product.sku || '';
          field('phone-product-name').value = product.name || '';
          field('phone-product-type').value = deviceTypes.has(String(product.product_type || '').toLowerCase()) ? product.product_type : 'phone';
          field('phone-product-description').value = product.description || '';
          field('phone-product-image-url').value = product.image_url || '';
          field('phone-product-price').value = (Number(product.price_ngwee || 0) / 100).toFixed(2);
          field('phone-product-stock').value = Number(product.stock_quantity || 0);
          saveButton.textContent = 'Save Device Changes';
          cancelButton.hidden = false;
          field('phone-product-form-heading').textContent = 'Edit Device Listing';
          status.textContent = 'Editing: ' + (product.name || 'device');
          form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        actions.appendChild(edit);
        row.appendChild(actions);
        list.appendChild(row);
      });

      status.textContent = 'Loaded ' + devices.length + ' phone, accessory or electronics listing(s).';
    } catch (error) {
      status.textContent = error.message || 'Unable to load device listings.';
    } finally {
      refreshButton.disabled = false;
    }
  }

  tabButton.addEventListener('click', () => {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    loadPhoneProducts();
  });
  refreshButton.addEventListener('click', loadPhoneProducts);
  cancelButton.addEventListener('click', resetForm);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const price = Number(field('phone-product-price').value);
    const stock = Number(field('phone-product-stock').value);
    if (!Number.isFinite(price) || price < 0 || !Number.isSafeInteger(Math.round(price * 100))) {
      status.textContent = 'Enter a valid price in ZMW.';
      return;
    }
    if (!Number.isSafeInteger(stock) || stock < 0) {
      status.textContent = 'Stock must be a non-negative whole number.';
      return;
    }

    saveButton.disabled = true;
    status.textContent = 'Saving device listing...';
    const payload = {
      sku: field('phone-product-sku').value.trim(),
      name: field('phone-product-name').value.trim(),
      product_type: field('phone-product-type').value,
      description: field('phone-product-description').value.trim(),
      image_url: field('phone-product-image-url').value.trim(),
      price_ngwee: Math.round(price * 100),
      stock_quantity: stock
    };

    try {
      const result = await requestJSON(
        editingId === null ? '/api/products' : '/api/products/' + editingId,
        {
          method: editingId === null ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      const name = result.product?.name || payload.name;
      status.textContent = 'Saved successfully: ' + name + '.';
      notify('Phones & Accessories', 'Device listing saved to the SCBS product database.', 'success');
      resetForm();
      await loadPhoneProducts();
      if (typeof window.scbsLoadPublicPhoneProducts === 'function') {
        await window.scbsLoadPublicPhoneProducts();
      }
      if (typeof window.scbsLoadPublicProducts === 'function') {
        window.scbsLoadPublicProducts();
      }
    } catch (error) {
      status.textContent = error.message || 'Unable to save device listing.';
      notify('Device not saved', status.textContent, 'error');
    } finally {
      saveButton.disabled = false;
    }
  });

  console.info('SCBS dedicated Phones & Accessories management initialized.');
})();


// ============================================
// SCBS footer notices - external script compatible with the current CSP.
(function () {
  if (window.scbsFooterNoticesInitialized) return;
  window.scbsFooterNoticesInitialized = true;

  var notices = {
    terms: {
      title: 'SCBS TERMS OF USE',
      text: 'Use SCBS for legitimate business activities. Do not use it for fraud, unlawful activities, harassment or harmful conduct. Comply with applicable laws.'
    },
    privacy: {
      title: 'SCBS PRIVACY NOTICE',
      text: 'Protect customer information. Collect only what is needed for legitimate business operations and handle personal information responsibly.'
    },
    legal: {
      title: 'SCBS LEGAL NOTICE',
      text: 'Use SCBS lawfully and responsibly. Do not use it for fraud, illegal activities, abuse or harmful conduct. This general notice is not a substitute for legal advice.'
    }
  };

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var button = target.closest('button[data-scbs-note]');
    if (!button) return;

    var note = notices[button.getAttribute('data-scbs-note')];
    if (!note) return;

    event.preventDefault();
    event.stopImmediatePropagation(); notify('!  ' + note.title.toUpperCase(), note.text.toUpperCase(), 'error', 8000);
  }, true);
})();



// SCBS-OWNER-TEAM-MANAGEMENT-V1
// The server remains the authority for all team permissions.
(() => {
  'use strict';

  const panel = document.getElementById('scbs-team-management');
  const rows = document.getElementById('scbs-team-rows');
  const status = document.getElementById('scbs-team-status');
  const refreshButton = document.getElementById('scbs-team-refresh');
  const form = document.getElementById('scbs-team-create-form');

  if (!panel || !rows || !status || !refreshButton || !form) return;

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.style.color = isError ? '#b42318' : '';
  };

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });

    const raw = await response.text();
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Unexpected server response (HTTP ${response.status}).`);
    }

    if (!response.ok || data.success === false) {
      throw new Error(data.error || data.message || `Request failed (HTTP ${response.status}).`);
    }

    return data;
  }

  function makeCell(value) {
    const cell = document.createElement('td');
    cell.textContent = value == null || value === '' ? '-' : String(value);
    return cell;
  }

  function makeButton(label, handler, className = 'ghost') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  async function loadTeam() {
    refreshButton.disabled = true;
    setStatus('Loading team members...');

    try {
      const data = await requestJson('/api/admin/team');
      const team = Array.isArray(data.team) ? data.team : [];

      rows.replaceChildren();

      if (!team.length) {
        const row = document.createElement('tr');
        const cell = makeCell('No administrator accounts found.');
        cell.colSpan = 7;
        row.append(cell);
        rows.append(row);
      }

      for (const member of team) {
        const row = document.createElement('tr');
        row.append(
          makeCell(member.display_name),
          makeCell(member.email),
          makeCell(member.role),
          makeCell(Number(member.is_active) === 1 ? 'Active' : 'Inactive'),
          makeCell(member.last_login_at)
        );

        const actions = document.createElement('td');

        if (member.role === 'owner') {
          actions.textContent = 'Owner account protected';
        } else {
          const roleSelect = document.createElement('select');
          roleSelect.setAttribute('aria-label', `Role for ${member.display_name}`);
          for (const role of ['manager', 'staff']) {
            const option = document.createElement('option');
            option.value = role;
            option.textContent = role;
            option.selected = member.role === role;
            roleSelect.append(option);
          }

          actions.append(roleSelect, document.createTextNode(' '));

          actions.append(makeButton('Save Role', async () => {
            if (roleSelect.value === member.role) {
              setStatus('No role change was selected.');
              return;
            }

            if (!confirm(`Change ${member.display_name}'s role to ${roleSelect.value}?`)) return;

            try {
              await requestJson(`/api/admin/team/${encodeURIComponent(member.id)}/role`, {
                method: 'PATCH',
                body: JSON.stringify({ role: roleSelect.value })
              });
              setStatus('Role updated successfully.');
              await loadTeam();
            } catch (error) {
              setStatus(error.message, true);
            }
          }));

          actions.append(document.createTextNode(' '));

          actions.append(makeButton(
            Number(member.is_active) === 1 ? 'Deactivate' : 'Activate',
            async () => {
              const nextActive = Number(member.is_active) !== 1;
              const action = nextActive ? 'activate' : 'deactivate';

              if (!confirm(`Are you sure you want to ${action} ${member.display_name}'s account?`)) return;

              try {
                await requestJson(`/api/admin/team/${encodeURIComponent(member.id)}/status`, {
                  method: 'PATCH',
                  body: JSON.stringify({ is_active: nextActive })
                });
                setStatus(`Account ${action}d successfully.`);
                await loadTeam();
              } catch (error) {
                setStatus(error.message, true);
              }
            }
          ));
        }

        row.append(actions);
        rows.append(row);
      }

      setStatus(`Loaded ${team.length} team account(s).`);
    } catch (error) {
      setStatus(error.message || 'Unable to load team members.', true);
    } finally {
      refreshButton.disabled = false;
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const button = document.getElementById('scbs-team-create-button');
    const passwordInput = document.getElementById('scbs-team-password');
    button.disabled = true;
    setStatus('Creating team account...');

    try {
      await requestJson('/api/admin/team', {
        method: 'POST',
        body: JSON.stringify({
          display_name: document.getElementById('scbs-team-name').value.trim(),
          email: document.getElementById('scbs-team-email').value.trim(),
          role: document.getElementById('scbs-team-role').value,
          password: passwordInput.value
        })
      });

      form.reset();
      setStatus('Team account created successfully.');
      await loadTeam();
    } catch (error) {
      setStatus(error.message || 'Unable to create team account.', true);
    } finally {
      passwordInput.value = '';
      button.disabled = false;
    }
  });

  refreshButton.addEventListener('click', loadTeam);

  async function checkOwnerSession() {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const data = await response.json();

      if (response.ok && data.authenticated === true && data.admin?.role === 'owner') {
        panel.hidden = false;
        setStatus('Owner access verified. Refresh the team list when ready.');
      } else {
        panel.hidden = true;
      }
    } catch {
      panel.hidden = true;
    }
  }

  checkOwnerSession();
  window.addEventListener('focus', checkOwnerSession);
})();
// END SCBS-OWNER-TEAM-MANAGEMENT-V1


// SCBS OWNER: customer account and order management.
(() => {
  'use strict';
  const customerList = document.getElementById('scbs-admin-customer-list');
  const customerStatus = document.getElementById('scbs-admin-customer-status');
  const orderList = document.getElementById('scbs-admin-order-list');
  const orderStatus = document.getElementById('scbs-admin-order-status');
  const refreshCustomers = document.getElementById('scbs-admin-refresh-customers');
  const refreshOrders = document.getElementById('scbs-admin-refresh-orders');
  if (!customerList || !orderList || !refreshCustomers || !refreshOrders) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
  const money = ngwee => 'K' + (Number(ngwee || 0) / 100).toFixed(2);

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      ...options
    });
    const result = await response.json();
    if (!response.ok || result.success === false) throw new Error(result.error || 'Request failed.');
    return result;
  }

  async function loadCustomers() {
    customerStatus.textContent = 'Loading customer accounts...';
    refreshCustomers.disabled = true;
    try {
      const result = await api('/api/admin/customers');
      if (!result.customers.length) customerList.innerHTML = '<p>No customer accounts found.</p>';
      else customerList.innerHTML = `<table><thead><tr><th>Customer</th><th>Email</th><th>Access</th><th>Action</th></tr></thead><tbody>${result.customers.map(c => `<tr>
        <td>${esc(c.full_name)}<br><small>${esc(c.customer_code)}</small></td>
        <td>${esc(c.email)}</td>
        <td>${Number(c.is_disabled) ? 'Disabled' : esc(c.status || 'active')}${c.disabled_reason ? `<br><small>Reason: ${esc(c.disabled_reason)}</small>` : ''}</td>
        <td>${Number(c.is_disabled) ? `<button type="button" data-customer-enable="${Number(c.id)}">Re-enable</button>` : `<button type="button" data-customer-disable="${Number(c.id)}">Disable</button>`}</td>
      </tr>`).join('')}</tbody></table>`;
      customerStatus.textContent = `${result.count} account(s) loaded.`;
    } catch (error) { customerStatus.textContent = error.message; }
    finally { refreshCustomers.disabled = false; }
  }

  async function loadOrders() {
    orderStatus.textContent = 'Loading orders...';
    refreshOrders.disabled = true;
    try {
      const result = await api('/api/admin/orders');
      if (!result.orders.length) orderList.innerHTML = '<p>No orders found.</p>';
      else orderList.innerHTML = `<table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>${result.orders.map(o => `<tr>
        <td>${esc(o.order_number || o.id)}</td>
        <td>${esc(o.customer_name)}<br><small>${esc(o.customer_email)}</small></td>
        <td>${money(o.total_ngwee)}</td>
        <td>${esc(o.status)}${o.cancellation_reason ? `<br><small>Reason: ${esc(o.cancellation_reason)}</small>` : ''}</td>
        <td>${esc(o.created_at)}</td>
        <td>${(() => {
          const status = String(o.status || 'pending').toLowerCase();
          const nextActions = {
            pending: { status: 'confirmed', label: 'Confirm order' },
            confirmed: { status: 'processing', label: 'Start processing' },
            processing: { status: 'ready', label: 'Mark ready' },
            ready: { status: 'completed', label: 'Complete order' }
          };
          const next = nextActions[status];
          const advanceButton = next
            ? `<button type="button" data-order-status="${Number(o.id)}" data-next-status="${next.status}">${next.label}</button>`
            : '';
          const cancelButton = ['pending','confirmed','processing','ready'].includes(status)
            ? `<button type="button" data-order-cancel="${Number(o.id)}">Cancel order</button>`
            : '';
          return advanceButton + (advanceButton && cancelButton ? ' ' : '') + cancelButton || 'No action';
        })()}</td>
      </tr>`).join('')}</tbody></table>`;
      orderStatus.textContent = `${result.count} order(s) loaded.`;
    } catch (error) { orderStatus.textContent = error.message; }
    finally { refreshOrders.disabled = false; }
  }

  refreshCustomers.addEventListener('click', loadCustomers);
  refreshOrders.addEventListener('click', loadOrders);
  customerList.addEventListener('click', async event => {
    const disableButton = event.target.closest('[data-customer-disable]');
    const enableButton = event.target.closest('[data-customer-enable]');
    if (!disableButton && !enableButton) return;
    const button = disableButton || enableButton;
    const id = Number(disableButton ? disableButton.dataset.customerDisable : enableButton.dataset.customerEnable);
    const disabled = Boolean(disableButton);
    let reason = '';
    if (disabled) {
      reason = window.prompt('Enter the reason for disabling this customer account (5-500 characters):') || '';
      if (reason.trim().length < 5 || reason.trim().length > 500) {
        customerStatus.textContent = 'No change made. A reason of 5-500 characters is required.';
        return;
      }
    } else if (!window.confirm('Re-enable this customer account?')) return;
    button.disabled = true;
    try {
      const result = await api(`/api/admin/customers/${id}/access`, { method: 'PATCH', body: JSON.stringify({ disabled, reason: reason.trim() }) });
      customerStatus.textContent = result.message;
      await loadCustomers();
    } catch (error) { customerStatus.textContent = error.message; button.disabled = false; }
  });
  orderList.addEventListener('click', async event => {
    const button = event.target.closest('[data-order-status]');
    if (!button) return;

    const id = Number(button.dataset.orderStatus);
    const nextStatus = button.dataset.nextStatus;
    const labels = {
      confirmed: 'confirm this order',
      processing: 'start processing this order',
      ready: 'mark this order ready',
      completed: 'mark this order completed'
    };

    if (!Number.isSafeInteger(id) || id <= 0 || !labels[nextStatus]) {
      orderStatus.textContent = 'Invalid order status action.';
      return;
    }

    if (!window.confirm(`Are you sure you want to ${labels[nextStatus]}?`)) return;

    button.disabled = true;
    try {
      const result = await api(`/api/admin/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus })
      });
      orderStatus.textContent = result.message || 'Order status updated.';
      await loadOrders();
    } catch (error) {
      orderStatus.textContent = error.message;
      button.disabled = false;
    }
  });

  orderList.addEventListener('click', async event => {
    const button = event.target.closest('[data-order-cancel]');
    if (!button) return;
    const id = Number(button.dataset.orderCancel);
    const reason = window.prompt('Enter the reason for cancelling this order (5-500 characters):') || '';
    if (reason.trim().length < 5 || reason.trim().length > 500) {
      orderStatus.textContent = 'No change made. A cancellation reason of 5-500 characters is required.';
      return;
    }
    if (!window.confirm('Cancel this order and restore eligible inventory? This action will be recorded.')) return;
    button.disabled = true;
    try {
      const result = await api(`/api/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled', reason: reason.trim() }) });
      orderStatus.textContent = result.message;
      await loadOrders();
    } catch (error) { orderStatus.textContent = error.message; button.disabled = false; }
  });
})();



// ============================================
// SCBS VIDEO LIBRARY: public search and admin management
// ============================================
(() => {
  'use strict';
  const publicList = document.getElementById('scbs-public-video-list');
  const publicStatus = document.getElementById('scbs-public-videos-status');
  const publicSearch = document.getElementById('scbs-video-search');
  const publicCategory = document.getElementById('scbs-video-category');
  const adminForm = document.getElementById('scbs-video-form');
  const adminStatus = document.getElementById('scbs-admin-videos-status');
  const adminList = document.getElementById('scbs-admin-video-list');
  const refreshAdmin = document.getElementById('scbs-refresh-admin-videos');
  if (!publicList || !publicStatus || !adminForm || !adminList || !adminStatus) return;

  let publicVideos = [];
  let adminVideos = [];
  let editingId = null;
  const escText = value => String(value ?? '');
  const apiRequest = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { Accept: 'application/json', ...(options.headers || {}) }
    });
    const raw = await response.text();
    let result;
    try { result = JSON.parse(raw); }
    catch { throw new Error(`Unexpected server response (HTTP ${response.status}).`); }
    if (!response.ok || result.success !== true) throw new Error(result.error || 'SCBS request failed.');
    return result;
  };
  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const videoCard = video => {
    const card = create('article', 'card scbs-video-card');
    const frame = document.createElement('iframe');
    frame.className = 'scbs-video-frame';
    frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.youtube_video_id)}`;
    frame.title = `${escText(video.title)} - SCBS video`;
    frame.loading = 'lazy';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.allowFullscreen = true;
    card.appendChild(frame);
    card.appendChild(create('span', 'scbs-video-category', escText(video.category)));
    card.appendChild(create('h3', '', escText(video.title)));
    if (video.description) card.appendChild(create('p', 'muted', escText(video.description)));
    return card;
  };
  function renderPublicVideos() {
    const query = (publicSearch?.value || '').trim().toLowerCase();
    const category = publicCategory?.value || '';
    const filtered = publicVideos.filter(video => {
      const matchesText = !query || `${video.title} ${video.description} ${video.category}`.toLowerCase().includes(query);
      return matchesText && (!category || video.category === category);
    });
    publicList.replaceChildren();
    if (!filtered.length) {
      publicList.appendChild(create('p', 'muted', publicVideos.length
        ? 'No videos match your search. Try another word or category.'
        : 'No SCBS videos have been published yet. Please check back soon.'));
      return;
    }
    filtered.forEach(video => publicList.appendChild(videoCard(video)));
  }
  async function loadPublicVideos() {
    publicStatus.textContent = 'Loading published SCBS videos...';
    try {
      const result = await apiRequest('/api/videos');
      publicVideos = Array.isArray(result.videos) ? result.videos : [];
      if (publicCategory) {
        const selected = publicCategory.value;
        const categories = [...new Set(publicVideos.map(video => video.category).filter(Boolean))].sort();
        publicCategory.replaceChildren(new Option('All categories', ''));
        categories.forEach(category => publicCategory.add(new Option(category, category)));
        publicCategory.value = categories.includes(selected) ? selected : '';
      }
      publicStatus.textContent = `${publicVideos.length} published SCBS video${publicVideos.length === 1 ? '' : 's'} available.`;
      renderPublicVideos();
    } catch (error) {
      publicStatus.textContent = error.message || 'Unable to load SCBS videos.';
      publicList.replaceChildren();
    }
  }
  function renderAdminVideos() {
    adminList.replaceChildren();
    if (!adminVideos.length) {
      adminList.appendChild(create('p', 'muted', 'No SCBS videos have been added yet.'));
      return;
    }
    adminVideos.forEach(video => {
      const card = create('article', 'card');
      card.appendChild(create('h4', '', escText(video.title)));
      card.appendChild(create('p', 'muted', `${escText(video.category)} · ${escText(video.status)}`));
      if (video.description) card.appendChild(create('p', 'muted', escText(video.description)));
      const link = create('a', 'small-badge', 'Open YouTube link');
      link.href = video.youtube_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      card.appendChild(link);
      const actions = create('div', 'actions');
      const edit = create('button', 'ghost', 'Edit');
      edit.type = 'button';
      edit.dataset.videoEdit = String(video.id);
      const remove = create('button', 'ghost', 'Delete');
      remove.type = 'button';
      remove.dataset.videoDelete = String(video.id);
      actions.append(edit, remove);
      card.appendChild(actions);
      adminList.appendChild(card);
    });
  }
  async function loadAdminVideos() {
    adminStatus.textContent = 'Loading SCBS videos...';
    if (refreshAdmin) refreshAdmin.disabled = true;
    try {
      const result = await apiRequest('/api/admin/videos');
      adminVideos = Array.isArray(result.videos) ? result.videos : [];
      renderAdminVideos();
      adminStatus.textContent = `${adminVideos.length} video record${adminVideos.length === 1 ? '' : 's'} loaded.`;
    } catch (error) {
      adminStatus.textContent = error.message || 'Unable to load admin videos.';
    } finally {
      if (refreshAdmin) refreshAdmin.disabled = false;
    }
  }
  function resetForm() {
    editingId = null;
    adminForm.reset();
    document.getElementById('scbs-video-form-heading').textContent = 'Add SCBS Video';
    document.getElementById('scbs-video-save').textContent = 'Save Video';
    document.getElementById('scbs-video-cancel-edit').hidden = true;
  }
  adminForm.addEventListener('submit', async event => {
    event.preventDefault();
    const save = document.getElementById('scbs-video-save');
    const payload = {
      title: document.getElementById('scbs-video-title').value.trim(),
      description: document.getElementById('scbs-video-description').value.trim(),
      category: document.getElementById('scbs-video-admin-category').value,
      youtube_url: document.getElementById('scbs-video-youtube-url').value.trim(),
      status: document.getElementById('scbs-video-admin-status').value
    };
    save.disabled = true;
    save.textContent = editingId ? 'Updating...' : 'Saving...';
    adminStatus.textContent = 'Saving SCBS video...';
    try {
      const result = await apiRequest(editingId ? `/api/admin/videos/${editingId}` : '/api/admin/videos', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      adminStatus.textContent = result.message || 'SCBS video saved.';
      if (typeof notify === 'function') notify('SCBS Videos', result.message || 'Video saved.', 'success');
      resetForm();
      await loadAdminVideos();
      await loadPublicVideos();
    } catch (error) {
      adminStatus.textContent = error.message || 'Unable to save the video.';
      if (typeof notify === 'function') notify('SCBS Videos', adminStatus.textContent, 'error');
    } finally {
      save.disabled = false;
      save.textContent = editingId ? 'Update Video' : 'Save Video';
    }
  });
  document.getElementById('scbs-video-cancel-edit').addEventListener('click', resetForm);
  refreshAdmin?.addEventListener('click', loadAdminVideos);
  adminList.addEventListener('click', async event => {
    const button = event.target.closest('button[data-video-edit],button[data-video-delete]');
    if (!button) return;
    const video = adminVideos.find(item => String(item.id) === (button.dataset.videoEdit || button.dataset.videoDelete));
    if (!video) return;
    if (button.dataset.videoEdit) {
      editingId = video.id;
      document.getElementById('scbs-video-title').value = video.title || '';
      document.getElementById('scbs-video-description').value = video.description || '';
      document.getElementById('scbs-video-admin-category').value = video.category || 'General';
      if (![...document.getElementById('scbs-video-admin-category').options].some(option => option.value === video.category)) {
        document.getElementById('scbs-video-admin-category').add(new Option(video.category, video.category));
        document.getElementById('scbs-video-admin-category').value = video.category;
      }
      document.getElementById('scbs-video-youtube-url').value = video.youtube_url || '';
      document.getElementById('scbs-video-admin-status').value = video.status || 'draft';
      document.getElementById('scbs-video-form-heading').textContent = 'Edit SCBS Video';
      document.getElementById('scbs-video-save').textContent = 'Update Video';
      document.getElementById('scbs-video-cancel-edit').hidden = false;
      adminForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!window.confirm(`Delete "${video.title}" from SCBS Videos?`)) return;
    button.disabled = true;
    try {
      const result = await apiRequest(`/api/admin/videos/${video.id}`, { method: 'DELETE' });
      adminStatus.textContent = result.message || 'Video deleted.';
      if (typeof notify === 'function') notify('SCBS Videos', result.message || 'Video deleted.', 'success');
      await loadAdminVideos();
      await loadPublicVideos();
    } catch (error) {
      adminStatus.textContent = error.message || 'Unable to delete the video.';
      button.disabled = false;
    }
  });
  publicSearch?.addEventListener('input', renderPublicVideos);
  publicCategory?.addEventListener('change', renderPublicVideos);
  loadPublicVideos();
  // Admin list is loaded only when the administrator explicitly refreshes it.
})();

// SCBS CUSTOMER COMMUNITY POSTS UPGRADE
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const feed = byId('scbs-customer-public-posts');
  const form = byId('scbs-customer-post-form');
  const setStatus = (id, message) => { const node = byId(id); if (node) node.textContent = message; };
  const formatDate = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
  };
  const makeLink = (href, label) => {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    if (href.startsWith('http')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    return link;
  };

  async function loadCustomerCommunityPosts() {
    if (!feed) return;
    setStatus('scbs-customer-posts-status', 'Loading customer posts...');
    try {
      const response = await fetch('/api/customer-posts', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || 'Unable to load customer posts.');
      feed.replaceChildren();
      for (const post of (data.posts || [])) {
        const card = document.createElement('article');
        card.className = 'scbs-community-card';
        const author = document.createElement('div');
        author.className = 'scbs-community-author';
        if (post.profile_picture_url) {
          const avatar = document.createElement('img');
          avatar.className = 'scbs-community-avatar';
          avatar.src = post.profile_picture_url;
          avatar.alt = `${post.author_name || 'Customer'} profile picture`;
          avatar.loading = 'lazy';
          avatar.addEventListener('error', () => avatar.remove(), { once: true });
          author.append(avatar);
        } else {
          const avatar = document.createElement('div');
          avatar.className = 'scbs-community-avatar';
          avatar.style.display = 'grid';
          avatar.style.placeItems = 'center';
          avatar.textContent = (post.author_name || 'C').trim().charAt(0).toUpperCase();
          author.append(avatar);
        }
        const authorInfo = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = post.author_name || 'SCBS Customer';
        const date = document.createElement('div');
        date.className = 'scbs-community-date';
        date.textContent = formatDate(post.created_at);
        authorInfo.append(name, date);
        author.append(authorInfo);
        const body = document.createElement('p');
        body.className = 'scbs-community-body';
        body.textContent = post.body;
        card.append(author, body);
        if (post.image_url) {
          const image = document.createElement('img');
          image.className = 'scbs-community-photo';
          image.src = post.image_url;
          image.alt = `Photo shared by ${post.author_name || 'an SCBS customer'}`;
          image.loading = 'lazy';
          image.addEventListener('error', () => image.remove(), { once: true });
          card.append(image);
        }
        if (post.email || post.phone) {
          const contact = document.createElement('div');
          contact.className = 'scbs-community-contact';
          if (post.phone) contact.append(makeLink(`tel:${String(post.phone).replace(/[^+\d]/g, '')}`, `Call ${post.phone}`));
          if (post.email) contact.append(makeLink(`mailto:${post.email}`, `Email ${post.email}`));
          card.append(contact);
        }
        if (post.is_mine) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'scbs-community-delete';
          remove.textContent = 'Delete my post';
          remove.addEventListener('click', async () => {
            if (!window.confirm('Delete this post from the SCBS community?')) return;
            remove.disabled = true;
            try {
              const result = await fetch(`/api/customer-posts/${post.id}`, { method: 'DELETE', credentials: 'same-origin' });
              const payload = await result.json();
              if (!result.ok || payload.success !== true) throw new Error(payload.error || 'Unable to delete post.');
              await loadCustomerCommunityPosts();
              setStatus('scbs-customer-post-status', 'Your post was deleted.');
            } catch (error) {
              setStatus('scbs-customer-posts-status', error.message || 'Unable to delete post.');
              remove.disabled = false;
            }
          });
          card.append(remove);
        }
        feed.append(card);
      }
      setStatus('scbs-customer-posts-status', data.posts?.length ? `${data.posts.length} customer post(s).` : 'No customer posts yet. Be the first to share something.');
    } catch (error) {
      setStatus('scbs-customer-posts-status', error.message || 'Unable to load customer posts.');
    }
  }

  byId('scbs-customer-post-photo')?.addEventListener('change', event => {
    const file = event.currentTarget.files?.[0];
    setStatus('scbs-customer-photo-name', file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)` : '');
  });

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = byId('scbs-customer-post-submit');
    const text = byId('scbs-customer-post-body');
    const photo = byId('scbs-customer-post-photo');
    const content = text?.value.trim() || '';
    if (!content || content.length > 1000) {
      setStatus('scbs-customer-post-status', 'Write between 1 and 1000 characters.');
      return;
    }
    if (photo?.files?.[0] && photo.files[0].size > 2 * 1024 * 1024) {
      setStatus('scbs-customer-post-status', 'Choose a photo that is 2 MB or smaller.');
      return;
    }
    button.disabled = true;
    button.textContent = 'Posting...';
    setStatus('scbs-customer-post-status', 'Publishing your post...');
    try {
      const payload = new FormData(form);
      const response = await fetch('/api/customer-posts', { method: 'POST', credentials: 'same-origin', body: payload, headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || 'Unable to publish your post. Please sign in again if your session expired.');
      form.reset();
      setStatus('scbs-customer-photo-name', '');
      setStatus('scbs-customer-post-status', data.message || 'Your post is published.');
      await loadCustomerCommunityPosts();
    } catch (error) {
      setStatus('scbs-customer-post-status', error.message || 'Unable to publish your post.');
    } finally {
      button.disabled = false;
      button.textContent = 'Post';
    }
  });

  const init = () => { loadCustomerCommunityPosts(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  window.addEventListener('scbs:customer-session-ready', loadCustomerCommunityPosts);
})();

