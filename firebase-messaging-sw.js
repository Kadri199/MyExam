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

const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || "Kadri_Class";
  const options = {
    body: payload.notification?.body || "",
    icon: "./app-icon.jpg",
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if ("focus" in client) return client.focus();
    }
    return clients.openWindow("./");
  }));
});
