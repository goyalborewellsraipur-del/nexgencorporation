(function(){
  const STORE_KEY = 'nexgen_full_dynamic_site_data_v1';
  const ENQUIRY_KEY = 'nexgen_sheet_enquiries_v3';
  const AUTH_KEY = 'nexgen_supabase_user_cache_v2';
  const SITE_ROW_ID = 'main';
  const MEDIA_BUCKET = 'site-media';

  let authUser = null;
  let supabaseClient = null;
  let state = normalize(loadLocalData());
  const app = document.getElementById('app');

  function supabaseConfig(){ return window.NEXGEN_SUPABASE || {}; }
  function hasSupabaseConfig(){
    const c = supabaseConfig();
    return !!(c.SUPABASE_URL && c.SUPABASE_ANON_KEY && !String(c.SUPABASE_URL).includes('PASTE_') && !String(c.SUPABASE_ANON_KEY).includes('PASTE_'));
  }
  function getSupabase(){
    if(!hasSupabaseConfig() || !window.supabase) return null;
    if(!supabaseClient){
      const c = supabaseConfig();
      supabaseClient = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
        auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
      });
    }
    return supabaseClient;
  }

  function clone(v){ return JSON.parse(JSON.stringify(v || {})); }
  function deepMerge(base, patch){
    Object.keys(patch || {}).forEach(k => {
      if(patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) base[k] = deepMerge(base[k], patch[k]);
      else base[k] = patch[k];
    });
    return base;
  }
  function normalize(data){
    const d = deepMerge(clone(SITE_DATA || {}), clone(data || {}));
    d.company = d.company || {};
    d.hero = d.hero || {};
    d.about = d.about || { points: [] };
    d.about.points = Array.isArray(d.about.points) ? d.about.points : String(d.about.points || '').split('\n').filter(Boolean);
    d.services = Array.isArray(d.services) ? d.services : [];
    d.categories = Array.isArray(d.categories) ? d.categories : [];
    d.products = Array.isArray(d.products) ? d.products : [];
    d.cataloguePages = Array.isArray(d.cataloguePages) ? d.cataloguePages : [];
    d.gallery = Array.isArray(d.gallery) ? d.gallery : [];
    d.mediaLibrary = Array.isArray(d.mediaLibrary) ? d.mediaLibrary : [];
    d.integrations = Object.assign({ googleSheetUrl:'', emailTo:d.company.email || '', redirectToWhatsapp:true }, d.integrations || {});
    d.seo = Object.assign({ title:d.company.name || 'NEXGEN CORPORATION', description:'', keywords:'', url:'', image:d.company.logo || 'assets/logo.png' }, d.seo || {});
    d.products.forEach(p => {
      const c = d.categories.find(x => x.id === p.categoryId);
      if(c) p.category = c.title;
      if(!p.id) p.id = slug(p.name || ('product-' + Date.now())) + '-' + Math.random().toString(36).slice(2,6);
      if(!p.price) p.price = 'Get Quote';
    });
    return d;
  }
  function loadLocalData(){
    try{
      const saved = localStorage.getItem(STORE_KEY);
      if(saved) return deepMerge(clone(SITE_DATA), JSON.parse(saved));
    }catch(e){}
    return clone(SITE_DATA);
  }
  function saveLocal(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

  async function loadRemoteSiteData(){
    const sb = getSupabase();
    if(!sb) return;
    try{
      const { data, error } = await sb.from('site_content').select('data,updated_at').eq('id', SITE_ROW_ID).maybeSingle();
      if(error){ console.warn('Remote site data not loaded', error.message); return; }
      if(data && data.data){
        state = normalize(deepMerge(clone(SITE_DATA), data.data));
        saveLocal();
      }
    }catch(e){ console.warn('Remote site data failed', e); }
  }
  async function saveRemoteSiteData(){
    const sb = getSupabase();
    if(!sb) throw new Error('Supabase config missing.');
    if(!isAdmin()) throw new Error('Admin login required.');
    state = normalize(state);
    const payload = clone(state);
    const { error } = await withTimeout(sb.from('site_content').upsert({
      id: SITE_ROW_ID,
      data: payload,
      updated_by: currentUser()?.id || null,
      updated_at: new Date().toISOString()
    }, { onConflict:'id' }), 30000, 'Live save');
    if(error) throw error;
    saveLocal();
    return true;
  }

  function safeFileName(name){ return String(name || 'image').toLowerCase().replace(/\.[a-z0-9]+$/i,'').replace(/[^a-z0-9]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'') || 'image'; }
  function slug(v){ return safeFileName(v); }

  function compressImage(file, opts={}){
    const maxWidth = opts.maxWidth || 1600;
    const quality = opts.quality || 0.78;
    return new Promise((resolve, reject) => {
      if(!file || !file.type || !file.type.startsWith('image/')) return reject(new Error('Please select an image.'));
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)) return reject(new Error('Only JPG, PNG or WEBP allowed.'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try{
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if(w > maxWidth || h > maxWidth){
            const ratio = Math.min(maxWidth / w, maxWidth / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(blob => {
            URL.revokeObjectURL(url);
            if(!blob) return reject(new Error('Image compression failed.'));
            const compressed = new File([blob], safeFileName(file.name) + '.webp', { type:'image/webp', lastModified: Date.now() });
            resolve({ file: compressed, originalSize:file.size, compressedSize:blob.size, width:w, height:h });
          }, 'image/webp', quality);
        }catch(e){ URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image could not be loaded.')); };
      img.src = url;
    });
  }

  async function uploadMedia(file, folder='general', nameHint='image'){
    const sb = getSupabase();
    if(!sb) throw new Error('Supabase config missing.');
    if(!isAdmin()) throw new Error('Admin login required.');
    if(!file) throw new Error('Please select an image.');
    if(file.size > 12 * 1024 * 1024) throw new Error('Image size must be under 12 MB before compression.');
    const compressed = await withTimeout(compressImage(file, { maxWidth:1600, quality:0.78 }), 30000, 'Image compression');
    const path = `${slug(folder)}/${Date.now()}-${slug(nameHint || file.name)}.webp`;
    const { error: uploadError } = await withTimeout(sb.storage.from(MEDIA_BUCKET).upload(path, compressed.file, { cacheControl:'31536000', upsert:true, contentType:'image/webp' }), 60000, 'Image upload');
    if(uploadError) throw uploadError;
    const { data: publicData } = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    const url = publicData && publicData.publicUrl;
    if(!url) throw new Error('Public image URL not generated.');
    state.mediaLibrary.unshift({ url, path, folder, name:nameHint || file.name, originalSize:compressed.originalSize, compressedSize:compressed.compressedSize, date:new Date().toISOString() });
    return { url, path, originalSize:compressed.originalSize, compressedSize:compressed.compressedSize };
  }

  function enquiries(){ try{return JSON.parse(localStorage.getItem(ENQUIRY_KEY) || '[]')}catch(e){return []} }
  function saveEnquiries(list){ localStorage.setItem(ENQUIRY_KEY, JSON.stringify(list)); }
  function esc(v){ return String(v ?? '').replace(/[&<>'"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[s])); }
  function cleanPhone(){ return String(state.company.phone || '').replace(/\D/g,''); }
  function phoneHref(){ return 'tel:+91' + cleanPhone(); }
  function whatsappHref(message){ return 'https://wa.me/91' + cleanPhone() + '?text=' + encodeURIComponent(message || state.company.whatsappMessage || 'Hello NEXGEN CORPORATION, I want a quotation.'); }
  function mailHref(subject='NEXGEN Enquiry', body='Hello NEXGEN CORPORATION, I want a quotation.'){ return 'mailto:' + (state.integrations?.emailTo || state.company.email || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
  function mapHref(){ return state.company.mapLink || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(state.company.address || ''); }
  function webHref(){ const w = state.company.website || state.company.domain || ''; return w ? (w.startsWith('http') ? w : 'https://' + w) : '#'; }
  function icon(name, cls='icon-sm'){ return `<img class="${cls}" src="assets/icons/${name}.svg" alt="${name}">`; }
  function currentUser(){ return authUser; }
  function setUser(u){ authUser = u; if(u) sessionStorage.setItem(AUTH_KEY, JSON.stringify(u)); else sessionStorage.removeItem(AUTH_KEY); }
  function isAdmin(){ const u = currentUser(); return !!(u && String(u.role).toLowerCase() === 'admin'); }
  function route(){ return location.hash.replace('#','') || 'home'; }
  function go(r){ location.hash = r; }
  function category(id){ return state.categories.find(c => c.id === id); }
  function productsByCategory(id){ return state.products.filter(p => p.categoryId === id); }
  function toast(msg){
    let t = document.getElementById('toast');
    if(!t){ t = document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2500);
  }
  function withTimeout(promise, ms, label){
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error((label || 'Request') + ' took too long. Please check Supabase bucket/policies, internet connection, then try again.')), ms))
    ]);
  }

  function setDocumentMeta(title, desc){
    document.title = title || state.seo?.title || state.company.name || 'NEXGEN CORPORATION';
    const meta = document.querySelector('meta[name="description"]');
    if(meta) meta.setAttribute('content', desc || state.seo?.description || '');
  }

  async function refreshAuthUser(){
    const sb = getSupabase();
    if(!sb){ setUser(null); return null; }
    try{
      const { data, error } = await sb.auth.getUser();
      if(error || !data?.user){ setUser(null); return null; }
      const user = data.user;
      let role = 'staff';
      let name = user.user_metadata?.full_name || user.email || 'User';
      try{
        const { data: profile } = await sb.from('profiles').select('role, full_name, email, is_active').eq('id', user.id).maybeSingle();
        if(profile && profile.is_active !== false){ role = profile.role || role; name = profile.full_name || profile.email || name; }
      }catch(e){}
      const adminEmails = (supabaseConfig().ADMIN_EMAILS || []).map(x => String(x).toLowerCase().trim());
      if(user.email && adminEmails.includes(user.email.toLowerCase())) role = 'admin';
      const normalized = { id:user.id, email:user.email, username:user.email, role:String(role).toLowerCase() === 'admin' ? 'Admin' : role, name };
      setUser(normalized); return normalized;
    }catch(e){ setUser(null); return null; }
  }
  async function logout(){ const sb = getSupabase(); if(sb){ try{ await sb.auth.signOut(); }catch(e){} } setUser(null); go('login'); }

  function shell(content){ return topBar()+header()+content+footer()+floatingButtons()+quoteModal()+drawer()+`<div id="toast" class="toast"></div>`; }
  function topBar(){ return `<div class="top"><div class="container"><div>${esc(state.company.tagline)}</div><div class="top-links"><a class="top-link" href="${phoneHref()}">${icon('phone')} +91 ${esc(state.company.phone)}</a><a class="top-link" href="${whatsappHref()}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a><a class="top-link" href="${mailHref()}">${esc(state.company.email)}</a></div></div></div>`; }
  function header(){ return `<header class="header"><div class="container nav"><a class="brand" href="#home" aria-label="Home"><img class="logo" src="${esc(state.company.logo)}" alt="${esc(state.company.name)}"></a><nav class="nav-links"><a href="#home">Home</a><a href="#products">Products</a><a href="#about">About</a><a href="#catalogue">Catalogue</a><a href="#gallery">Gallery</a><a href="#contact">Contact</a><a href="#login">Admin Login</a></nav><div class="nav-action"><a class="btn btn-light" href="docs/Nexgen-Construction-Equipment-Catalogue.pdf" download>PDF</a></div><button class="menu" id="menuBtn" aria-label="Menu">☰</button></div></header>`; }
  function footer(){ return `<footer class="footer"><div class="container"><div><img class="footer-logo" src="${esc(state.company.logo)}" alt="${esc(state.company.name)}"><p>${esc(state.company.tagline)}</p><p>${esc(state.company.subTagline)}</p></div><div><h3>Company</h3><div class="footer-links"><a href="#about">About</a><a href="#products">Products</a><a href="#catalogue">Catalogue</a><a href="#gallery">Gallery</a><a href="#contact">Contact</a></div></div><div><h3>Products</h3><div class="footer-links">${state.categories.slice(0,6).map(c=>`<a href="#category/${esc(c.id)}">${esc(c.title)}</a>`).join('')}</div></div><div><h3>Contact</h3><p>+91 ${esc(state.company.phone)}</p><p>${esc(state.company.email)}</p><p>${esc(state.company.address)}</p><p><a href="${webHref()}" target="_blank" rel="noopener">${esc(state.company.website || '')}</a></p></div></div><div class="copy">© ${new Date().getFullYear()} ${esc(state.company.name)}</div></footer>`; }
  function floatingButtons(){ return `<div class="float"><a class="float-wa" href="${whatsappHref()}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp','')}</a><a class="float-call" href="${phoneHref()}" aria-label="Phone">${icon('phone','')}</a><button class="float-admin" id="adminButton" aria-label="Admin">⚙</button></div>`; }
  function drawer(){ return `<div class="drawer" id="drawer"><div class="drawer-panel"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><b>Menu</b><button id="closeDrawer" style="width:44px;height:44px;border-radius:14px;background:#f1f5f9;font-size:26px">×</button></div><a href="#home">Home</a><a href="#products">Products</a><a href="#about">About</a><a href="#catalogue">Catalogue</a><a href="#gallery">Gallery</a><a href="#contact">Contact</a><a href="#login">Admin Login</a><div style="height:1px;background:#e5e7eb;margin:12px 0"></div><a class="btn btn-gold" href="${whatsappHref()}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a><a class="btn btn-dark" href="${phoneHref()}">${icon('phone')} Call</a></div></div>`; }

  function home(){
    setDocumentMeta(state.seo.title, state.seo.description);
    const gallery = state.gallery && state.gallery.length ? `<section class="section"><div class="container"><div class="section-head"><div><div class="kicker">Gallery</div><h2 class="title">Project and Product Gallery</h2></div><a class="btn btn-dark" href="#gallery">View Gallery</a></div><div class="gallery-grid">${state.gallery.slice(0,8).map(galleryCard).join('')}</div></div></section>` : '';
    return shell(`<section class="hero"><div class="container"><div><span class="eyebrow">${esc(state.company.tagline)}</span><h1><span class="gold">${esc(state.company.name)}</span><br>${esc(state.hero.title)}</h1><p>${esc(state.hero.text)}</p><div class="hero-buttons"><button class="btn btn-gold" data-quote="General Enquiry">${esc(state.hero.button1)}</button><a class="btn btn-light" href="#products">${esc(state.hero.button2)}</a><a class="btn btn-dark" href="${phoneHref()}">${icon('phone')} Call</a></div><div class="stats"><div class="stat"><b>${state.categories.length}</b><span>Categories</span></div><div class="stat"><b>${state.products.length}+</b><span>Products</span></div><div class="stat"><b>${esc(state.company.established || '2026')}</b><span>Established</span></div></div></div><div><div class="hero-logo-box"><img src="${esc(state.company.logo)}" alt="${esc(state.company.name)}"></div></div></div></section><section class="section soft"><div class="container"><div class="section-head"><div><div class="kicker">Services</div><h2 class="title">Products and Services</h2></div></div><div class="grid grid-3">${state.services.map(s=>`<div class="card card-pad service-card"><div class="service-icon">N</div><b>${esc(s)}</b></div>`).join('')}</div></div></section><section class="section"><div class="container"><div class="section-head"><div><div class="kicker">Categories</div><h2 class="title">Product Range</h2></div><a class="btn btn-dark" href="#products">All Products</a></div><div class="grid grid-4">${state.categories.map(categoryCard).join('')}</div></div></section><section class="section black"><div class="container about-grid"><div><div class="kicker">About</div><h2 class="title">${esc(state.about.title || 'About')}</h2><p class="lead">${esc(state.about.text)}</p><div class="hero-buttons"><a class="btn btn-gold" href="#contact">Contact</a><a class="btn btn-light" href="docs/Nexgen-Construction-Equipment-Catalogue.pdf" download>Download PDF</a></div></div><div class="grid grid-2">${state.about.points.map(p=>`<div class="point"><span class="tick">✓</span>${esc(p)}</div>`).join('')}</div></div></section><section class="section soft"><div class="container"><div class="section-head"><div><div class="kicker">Products</div><h2 class="title">Featured Products</h2></div></div><div class="grid grid-4">${state.products.slice(0,12).map(productCard).join('')}</div></div></section>${gallery}`);
  }
  function categoryCard(c){ return `<article class="category-card"><img loading="lazy" src="${esc(c.image)}" alt="${esc(c.title)}"><div class="body"><h3>${esc(c.title)}</h3><p>${esc(c.subtitle)}</p><div class="small-row"><span>${productsByCategory(c.id).length} Products</span><a href="#category/${esc(c.id)}">View</a></div></div></article>`; }
  function productCard(p){ return `<article class="product-card card"><img loading="lazy" src="${esc(p.image)}" alt="${esc(p.name)}"><div class="product-body"><span class="tag">${esc(p.category)}</span><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><div class="product-actions"><button class="btn btn-light" data-detail="${esc(p.id)}">Details</button><button class="btn btn-gold" data-quote="${esc(p.name)}">Quote</button></div></div></article>`; }
  function galleryCard(g,i){ return `<article class="gallery-card card"><img loading="lazy" src="${esc(g.url || g.image || '')}" alt="${esc(g.title || 'Gallery Image')}"><div class="product-body"><h3>${esc(g.title || ('Gallery Image '+(i+1)))}</h3><p>${esc(g.caption || '')}</p></div></article>`; }

  function products(){ setDocumentMeta('Products | '+state.company.name, 'Browse NEXGEN product catalogue.'); return shell(`<section class="section soft"><div class="container"><div class="section-head"><div><div class="kicker">Products</div><h2 class="title">Product Catalogue</h2></div></div><div class="search-box"><input id="searchInput" class="input" placeholder="Search product"><select id="categorySelect" class="select"><option value="all">All Categories</option>${state.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</select><button id="searchBtn" class="btn btn-dark">Search</button></div><div id="productResult" class="grid grid-4">${state.products.slice(0,120).map(productCard).join('')}</div><p id="productCount" class="lead">Showing ${Math.min(120,state.products.length)} of ${state.products.length}</p></div></section>`); }
  function categoryPage(id){ const cat = category(id); if(!cat) return products(); const list = productsByCategory(id); setDocumentMeta(cat.title+' | '+state.company.name, cat.subtitle); return shell(`<section class="section soft"><div class="container about-grid"><div><div class="kicker">Category</div><h2 class="title">${esc(cat.title)}</h2><p class="lead">${esc(cat.subtitle)}</p><div class="hero-buttons"><button class="btn btn-gold" data-quote="${esc(cat.title)}">Quote</button><a class="btn btn-dark" href="#products">All Products</a></div></div><div class="catalogue-card"><img loading="lazy" src="${esc(cat.image)}" alt="${esc(cat.title)}"></div></div></section><section class="section"><div class="container"><div class="grid grid-4">${list.map(productCard).join('')}</div></div></section>`); }
  function about(){ setDocumentMeta('About | '+state.company.name, state.about.text); return shell(`<section class="section soft"><div class="container about-grid"><div><div class="kicker">About</div><h2 class="title">${esc(state.company.name)}</h2><p class="lead">${esc(state.about.text)}</p></div><div class="grid grid-2">${state.about.points.map(p=>`<div class="point"><span class="tick">✓</span>${esc(p)}</div>`).join('')}</div></div></section><section class="section"><div class="container"><div class="section-head"><div><div class="kicker">Services</div><h2 class="title">What We Supply</h2></div></div><div class="grid grid-3">${state.services.map(s=>`<div class="card card-pad"><h3>${esc(s)}</h3></div>`).join('')}</div></div></section>`); }
  function catalogue(){ setDocumentMeta('Catalogue | '+state.company.name, 'Download and view NEXGEN construction equipment catalogue.'); return shell(`<section class="section soft"><div class="container"><div class="section-head"><div><div class="kicker">Catalogue</div><h2 class="title">NEXGEN Catalogue</h2></div><a class="btn btn-dark" href="docs/Nexgen-Construction-Equipment-Catalogue.pdf" download>Download PDF</a></div><div class="catalogue-grid">${state.cataloguePages.map((src,i)=>`<div class="catalogue-card"><div class="catalogue-title">Page ${i+1}</div><img loading="lazy" src="${esc(src)}" alt="Catalogue Page ${i+1}"></div>`).join('')}</div></div></section>`); }
  function gallery(){ setDocumentMeta('Gallery | '+state.company.name, 'NEXGEN gallery.'); return shell(`<section class="section soft"><div class="container"><div class="section-head"><div><div class="kicker">Gallery</div><h2 class="title">Project and Product Gallery</h2></div></div>${state.gallery.length ? `<div class="gallery-grid">${state.gallery.map(galleryCard).join('')}</div>` : `<div class="card card-pad"><h3>No gallery images yet.</h3><p class="lead">Admin can upload gallery images from the admin panel.</p></div>`}</div></section>`); }
  function contact(){ setDocumentMeta('Contact | '+state.company.name, 'Contact NEXGEN CORPORATION.'); return shell(`<section class="section soft"><div class="container contact-grid"><div><div class="kicker">Contact</div><h2 class="title">Get in Touch</h2><div class="grid" style="margin-top:20px"><div class="contact-line">${icon('phone')}<div><b>Phone</b><br><a href="${phoneHref()}">+91 ${esc(state.company.phone)}</a></div></div><div class="contact-line">${icon('whatsapp')}<div><b>WhatsApp</b><br><a href="${whatsappHref()}" target="_blank" rel="noopener">+91 ${esc(state.company.phone)}</a></div></div><div class="contact-line"><div style="font-weight:900;width:24px">@</div><div><b>Email</b><br><a href="${mailHref()}">${esc(state.company.email)}</a></div></div><div class="contact-line"><div style="font-weight:900;width:24px">🌐</div><div><b>Website</b><br><a href="${webHref()}" target="_blank" rel="noopener">${esc(state.company.website || state.company.domain || '')}</a></div></div><div class="contact-line"><div style="font-weight:900;width:24px">📍</div><div><b>Address</b><br>${esc(state.company.address)}<br><br><a class="btn btn-gold" href="${mapHref()}" target="_blank" rel="noopener">Get Directions</a></div></div></div></div><div class="card card-pad"><h2 style="margin-top:0">Send Enquiry</h2>${enquiryForm('General Enquiry')}</div></div></section>`); }

  function enquiryForm(product){ return `<form class="form enquiry-form"><input type="hidden" name="product" value="${esc(product)}"><label class="label">Name<input class="input" name="name" required></label><label class="label">Phone<input class="input" name="phone" required></label><label class="label">Email<input class="input" name="email"></label><label class="label">Requirement<textarea class="textarea" name="message" rows="4">${esc(product)}</textarea></label><button class="btn btn-gold" type="submit">Submit Enquiry</button><a class="btn btn-dark" href="${whatsappHref('Hello NEXGEN CORPORATION, I want a quotation for ' + product)}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a><a class="btn btn-light" href="${mailHref('NEXGEN Enquiry - '+product, 'Hello NEXGEN CORPORATION, I want a quotation for '+product)}">Email</a></form>`; }
  function quoteModal(){ return `<div class="modal" id="quoteModal"><div class="modal-box"><div class="modal-head"><div><div class="kicker">Quote</div><h2 id="modalTitle" style="margin:4px 0 0">Get Quote</h2></div><button class="close" id="closeModal">×</button></div><div class="modal-body" id="modalBody"></div></div></div>`; }
  function productDetail(id){ const p = state.products.find(x => x.id === id); if(!p) return; document.getElementById('modalTitle').textContent = p.name; document.getElementById('modalBody').innerHTML = `<div class="about-grid"><img loading="lazy" src="${esc(p.image)}" alt="${esc(p.name)}" style="border-radius:18px"><div><p><b>Category:</b> ${esc(p.category)}</p><p>${esc(p.description)}</p><p><b>Price:</b> ${esc(p.price)}</p><button class="btn btn-gold" data-quote="${esc(p.name)}">Quote</button></div></div>`; document.getElementById('quoteModal').classList.add('show'); document.querySelectorAll('[data-quote]').forEach(b => b.addEventListener('click', () => openQuote(b.dataset.quote))); }
  function openQuote(product){ document.getElementById('modalTitle').textContent = 'Get Quote'; document.getElementById('modalBody').innerHTML = enquiryForm(product); document.getElementById('quoteModal').classList.add('show'); bindForms(); }
  function closeModal(){ document.getElementById('quoteModal')?.classList.remove('show'); }
  function filterProducts(){ const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim(); const c = document.getElementById('categorySelect')?.value || 'all'; const result = state.products.filter(p => (`${p.name} ${p.category} ${p.description}`.toLowerCase().includes(q)) && (c === 'all' || p.categoryId === c)); document.getElementById('productResult').innerHTML = result.map(productCard).join('') || `<div class="card card-pad"><b>No product found.</b></div>`; document.getElementById('productCount').textContent = `Showing ${result.length} of ${state.products.length}`; bindProductButtons(); }
  function bindProductButtons(){ document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => productDetail(b.dataset.detail)); document.querySelectorAll('[data-quote]').forEach(b => b.onclick = () => openQuote(b.dataset.quote)); }
  function bindForms(){ document.querySelectorAll('.enquiry-form').forEach(form => form.onsubmit = async e => { e.preventDefault(); const fd = new FormData(form); const rec = { date:new Date().toLocaleString(), name:fd.get('name')||'', phone:fd.get('phone')||'', email:fd.get('email')||'', product:fd.get('product')||'', message:fd.get('message')||'' }; const list = enquiries(); list.unshift(rec); saveEnquiries(list); const url = state.integrations?.googleSheetUrl || ''; if(url){ try{ await fetch(url, { method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain'}, body:JSON.stringify(rec) }); }catch(err){} } toast('Enquiry submitted'); if(state.integrations?.redirectToWhatsapp) window.open(whatsappHref(`Hello NEXGEN CORPORATION, I want a quotation.\nName: ${rec.name}\nPhone: ${rec.phone}\nProduct: ${rec.product}\nMessage: ${rec.message}`), '_blank'); closeModal(); form.reset(); }); }
  function bindPublic(){ bindProductButtons(); bindForms(); document.getElementById('closeModal')?.addEventListener('click', closeModal); document.getElementById('quoteModal')?.addEventListener('click', e => { if(e.target.id === 'quoteModal') closeModal(); }); document.getElementById('searchBtn')?.addEventListener('click', filterProducts); document.getElementById('searchInput')?.addEventListener('input', filterProducts); document.getElementById('categorySelect')?.addEventListener('change', filterProducts); document.getElementById('menuBtn')?.addEventListener('click', () => document.getElementById('drawer')?.classList.add('show')); document.getElementById('closeDrawer')?.addEventListener('click', () => document.getElementById('drawer')?.classList.remove('show')); document.getElementById('drawer')?.addEventListener('click', e => { if(e.target.id === 'drawer') e.currentTarget.classList.remove('show'); }); document.getElementById('adminButton')?.addEventListener('click', () => go('admin')); }

  function login(target='admin'){
    app.innerHTML = `<main class="login-page"><div class="login-card"><img src="${esc(state.company.logo)}" alt="${esc(state.company.name)}"><h1>Admin Login</h1><p class="lead" style="text-align:center">Supabase authorized login</p><form id="loginForm" class="form"><label class="label">Email<input class="input" name="email" type="email" autocomplete="username" required></label><label class="label">Password<input class="input" name="password" type="password" autocomplete="current-password" required></label><button class="btn btn-gold" type="submit">Login</button><a class="btn btn-light" href="#home">Back to Website</a></form><p id="loginError" style="color:#be123c;font-weight:900"></p></div></main>`;
    document.getElementById('loginForm').onsubmit = async e => {
      e.preventDefault();
      const sb = getSupabase();
      const errEl = document.getElementById('loginError');
      if(!sb){ errEl.textContent = 'Supabase config missing.'; return; }
      const fd = new FormData(e.currentTarget);
      errEl.textContent = 'Logging in...';
      const { error } = await sb.auth.signInWithPassword({ email:String(fd.get('email')).trim(), password:String(fd.get('password')) });
      if(error){ errEl.textContent = error.message; return; }
      const u = await refreshAuthUser();
      if(!u || !isAdmin()){ errEl.textContent = 'This email is not allowed as admin.'; await logout(); return; }
      await loadRemoteSiteData();
      go(target === 'dashboard' ? 'admin' : target);
    };
  }
  function dashboard(){ if(!isAdmin()) return login('admin'); return renderAdmin(); }

  function adminShell(content, active='company'){
    return `<main class="admin-page"><header class="admin-header"><div class="container"><div><b>${esc(state.company.name)} Admin Panel</b><p style="margin:2px 0 0;color:#64748b;font-size:13px">Everything saves live in Supabase after Save Live</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-gold" id="saveLive">Save Live</button><a class="btn btn-light" href="#home">View Site</a><button class="btn btn-red" id="logoutBtn">Logout</button></div></div></header><div class="container admin-layout"><aside class="admin-menu">${[['company','Company & Home'],['products','Products'],['categories','Categories'],['gallery','Gallery'],['catalogue','Catalogue'],['seo','SEO & Google Sheet'],['enquiries','Enquiries'],['access','Access'],['backup','Backup / Restore']].map(([k,l])=>`<button data-admin-tab="${k}" class="${active===k?'active':''}">${l}</button>`).join('')}</aside><section class="admin-main" id="adminMain">${content}</section></div></main><div id="toast" class="toast"></div>`;
  }
  function renderAdmin(){ if(!isAdmin()) return login('admin'); app.innerHTML = adminShell(adminCompany(), 'company'); bindAdmin('company'); }
  function adminContent(tab){ const map = { company:adminCompany, products:adminProducts, categories:adminCategories, gallery:adminGallery, catalogue:adminCatalogue, seo:adminSeo, enquiries:adminEnquiries, access:adminAccess, backup:adminBackup }; app.innerHTML = adminShell((map[tab]||adminCompany)(), tab); bindAdmin(tab); }
  function input(path,label,value,type='text'){ return `<label class="label">${esc(label)}<input class="input admin-input" data-path="${esc(path)}" type="${type}" value="${esc(value)}"></label>`; }
  function textarea(path,label,value,rows=3){ return `<label class="label">${esc(label)}<textarea class="textarea admin-input" data-path="${esc(path)}" rows="${rows}">${esc(value)}</textarea></label>`; }
  function imageUpload(path, folder, label='Upload Image'){ return `<label class="label">${esc(label)}<input class="input admin-upload-file" type="file" accept="image/jpeg,image/png,image/webp" data-upload-path="${esc(path)}" data-upload-folder="${esc(folder)}"></label><button class="btn btn-gold admin-upload-btn" data-upload-button="${esc(path)}">Upload, Compress & Save Live</button>`; }
  function adminCompany(){ const c=state.company,h=state.hero,a=state.about; return `<h2>Company, Home and About</h2><p class="lead">Change text, phone, logo, about, services and save live.</p><div class="admin-row">${input('company.name','Company Name',c.name)}${input('company.tagline','Tagline',c.tagline)}${input('company.subTagline','Sub Tagline',c.subTagline)}${input('company.phone','Phone / WhatsApp Number',c.phone)}${input('company.secondaryPhone','Secondary Phone',c.secondaryPhone)}${input('company.email','Email',c.email)}${input('company.website','Website',c.website)}${input('company.established','Established',c.established)}${textarea('company.address','Address',c.address,3)}${input('company.mapLink','Google Map Link',c.mapLink)}${input('company.logo','Logo URL / Path',c.logo)}<div class="card card-pad"><img src="${esc(c.logo)}" style="background:#000;border-radius:12px;max-height:110px;margin-bottom:12px">${imageUpload('company.logo','logo','Upload Logo From Gallery')}</div>${input('hero.title','Home Title',h.title)}${textarea('hero.text','Home Text',h.text,4)}${input('hero.button1','Button 1',h.button1)}${input('hero.button2','Button 2',h.button2)}${input('about.title','About Title',a.title || 'About NEXGEN CORPORATION')}${textarea('about.text','About Text',a.text,6)}${textarea('about.points','About Points - one per line',(a.points||[]).join('\n'),6)}${textarea('services','Services - one per line',(state.services||[]).join('\n'),6)}</div>`; }
  function adminProducts(){ return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h2>Products</h2><button class="btn btn-gold" id="addProduct">Add Product</button></div><p class="lead">Change name, price, category, description and image. Image is compressed and saved live in Supabase Storage.</p><div class="search-box" style="grid-template-columns:1fr 220px"><input class="input" id="adminProductSearch" placeholder="Search product in admin"><select class="select" id="adminProductCat"><option value="all">All Categories</option>${state.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</select></div><div class="admin-list" id="adminProductList">${adminProductItems(state.products.map((_,i)=>i))}</div>`; }
  function adminProductItems(indices){ return indices.map(i=>{ const p=state.products[i]; return `<div class="admin-item"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(p.name)}</b><button class="btn btn-red" data-delete-product="${i}">Delete</button></div><div class="admin-product-edit"><div><img class="admin-product-thumb" src="${esc(p.image)}" alt="${esc(p.name)}"><label class="label">Upload Product Image<input class="input product-image-file" type="file" accept="image/jpeg,image/png,image/webp" data-product-file="${i}"></label><button class="btn btn-gold" data-upload-product-image="${i}" style="margin-top:10px;width:100%">Upload, Compress & Save Live</button></div><div class="admin-product-grid">${input(`products.${i}.name`,'Name',p.name)}<label class="label">Category<select class="select admin-input" data-path="products.${i}.categoryId">${state.categories.map(c=>`<option value="${esc(c.id)}" ${p.categoryId===c.id?'selected':''}>${esc(c.title)}</option>`).join('')}</select></label>${input(`products.${i}.price`,'Price',p.price)}${input(`products.${i}.image`,'Image URL / Path',p.image)}${textarea(`products.${i}.description`,'Description',p.description,4)}</div></div></div>`; }).join(''); }
  function adminCategories(){ return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2>Categories</h2><button class="btn btn-gold" id="addCategory">Add Category</button></div><p class="lead">Category title, subtitle and image are live editable.</p><div class="admin-list">${state.categories.map((c,i)=>`<div class="admin-item"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(c.title)}</b><button class="btn btn-red" data-delete-category="${i}">Delete</button></div><div class="admin-product-edit"><div><img class="admin-product-thumb" src="${esc(c.image)}" alt="${esc(c.title)}">${imageUpload(`categories.${i}.image`,'category','Upload Category Image')}</div><div class="admin-product-grid">${input(`categories.${i}.id`,'Category ID',c.id)}${input(`categories.${i}.title`,'Title',c.title)}${input(`categories.${i}.subtitle`,'Subtitle',c.subtitle)}${input(`categories.${i}.image`,'Image URL / Path',c.image)}${input(`categories.${i}.pdfPage`,'PDF Page',c.pdfPage)}</div></div></div>`).join('')}</div>`; }
  function adminGallery(){ return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2>Gallery</h2></div><p class="lead">Upload images from your gallery. Images will compress and go live.</p><div class="card card-pad" style="margin-bottom:18px"><div class="admin-row"><label class="label">Gallery Title<input class="input" id="galleryTitle" placeholder="Image title"></label><label class="label">Gallery Caption<input class="input" id="galleryCaption" placeholder="Short caption"></label><label class="label">Choose Image<input class="input" id="galleryUpload" type="file" accept="image/jpeg,image/png,image/webp"></label><div style="display:flex;align-items:end"><button class="btn btn-gold" id="addGalleryImage">Upload, Compress & Add Live</button></div></div></div><div class="gallery-grid">${state.gallery.map((g,i)=>`<div class="gallery-card card"><img src="${esc(g.url)}" alt="${esc(g.title)}"><div class="product-body">${input(`gallery.${i}.title`,'Title',g.title || '')}${textarea(`gallery.${i}.caption`,'Caption',g.caption || '',2)}${input(`gallery.${i}.url`,'Image URL',g.url || '')}<button class="btn btn-red" data-delete-gallery="${i}">Delete</button></div></div>`).join('')}</div>`; }
  function adminCatalogue(){ return `<h2>Catalogue Pages</h2><p class="lead">You can replace catalogue page images also.</p><div class="catalogue-grid">${state.cataloguePages.map((src,i)=>`<div class="catalogue-card"><div class="catalogue-title">Page ${i+1}</div><img loading="lazy" src="${esc(src)}" alt="Page ${i+1}"><div class="card-pad">${input(`cataloguePages.${i}`,'Image URL / Path',src)}${imageUpload(`cataloguePages.${i}`,'catalogue','Upload Page Image')}</div></div>`).join('')}</div>`; }
  function adminSeo(){ const s=state.seo||{}, i=state.integrations||{}; return `<h2>SEO & Google Sheet</h2><div class="admin-row">${input('seo.title','SEO Title',s.title)}${textarea('seo.description','SEO Description',s.description,4)}${textarea('seo.keywords','SEO Keywords',s.keywords,4)}${input('seo.url','Website URL',s.url)}${input('seo.image','SEO Image',s.image)}${input('integrations.emailTo','Enquiry Email',i.emailTo)}${input('integrations.googleSheetUrl','Google Sheet Web App URL',i.googleSheetUrl)}<label class="label">WhatsApp Redirect<select class="select admin-input" data-path="integrations.redirectToWhatsapp"><option value="true" ${i.redirectToWhatsapp?'selected':''}>true</option><option value="false" ${!i.redirectToWhatsapp?'selected':''}>false</option></select></label></div><div class="card card-pad" style="margin-top:16px"><b>Live Save</b><p>All content is saved in Supabase site_content table. Enquiries go to Google Sheet if Web App URL is added.</p></div>`; }
  function adminEnquiries(){ const list=enquiries(); return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2>Enquiries</h2><div><button class="btn btn-light" id="downloadCsv">CSV</button><button class="btn btn-red" id="clearEnquiries">Clear</button></div></div><p class="lead">Main enquiry data goes to Google Sheet. This shows local copy saved in this browser.</p><div style="overflow:auto"><table class="table"><thead><tr><th>Date</th><th>Name</th><th>Phone</th><th>Email</th><th>Product</th><th>Message</th></tr></thead><tbody>${list.map(e=>`<tr><td>${esc(e.date || '')}</td><td>${esc(e.name)}</td><td>${esc(e.phone)}</td><td>${esc(e.email)}</td><td>${esc(e.product)}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>`; }
  function adminAccess(){ const u=currentUser(); const cfg=supabaseConfig(); return `<h2>Supabase Authorized Login</h2><div class="grid grid-2"><div class="card card-pad"><b>Current User</b><p>${u ? esc(u.email) : 'Not logged in'}</p><p>${u ? esc(u.role) : ''}</p></div><div class="card card-pad"><b>Admin Emails</b><p>${esc((cfg.ADMIN_EMAILS || []).join(', ') || 'Not set')}</p></div></div><div class="card card-pad" style="margin-top:16px"><b>Data Storage</b><p>Supabase Auth = admin login. Supabase Database = live website content. Supabase Storage = uploaded compressed images.</p></div>`; }
  function adminBackup(){ return `<h2>Backup / Restore</h2><p class="lead">Download full JSON backup or paste old backup to restore.</p><div class="hero-buttons"><button class="btn btn-dark" id="downloadBackup">Download Backup</button><button class="btn btn-red" id="resetLocal">Reset Local Cache</button></div><label class="label" style="margin-top:16px">Restore JSON<textarea class="textarea" id="restoreJson" rows="8"></textarea></label><button class="btn btn-gold" id="restoreBackup">Restore & Save Live</button>`; }

  function bindAdmin(tab){
    document.querySelectorAll('[data-admin-tab]').forEach(b => b.onclick = () => adminContent(b.dataset.adminTab));
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    document.getElementById('saveLive')?.addEventListener('click', async e => { const b=e.currentTarget; const old=b.textContent; try{ b.textContent='Saving...'; b.disabled=true; await saveRemoteSiteData(); toast('Saved live successfully'); }catch(err){ alert(err.message || 'Save failed'); } finally{ b.textContent=old; b.disabled=false; } });
    document.querySelectorAll('.admin-input').forEach(el => el.oninput = () => { setPath(el.dataset.path, el.value); saveLocal(); });
    document.querySelectorAll('.admin-upload-btn').forEach(btn => btn.onclick = async () => {
      const path = btn.dataset.uploadButton;
      const inputEl = Array.from(document.querySelectorAll('.admin-upload-file')).find(el => el.dataset.uploadPath === path);
      const file = inputEl?.files?.[0];
      const folder = inputEl?.dataset.uploadFolder || 'general';
      const old = btn.textContent;
      try{ btn.textContent='Uploading...'; btn.disabled=true; const up = await uploadMedia(file, folder, path); setPath(path, up.url); await saveRemoteSiteData(); toast('Image uploaded and saved live'); adminContent(tab); }catch(err){ console.error(err); alert(err.message || 'Upload failed'); }finally{ btn.textContent=old; btn.disabled=false; }
    });
    document.getElementById('addProduct')?.addEventListener('click', () => { const c=state.categories[0] || {id:'general',title:'General',image:'assets/logo.png'}; state.products.unshift({id:'product-'+Date.now(),name:'New Product',categoryId:c.id,category:c.title,image:c.image,description:'Product description.',price:'Get Quote'}); saveLocal(); adminContent('products'); });
    document.querySelectorAll('[data-delete-product]').forEach(b => b.onclick = () => { if(confirm('Delete this product?')){ state.products.splice(Number(b.dataset.deleteProduct),1); saveLocal(); adminContent('products'); } });
    document.querySelectorAll('[data-upload-product-image]').forEach(b => b.onclick = async () => { const idx=Number(b.dataset.uploadProductImage); const file=document.querySelector(`[data-product-file="${idx}"]`)?.files?.[0]; const old=b.textContent; try{ b.textContent='Uploading...'; b.disabled=true; const up=await uploadMedia(file, 'products', state.products[idx]?.name || 'product'); state.products[idx].image=up.url; await saveRemoteSiteData(); toast('Product image saved live'); adminContent('products'); }catch(err){ console.error(err); alert(err.message || 'Image upload failed'); }finally{ b.textContent=old; b.disabled=false; } });
    document.getElementById('adminProductSearch')?.addEventListener('input', filterAdminProducts);
    document.getElementById('adminProductCat')?.addEventListener('change', filterAdminProducts);
    document.getElementById('addCategory')?.addEventListener('click', () => { state.categories.push({id:'category-'+Date.now(),title:'New Category',subtitle:'Category description.',image:'assets/logo.png',pdfPage:''}); saveLocal(); adminContent('categories'); });
    document.querySelectorAll('[data-delete-category]').forEach(b => b.onclick = () => { if(confirm('Delete this category?')){ state.categories.splice(Number(b.dataset.deleteCategory),1); saveLocal(); adminContent('categories'); } });
    document.getElementById('addGalleryImage')?.addEventListener('click', async e => { const b=e.currentTarget; const old=b.textContent; try{ const file=document.getElementById('galleryUpload')?.files?.[0]; b.textContent='Uploading...'; b.disabled=true; const title=document.getElementById('galleryTitle')?.value || 'Gallery Image'; const caption=document.getElementById('galleryCaption')?.value || ''; const up=await uploadMedia(file,'gallery',title); state.gallery.unshift({title,caption,url:up.url,path:up.path,date:new Date().toISOString()}); await saveRemoteSiteData(); toast('Gallery image saved live'); adminContent('gallery'); }catch(err){ console.error(err); alert(err.message || 'Gallery upload failed'); }finally{ b.textContent=old; b.disabled=false; } });
    document.querySelectorAll('[data-delete-gallery]').forEach(b => b.onclick = () => { if(confirm('Delete this gallery image?')){ state.gallery.splice(Number(b.dataset.deleteGallery),1); saveLocal(); adminContent('gallery'); } });
    document.getElementById('clearEnquiries')?.addEventListener('click', () => { saveEnquiries([]); adminContent('enquiries'); });
    document.getElementById('downloadCsv')?.addEventListener('click', downloadCsv);
    document.getElementById('downloadBackup')?.addEventListener('click', downloadBackup);
    document.getElementById('resetLocal')?.addEventListener('click', () => { if(confirm('Reset local cache? Remote live data will stay.')){ localStorage.removeItem(STORE_KEY); state=normalize(clone(SITE_DATA)); saveLocal(); adminContent('backup'); } });
    document.getElementById('restoreBackup')?.addEventListener('click', async () => { try{ const parsed=JSON.parse(document.getElementById('restoreJson').value); state=normalize(parsed); await saveRemoteSiteData(); toast('Backup restored and saved live'); adminContent('backup'); }catch(err){ alert('Invalid JSON or save failed: '+(err.message||err)); } });
  }
  function filterAdminProducts(){ const q=(document.getElementById('adminProductSearch')?.value||'').toLowerCase(); const cat=document.getElementById('adminProductCat')?.value||'all'; const idxs=[]; state.products.forEach((p,i)=>{ if((cat==='all'||p.categoryId===cat) && (`${p.name} ${p.category} ${p.description}`.toLowerCase().includes(q))) idxs.push(i); }); document.getElementById('adminProductList').innerHTML=adminProductItems(idxs); bindAdmin('products'); }
  function setPath(path,value){ const parts=String(path).split('.'); let obj=state; for(let i=0;i<parts.length-1;i++){ const key=parts[i]; if(obj[key] === undefined) obj[key] = isFinite(Number(parts[i+1])) ? [] : {}; obj=obj[key]; } const last=parts[parts.length-1]; if(path==='about.points' || path==='services') obj[last]=String(value).split('\n').map(x=>x.trim()).filter(Boolean); else if(value==='true' || value==='false') obj[last]=(value==='true'); else obj[last]=value; if(path.includes('products.') && path.endsWith('.categoryId')){ const idx=Number(parts[1]); const c=category(value); if(c && state.products[idx]) state.products[idx].category=c.title; } }
  function downloadCsv(){ const rows=enquiries(), cols=['date','name','phone','email','product','message']; const csv=[cols.join(',')].concat(rows.map(r => cols.map(c => '"'+String(r[c]||'').replace(/"/g,'""')+'"').join(','))).join('\n'); const blob=new Blob([csv],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='nexgen-enquiries.csv'; a.click(); URL.revokeObjectURL(a.href); }
  function downloadBackup(){ const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='nexgen-website-backup.json'; a.click(); URL.revokeObjectURL(a.href); }

  function render(){ const r=route(); if(r==='login') return login('admin'); if(r==='dashboard') return dashboard(); if(r==='admin') return renderAdmin(); if(r==='home') app.innerHTML=home(); else if(r==='products') app.innerHTML=products(); else if(r==='about') app.innerHTML=about(); else if(r==='catalogue') app.innerHTML=catalogue(); else if(r==='gallery') app.innerHTML=gallery(); else if(r==='contact') app.innerHTML=contact(); else if(r.startsWith('category/')) app.innerHTML=categoryPage(r.split('/')[1]); else app.innerHTML=home(); bindPublic(); }
  async function init(){ const sb=getSupabase(); if(sb){ await refreshAuthUser(); await loadRemoteSiteData(); sb.auth.onAuthStateChange(async () => { await refreshAuthUser(); if(['admin','dashboard','login'].includes(route())) render(); }); } render(); }
  window.addEventListener('hashchange', async () => { await refreshAuthUser(); render(); });
  init();
})();
