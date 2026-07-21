const CACHE = 'samakeovers-v3';
const CORE = ['/', '/index.html', '/styles.css', '/app.js'];

// Background push (automatic appointment reminders). `self` (not `window`) so
// firebase-config.js works when imported here.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
importScripts('./firebase-config.js');
if (self.ASHA_FIREBASE_CONFIG && self.ASHA_FIREBASE_CONFIG.apiKey !== 'PASTE_API_KEY_HERE') {
  firebase.initializeApp(self.ASHA_FIREBASE_CONFIG);
  // Just initializing this here is enough -- the Firebase Messaging SW
  // integration automatically shows a notification for any push carrying a
  // `notification` payload (which is what the reminder Cloud Function sends)
  // even while the app isn't open or in focus.
  firebase.messaging();
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first: always prefer the latest file when online, fall back to cache only when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
