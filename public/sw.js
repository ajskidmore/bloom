/* Bloom service worker: only shows notifications and opens the app when one is tapped.
   It does not cache anything, so deploys show up right away. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.location.origin));
    if (win) { await win.focus(); try { await win.navigate(url); } catch {} return; }
    await self.clients.openWindow(url);
  })());
});
