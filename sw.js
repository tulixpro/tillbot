const CACHE="tillbot-pages-v50";
const CORE=["./","./index.html","./studio.html","./studio-manifest.json?v=1","./style.css?v=30","./app.js?v=40","./manifest.json?v=9","./icons/tillbot.svg","./icons/tillbot-dark.svg"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(async cache=>{await Promise.allSettled(CORE.map(async url=>{const response=await fetch(url,{cache:"reload"});if(response.ok)await cache.put(url,response)}));await self.skipWaiting()}))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("tillbot-pages-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",event=>{const req=event.request;if(req.method!=="GET"||new URL(req.url).origin!==self.location.origin)return;
if(req.mode==="navigate"){event.respondWith(fetch(req).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(req.url,copy))}return response}).catch(()=>caches.match(req.url).then(x=>x||caches.match("./index.html"))));return}
event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(req,copy))}return response})))});
