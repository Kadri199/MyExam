
const CACHE_NAME = "my-exam-v30";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./reading.html",
  "./multiplication-game.html",
  "./decimal-fractions-game.html",
  "./admin.html",
  "./exam-editor.html",
  "./style.css",
  "./einstein-avatar.png",
  "./student.js",
  "./admin.js",
  "./exam-editor.js",
  "./exam-bank.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Do not cache Firebase or other external requests.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});


/* Firebase Cloud Messaging background support */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey: "AIzaSyDm-DVhhxwpR6yOaUhtVg3UXaih7Kdq5Hc",
  authDomain: "my-exam-45cac.firebaseapp.com",
  projectId: "my-exam-45cac",
  storageBucket: "my-exam-45cac.firebasestorage.app",
  messagingSenderId: "69950531358",
  appId: "1:69950531358:web:7568b58ac8c9be29dacb0f"
});
const kadriMessaging = firebase.messaging();
kadriMessaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || "Kadri_Class";
  self.registration.showNotification(title, {
    body: payload.notification?.body || "",
    icon: "./app-icon.jpg",
    data: payload.data || {}
  });
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) if ("focus" in client) return client.focus();
    return clients.openWindow("./");
  }));
});
