/* Generated after next build. This worker never opens the student's database. */
const manifest = /* OFFLINE_MANIFEST */ null;
const cacheName = `quiz-screen-v1-${manifest.build}`;
const documentPath = '/quiz-offline';
const hashes = { [documentPath]: manifest.html, ...manifest.assets };
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
async function complete() {
  const cache = await caches.open(cacheName);
  return (await Promise.all(Object.keys(hashes).map(key => cache.match(key)))).every(Boolean);
}
let restoring = null;
function restoreAssets() {
  if (restoring) return restoring;
  restoring = navigator.locks.request('quiz-offline-assets-v1', { ifAvailable: true }, async lock => {
    // Leave the previous worker intact if any tab is currently taking a test.
    if (!lock) throw Error('quiz is using its prepared screen');
    const cache = await caches.open(cacheName);
    // Install is a preparation gate, never a background download during play.
    for (const [key, hash] of Object.entries(hashes)) {
      if (await cache.match(key)) continue;
      const response = await fetch(key, { cache: 'reload', credentials: 'same-origin', redirect: 'error',
        ...(key === documentPath ? { headers: { 'x-vercel-skip-toolbar': '1' } } : {}) });
      if (!response.ok || response.type === 'opaque' || await digest(await response.clone().arrayBuffer()) !== hash) throw Error('offline asset changed or unavailable');
      await cache.put(key, response);
    }
    return true;
  }).finally(() => { restoring = null; });
  return restoring;
}
self.addEventListener('install', event => {
  event.waitUntil(restoreAssets());
});
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
// No skipWaiting or cache deletion: an open test retains its complete build.
self.addEventListener('message', event => {
  if (event.data?.type === 'LOCAL_QUIZ_READY' && event.ports[0]) event.waitUntil(complete().then(ready => event.ports[0].postMessage({ ready, build: manifest.build })));
  if (event.data?.type === 'LOCAL_QUIZ_REPAIR' && event.ports[0]) event.waitUntil(restoreAssets().then(
    () => complete(), () => false).then(ready => event.ports[0].postMessage({ ready, build: manifest.build })));
});
self.addEventListener('fetch', event => {
  const request = event.request; const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || ['RSC', 'Next-Router-State-Tree', 'Next-Router-Prefetch', 'Next-Action'].some(h => request.headers.has(h)) || url.searchParams.has('_rsc')) return;
  const key = url.pathname + url.search;
  if (key === documentPath ? request.mode !== 'navigate' : !Object.hasOwn(manifest.assets, key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const response = await cache.match(key);
    if (response) return response;
    // A missing document/chunk can prevent the app from mounting at all.
    // Repair public files only before play, under the same exclusive lock.
    try { await restoreAssets(); const repaired = await cache.match(key); if (repaired) return repaired; } catch { /* Preserve IDB answers and the old screen cache. */ }
    const message = '화면 자료를 준비하지 못했습니다. 연결을 확인하고, 다른 탭에서 진행 중인 시험을 닫은 뒤 다시 열어 주세요. 기기에 보관한 답은 삭제하지 않았습니다.';
    return new Response(request.mode === 'navigate'
      ? '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>시험 화면 복구</title><main><p>'+message+'</p><button onclick="location.reload()">다시 열기</button></main></html>' : message,
      { status: 503, headers: { 'Content-Type': request.mode === 'navigate' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  })());
});
