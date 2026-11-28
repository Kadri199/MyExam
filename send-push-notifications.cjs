const admin = require("firebase-admin");

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON secret is missing.");
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();
  const messaging = admin.messaging();
  const now = Date.now();
  const schedulerRef = db.doc("settings/pushScheduler");
  const schedulerSnap = await schedulerRef.get();
  const scheduler = schedulerSnap.exists ? schedulerSnap.data() : {};

  const devicesSnap = await db.collection("pushDevices").get();
  const devices = devicesSnap.docs.map(d => ({ ref: d.ref, ...d.data() })).filter(d => typeof d.token === "string" && d.token.length > 20);

  async function sendAll(title, body, tag, targetDevices = devices) {
    if (!targetDevices.length) {
      console.log("No registered devices; skipped:", tag);
      return 0;
    }
    let success = 0;
    const invalidRefs = [];
    for (let i = 0; i < targetDevices.length; i += 500) {
      const batch = targetDevices.slice(i, i + 500);
      const response = await messaging.sendEachForMulticast({
        tokens: batch.map(d => d.token),
        notification: { title, body },
        data: { source: tag, url: "https://kadri199.github.io/MyExam/" },
        android: { priority: "high", notification: { channelId: "kadri-class", sound: "default" } },
        webpush: { headers: { Urgency: "high" }, notification: { icon: "https://kadri199.github.io/MyExam/app-icon.jpg", tag } }
      });
      success += response.successCount;
      response.responses.forEach((result, index) => {
        if (!result.success && [
          "messaging/registration-token-not-registered",
          "messaging/invalid-registration-token"
        ].includes(result.error?.code)) invalidRefs.push(batch[index].ref);
      });
    }
    if (invalidRefs.length) {
      const batch = db.batch();
      invalidRefs.forEach(ref => batch.delete(ref));
      await batch.commit();
    }
    console.log(tag + ": delivered to " + success + " device(s); invalid tokens removed: " + invalidRefs.length);
    return success;
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(now));
  const part = key => parts.find(p => p.type === key)?.value;
  const localDate = part("year") + "-" + part("month") + "-" + part("day");
  const localHour = Number(part("hour"));

  if (process.env.SEND_TEST_PUSH === "true") {
    await sendAll(
      "🔔 اختبار إشعارات Kadri_Class",
      "إذا وصلتك هذه الرسالة، فقد نجح إرسال الإشعارات إلى جهازك.",
      "manual-test-" + now
    );
  }

  // Daily 19:00 reminder (Algeria time). GitHub's scheduler polls every five minutes.
  if (localHour >= 19 && scheduler.lastDailyDate !== localDate) {
    const sent = await sendAll(
      "🌙 تذكير يومي من Kadri_Class",
      "لا تنسَ زيارة Kadri_Class اليوم! اطّلع على ترتيبك وترتيب زملائك، وتابع تقدمك نحو التفوق. 🏆",
      "daily-" + localDate
    );
    if (sent > 0) await schedulerRef.set({ lastDailyDate: localDate }, { merge: true });
  }

  // One-time alert when Wazifa 3 is the active published test.
  const examsSnap = await db.doc("settings/exams").get();
  const activeTestId = examsSnap.exists ? (examsSnap.data().activeTestId || "") : "";
  if (activeTestId === "wazifa3" && scheduler.lastWazifa3Notified !== "wazifa3") {
    // Exclude pupils who have already submitted Wazifa 3; keep teacher devices eligible.
    const submittedSnap = await db.collection("submissions")
      .where("testId", "==", "wazifa3")
      .get();
    const submittedUids = new Set(
      submittedSnap.docs.map(doc => doc.data().studentUid).filter(Boolean)
    );
    const wazifa3Devices = devices.filter(device =>
      device.role === "teacher" || !submittedUids.has(device.uid)
    );
    const sent = await sendAll(
      "📝 تم نشر الوظيفة 03",
      "الوظيفة 03 متاحة الآن على Kadri_Class. ادخل إلى ملفك الشخصي وابدأ الإنجاز!",
      "wazifa3",
      wazifa3Devices
    );
    if (sent > 0) await schedulerRef.set({ lastWazifa3Notified: "wazifa3" }, { merge: true });
  }

  // Notify teacher devices once for every new pupil submission.
  // Establish a baseline on first deployment so old submissions do not trigger a flood.
  const teacherDevices = devices.filter(device => device.role === "teacher");
  const submissionPushStart = scheduler.teacherSubmissionPushStartedAt?.toMillis?.() ?? 0;
  if (!submissionPushStart) {
    await schedulerRef.set({
      teacherSubmissionPushStartedAt: admin.firestore.Timestamp.fromMillis(now)
    }, { merge: true });
    console.log("Teacher submission alerts initialized; existing submissions will not be replayed.");
  } else if (teacherDevices.length) {
    const submissionsSnap = await db.collection("submissions").get();
    const newSubmissions = submissionsSnap.docs.filter(doc => {
      const data = doc.data();
      const createdAt = data.createdAt?.toMillis?.() ?? 0;
      return createdAt >= submissionPushStart && !data.teacherPushSentAt;
    });

    for (const submissionDoc of newSubmissions) {
      const item = submissionDoc.data();
      const pupilName = item.name || "تلميذ";
      const className = item.studentClass || "";
      const testName = item.testName || item.testId || "اختبار";
      const body = pupilName + (className ? " — " + className : "") +
        " أرسل " + testName + ".";
      const sent = await sendAll(
        "📥 إجابة جديدة من تلميذ",
        body,
        "pupil-submission-" + submissionDoc.id,
        teacherDevices
      );
      if (sent > 0) {
        await submissionDoc.ref.update({
          teacherPushSentAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
  }

  // Each recent announcement repeats hourly. Deleting its document stops future sends.
  const announcementsSnap = await db.collection("announcements").get();
  for (const announcementDoc of announcementsSnap.docs) {
    const item = announcementDoc.data();
    const createdAt = item.createdAt?.toMillis?.() ?? 0;
    const lastSentAt = item.pushLastSentAt?.toMillis?.() ?? 0;
    if (!createdAt || now - createdAt > 24 * 60 * 60 * 1000) continue;
    if (lastSentAt && now - lastSentAt < 60 * 60 * 1000) continue;
    const sent = await sendAll(
      "📢 " + (item.title || "إشعار هام من الأستاذ"),
      item.message || "",
      "announcement-" + announcementDoc.id
    );
    if (sent > 0) {
      await announcementDoc.ref.update({ pushLastSentAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  }
}

main().catch(error => {
  console.error("Push notification job failed:", error);
  process.exitCode = 1;
});
