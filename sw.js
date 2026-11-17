const CACHE='manahorde-shell-v72';
const SHELL=['./','./index.html','./styles.css','./app.js','./core.js','./drive.js','./prices.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=='GET')return;
 if(u.origin===location.origin){e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.match(e.request).then(r=>r||(e.request.mode==='navigate'?caches.match('./index.html'):Response.error()))));}
 // Only cache images the user has actually viewed. Card data is stored in IndexedDB.
 else if(u.hostname==='cards.scryfall.io'){e.respondWith(caches.open(CACHE).then(async c=>{const cached=await c.match(e.request);if(cached)return cached;try{const r=await fetch(e.request);if(r.ok||r.type==='opaque'){const keys=await c.keys();const imgs=keys.filter(k=>new URL(k.url).hostname==='cards.scryfall.io');if(imgs.length>=250)await c.delete(imgs[0]);await c.put(e.request,r.clone());}return r;}catch{return Response.error();}}));}
});
