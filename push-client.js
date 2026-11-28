import { Capacitor } from "https://esm.sh/@capacitor/core@7.4.3";
import { PushNotifications } from "https://esm.sh/@capacitor/push-notifications@7.0.2";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const VAPID_KEY = "BEuDLpWGSl8H_c9WCqyd5h3Ip4m5HtwZoxW8--Toexb1sF13o_udKISDIfP0vQS8PNlfxM1bvlpr-hA8gxknwAg";
const app = (await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js")).getApps().length
  ? (await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js")).getApp()
  : (await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js")).initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function saveToken(token, role, platform) {
  const user = auth.currentUser;
  if (!user || !token) throw new Error("سجّل الدخول أولاً ثم أعد المحاولة.");
  const id = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const docId = [...new Uint8Array(id)].map(x => x.toString(16).padStart(2, "0")).join("");
  await setDoc(doc(db, "pushDevices", docId), {
    uid: user.uid, role, token, platform, updatedAt: serverTimestamp()
  }, { merge: true });
}

async function enableNative(role) {
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive !== "granted") permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") throw new Error("لم تسمح بإرسال الإشعارات. يمكنك تفعيلها من إعدادات الهاتف.");
  await PushNotifications.addListener("registration", async ({ value }) => {
    try {
      await saveToken(value, role, "android");
      document.dispatchEvent(new CustomEvent("kadri-push-enabled"));
    } catch (error) { console.error("Saving Android push token failed:", error); }
  });
  await PushNotifications.addListener("registrationError", error => {
    console.error("Android push registration error:", error);
  });
  await PushNotifications.addListener("pushNotificationReceived", notification => {
    console.info("Kadri_Class notification received:", notification.title || "");
  });
  await PushNotifications.register();
}

async function enableWeb(role) {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    throw new Error("هذا المتصفح لا يدعم الإشعارات.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("لم تسمح بإرسال الإشعارات.");
  const registration = await navigator.serviceWorker.register("./service-worker.js");
  if (!(await isSupported())) throw new Error("خدمة الإشعارات غير مدعومة في هذا المتصفح.");
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error("لم يتم إنشاء رمز الإشعارات. حاول مجدداً.");
  await saveToken(token, role, "web");
  onMessage(messaging, payload => {
    const title = payload.notification?.title || "Kadri_Class";
    const options = {
      body: payload.notification?.body || "",
      icon: "./app-icon.jpg",
      data: payload.data || {}
    };
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, options));
  });
}

export async function enableKadriNotifications(role) {
  if (Capacitor.isNativePlatform()) return enableNative(role);
  return enableWeb(role);
}

window.enableKadriNotifications = enableKadriNotifications;
