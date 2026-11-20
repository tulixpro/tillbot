const CACHE="tillbot-pages-v100";
const CORE=["./","./index.html","./studio.html","./studio-manifest.json?v=1","./core-demo.html","./style.css?v=72","./app.js?v=77","./manifest.json?v=10","./icons/tillbot.svg?v=8","./icons/tillbot-dark.svg"];
self.addEventListener("install",event=>{event.waitUntil((async()=>{const cache=await caches.open(CACHE);await Promise.allSettled(CORE.map(async url=>{const r=await fetch(url,{cache:"reload"});if(r.ok)await cache.put(url,r)}));await self.skipWaiting()})())});
self.addEventListener("activate",event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith("tillbot-pages-")&&k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim()})())});
self.addEventListener("fetch",event=>{
 const req=event.request;if(req.method!=="GET"||new URL(req.url).origin!==self.location.origin)return;
 const url=new URL(req.url);
 // Always fetch app code and documents from the network first to avoid stale login code.
 const isCritical=url.pathname.endsWith(".js")||url.pathname.endsWith(".css")||url.pathname.endsWith(".html")||req.mode==="navigate";
 if(isCritical){event.respondWith(fetch(req,{cache:"no-store"}).then(async r=>{if(r.ok){const c=await caches.open(CACHE);await c.put(req,r.clone())}return r}).catch(()=>caches.match(req).then(r=>r||caches.match("./index.html"))));return}
 event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(async r=>{if(r.ok){const c=await caches.open(CACHE);await c.put(req,r.clone())}return r})))
});
