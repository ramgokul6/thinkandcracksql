const CACHE='crack-sql-google-v4';
const ROOT=new URL('./',self.location).href;
const SHELL=['index.html','manifest.json','icon-512.png','icon-maskable-512.png','apple-touch-icon.png',
'data/scenarios.json','js/app.js','js/thinking.js','js/progress.js','js/cloud.js','js/schema.js','js/util.js'].map(p=>new URL(p,ROOT).href);
self.addEventListener('install',event=>{
  // Fail installation as a unit if an asset is absent. Keep the last working version.
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('crack-sql-')&&k!==CACHE).map(k=>caches.delete(k)))));
});
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin)return;
  const isNavigation=req.mode==='navigate';
  if(!isNavigation&&!SHELL.includes(url.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // Shell and scenario data are versioned together. Bump CACHE with every release.
    const cached=await cache.match(isNavigation?new URL('index.html',ROOT).href:req);
    if(cached)return cached;
    return fetch(req);
  })());
});
