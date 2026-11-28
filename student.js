
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getFirestore, doc, getDoc, collection, serverTimestamp,
  getDocs, query, where, setDoc, writeBatch, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getAuth, createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const $ = id => document.getElementById(id);

let quiz, name = "", studentClass = "", page = 0;
let authMode = "login";
let answers = {};
let answerFile = null;
let activeTestId="wazifa2", activeTestName="وظيفة 2";

// Public ranking real-time listener
let rankingUnsubscribe = null;
let rankingSelectedClass = null;

const classes = ["Class 9", "Class 10", "Class 11", "Class 12"];

const defaultQuiz = {
  title: "اختبار الرياضيات",
  mcq: Array.from({ length: 16 }, (_, i) => ({
    q: `السؤال ${i + 1} — أضف نص السؤال من لوحة الأستاذ`,
    options: ["الخيار الأول", "الخيار الثاني", "الخيار الثالث"],
    correct: 0
  })),
  imageQuestions: [
    { q: "السؤال 17 — أرفق صورة الحل الكامل" }
  ]
};

function notice(message) {
  $("notice").textContent = message;
  $("notice").classList.remove("hidden");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Public announcements are visible to every visitor, even before login.
// Keep the list live so new teacher posts appear without refreshing.
function watchHomeAnnouncements() {
  const container = $("homeAnnouncementsList");
  if (!container) return;

  onSnapshot(collection(db, "announcements"), snapshot => {
    const announcements = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const time = value => value?.toMillis?.() ?? (value?.seconds ? value.seconds * 1000 : 0);
        return time(b.createdAt) - time(a.createdAt);
      });

    container.innerHTML = announcements.length
      ? announcements.map(item => {
          const date = item.createdAt?.toDate
            ? item.createdAt.toDate().toLocaleString("ar-DZ")
            : "";
          return `
            <article style="padding:12px 0;border-top:1px solid #7f1d1d;color:#ef4444;">
              <h3 style="margin:0 0 5px;color:#ef4444;font-size:17px;">${esc(item.title || "إشعار هام")}</h3>
              <p style="margin:0;color:#f87171;white-space:pre-wrap;line-height:1.8;">${esc(item.message || "")}</p>
              ${date ? `<small style="display:block;margin-top:6px;color:#fca5a5;">${esc(date)}</small>` : ""}
            </article>`;
        }).join("")
      : '<p style="margin:0;color:#f87171;">لا توجد إشعارات جديدة من الأستاذ حالياً.</p>';
  }, error => {
    console.error("Home announcements listener error:", error);
    container.innerHTML = '<p style="margin:0;color:#f87171;">تعذر تحميل الإشعارات حالياً.</p>';
  });
}


// Create a private Firebase Auth alias from the pupil's name, class and PIN.
// Pupils never see or need to enter this generated alias.
async function makeStudentAuthEmail(fullName, classId, pin) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("المتصفح لا يدعم إنشاء الحساب الآمن. حدّث المتصفح وحاول مجدداً.");
  }
  const normalizedName = String(fullName).normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  const source = classId + "|" + normalizedName + "|" + pin;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return "student-" + hash + "@kadri-class.com";
}

// Convert text containing \( LaTeX \) into readable mathematical formulas.
function formatMathText(value) {
  const text = String(value ?? "");
  const open = "\\(";
  const close = "\\)";

  let result = "";
  let position = 0;

  while (position < text.length) {
    const start = text.indexOf(open, position);

    if (start === -1) {
      result += esc(text.slice(position));
      break;
    }

    result += esc(text.slice(position, start));

    const end = text.indexOf(close, start + open.length);

    if (end === -1) {
      result += esc(text.slice(start));
      break;
    }

    const latex = text.slice(start + open.length, end);

    result += `
      <math-field
        read-only
        virtual-keyboard-mode="off"
        data-math-latex="${esc(latex)}"
        style="display:inline-block;border:none;background:transparent;padding:0;margin:0 3px;pointer-events:none;vertical-align:middle;min-width:0;"
      ></math-field>
    `;

    position = end + close.length;
  }

  return result;
}

// Activate mathematical expressions after rendering.
function activateMathFields() {
  document.querySelectorAll("#questions math-field[data-math-latex]")
    .forEach(field => {
      field.value = field.dataset.mathLatex;
      field.readOnly = true;
    });
}

async function loadQuiz() {
  const snap = await getDoc(doc(db, "examTests", activeTestId));
  quiz = snap.exists() ? snap.data() : defaultQuiz;

  if (!Array.isArray(quiz.mcq) || quiz.mcq.length !== 16) {
    throw new Error("يجب أن يحتوي الاختبار على 16 سؤال اختيار من متعدد.");
  }

  if (!Array.isArray(quiz.imageQuestions) ||
      !quiz.imageQuestions.length) {
    quiz.imageQuestions = defaultQuiz.imageQuestions;
  }
}

/* =========================================
   PUBLIC RANKING ON HOME PAGE
========================================= */

// Stop the previous real-time listener.
function stopRankingListener() {
  if (rankingUnsubscribe) {
    rankingUnsubscribe();
    rankingUnsubscribe = null;
  } 
}
function getFinalScore(student) {
  const manual = student.handwrittenMark;

  if (manual === null || manual === undefined || manual === "") {
    return null;
  }

  return Number(student.score || 0) + Number(manual);
}

function getRankMedal(rank) {
  if (rank === 1) return '<span class="rank-medal gold" title="المركز الأول — الميدالية الذهبية">🥇 ذهبية</span>';
  if (rank === 2) return '<span class="rank-medal silver" title="المركز الثاني — الميدالية الفضية">🥈 فضية</span>';
  if (rank === 3) return '<span class="rank-medal bronze" title="المركز الثالث — الميدالية البرونزية">🥉 برونزية</span>';
  return "";
}

// Use the corrected /20 mark when available; otherwise rank provisionally by MCQ /16.
function getRankingScore(student) {
  const manual = student.handwrittenMark;
  return Number(student.score || 0) + (manual === null || manual === undefined || manual === "" ? 0 : Number(manual));
}

function sortByFinalScore(a, b) {
  return getRankingScore(b) - getRankingScore(a);
}

// Render public ranking.
function renderPublicRanking(snapshot, selectedClass) {
  const students = snapshot.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));

  // Sort by final mark /20; uncorrected pupils stay at the bottom.
students.sort(sortByFinalScore);

  if (!students.length) {
    $("rankingResults").innerHTML = `
      <h3>🏆 ترتيب ${esc(selectedClass)}</h3>
      <p>لا توجد نتائج في هذا القسم حالياً.</p>
    `;
    return;
  }

  let rows = "";

students.forEach((student, index) => {
  const studentScore = Number(student.score || 0);
  // Always show a visible position, including while handwritten marks are pending.
  const currentRank = index + 1;

    const manual = student.handwrittenMark;

    const finalMark =
      manual === null || manual === undefined || manual === ""
        ? "—"
        : `${(studentScore + Number(manual)).toFixed(2)}`;

    rows += `
      <tr>
        <td style="padding:10px;text-align:center;">
          ${currentRank} ${getRankMedal(currentRank)}
        </td>

        <td style="padding:10px;">
          ${esc(student.name)}
        </td>

        <td style="padding:10px;text-align:center;direction:ltr;">
          <strong>${studentScore}</strong> /16
        </td>

        <td style="padding:10px;text-align:center;direction:ltr;">
          <strong>${finalMark}</strong> /20
        </td>
      </tr>
    `;
  });

  $("rankingResults").innerHTML = `
    <h3 style="margin-bottom:12px;">
      🏆 ترتيب ${esc(selectedClass)}
    </h3>

    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;text-align:right;">
        <thead>
          <tr style="background:#f1f1f1;">
            <th style="padding:10px;text-align:center;">الترتيب والجوائز</th>
            <th style="padding:10px;">اسم التلميذ</th>
            <th style="padding:10px;text-align:center;">العلامة /16</th>
            <th style="padding:10px;text-align:center;">العلامة النهائية /20</th>
          </tr>
        </thead>

        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// Open the ranking page.
$("showRankingBtn").onclick = async () => {
  stopRankingListener();
  let rankingTests=[{id:"wazifa2",title:"وظيفة 2"}];
  let activeRankingTestId="wazifa2";
  try {
    const metaSnap=await getDoc(doc(db,"settings","exams"));
    if(metaSnap.exists()) {
      const metaData=metaSnap.data();
      if(Array.isArray(metaData.tests) && metaData.tests.length) rankingTests=metaData.tests;
      // Always open the public ranking on the currently active/published exam.
      activeRankingTestId=metaData.activeTestId || activeRankingTestId;
    }
  } catch(e){ console.warn("Could not load active exam for public ranking:",e); }
  if(!rankingTests.some(t=>t.id===activeRankingTestId)) {
    rankingTests.unshift({id:activeRankingTestId,title:activeRankingTestId==="wazifa3"?"وظيفة 3":"الاختبار النشط"});
  }

  $("startCard").classList.add("hidden");
  $("rankingCard").classList.remove("hidden");
  $("notice").classList.add("hidden");

  $("rankingClasses").innerHTML = `
    <label for="rankingTestSelect">اختر الاختبار</label>
    <select id="rankingTestSelect" style="width:100%;margin-bottom:12px;">
      ${rankingTests.map(t=>`<option value="${esc(t.id)}" ${t.id===activeRankingTestId?"selected":""}>${esc(t.title)}</option>`).join("")}
    </select>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:18px 0;">
      ${classes.map(className => `
        <button
          type="button"
          class="secondary ranking-class-btn"
          data-class="${className}"
          style="width:100%;"
        >
          ${className}
        </button>
      `).join("")}
    </div>
  `;

  $("rankingResults").innerHTML = `
    <p class="muted small">اختر الاختبار ثم القسم لعرض الترتيب.</p>
  `;
  const testSelect = $("rankingTestSelect");
  if (testSelect) testSelect.onchange = () => {
    const chosen = [...document.querySelectorAll(".ranking-class-btn")].find(b => b.dataset.class === rankingSelectedClass);
    if (chosen) chosen.click();
    else $("rankingResults").innerHTML = '<p class="muted small">اختر القسم لعرض الترتيب.</p>';
  };
};

// Select a class and listen for live ranking updates.
$("rankingClasses").onclick = event => {
  const button = event.target.closest("[data-class]");

  if (!button) return;

  const selectedClass = button.dataset.class;
  rankingSelectedClass = selectedClass;
  const selectedTest = $("rankingTestSelect")?.value || "wazifa2";

  if (!classes.includes(selectedClass)) return;

  // Stop listening to the previously selected class.
  stopRankingListener();

  document.querySelectorAll(".ranking-class-btn").forEach(btn => {
    btn.disabled = false;
    btn.style.opacity = btn.dataset.class === selectedClass ? "1" : "0.7";
  });

  $("rankingResults").innerHTML = `
    <p class="muted">جارٍ تحميل الترتيب...</p>
  `;

  const rankingQuery = query(
    collection(db, "publicRankings"),
    where("studentClass", "==", selectedClass)
  );

  rankingUnsubscribe = onSnapshot(
    rankingQuery,
    snapshot => {
      const filtered = { docs: snapshot.docs.filter(d => (d.data().testId || "wazifa2") === selectedTest) };
      renderPublicRanking(filtered, selectedClass);
    },
    error => {
      console.error("Public ranking error:", error);

      $("rankingResults").innerHTML = `
        <p>تعذر تحميل الترتيب حالياً. يرجى المحاولة لاحقاً.</p>
      `;
    }
  );
};

// Return to the home page.
$("closeRankingBtn").onclick = () => {
  stopRankingListener();

  $("rankingCard").classList.add("hidden");
  $("startCard").classList.remove("hidden");
  $("notice").classList.add("hidden");
};


/* =========================================
   STUDENT PROFILE
========================================= */
async function openStudentProfile() {
  const user = auth.currentUser;
  if (!user || user.email?.toLowerCase() === "afterdark706@gmail.com") {
    notice("سجّل الدخول بحساب التلميذ أولاً لعرض ملفك الشخصي.");
    return;
  }

  $("startCard").classList.add("hidden");
  $("rankingCard").classList.add("hidden");
  $("studentProfileCard").classList.remove("hidden");
  $("studentProfileContent").innerHTML = '<p class="muted">جارٍ تحميل ملفك الشخصي...</p>';

  try {
    const profileSnap = await getDoc(doc(db, "studentProfiles", user.uid));
    if (!profileSnap.exists()) throw new Error("لم يتم العثور على ملفك الشخصي.");
    const profile = profileSnap.data();
    name = profile.name || name;
    studentClass = profile.studentClass || studentClass;

    const metaSnap = await getDoc(doc(db, "settings", "exams"));
    const publishedTestId = metaSnap.exists() ? (metaSnap.data().activeTestId || "") : "";
    let publishedTest = null;
    if (publishedTestId) {
      const publishedSnap = await getDoc(doc(db, "examTests", publishedTestId));
      if (publishedSnap.exists()) publishedTest = { id: publishedTestId, ...publishedSnap.data() };
    }

    const ownResult = publishedTestId
      ? await getDoc(doc(db, "publicRankings", user.uid + "__" + publishedTestId))
      : await getDoc(doc(db, "publicRankings", user.uid));
    let completed = ownResult.exists() ? 1 : 0;
    let bestMark = "—";
    let resultHtml = '<p class="muted">لم تنجز أي وظيفة بعد.</p>';
    let publishedHtml = "";
    if (publishedTest) {
      const startAt = Number(publishedTest.startAt);
      const endAt = Number(publishedTest.endAt);
      const now = Date.now();
      const scheduleText = Number.isFinite(startAt) && Number.isFinite(endAt)
        ? (now < startAt ? "تبدأ في " + new Date(startAt).toLocaleString("ar-DZ", { dateStyle: "medium", timeStyle: "short" })
          : now > endAt ? "انتهى وقت إنجازها" : "متاحة للإنجاز الآن")
        : "لم يحدد الأستاذ موعدها بعد";
      const alreadyDone = ownResult.exists();
      publishedHtml = `
        <div class="profile-result" style="margin:16px 0;border:2px solid #2563eb;">
          <h3>📝 الوظيفة المنشورة</h3>
          <p><strong>${esc(publishedTest.title || "وظيفة")}</strong></p>
          <p>${esc(scheduleText)}</p>
          ${alreadyDone
            ? '<p><strong>✓ أنجزت هذه الوظيفة بالفعل.</strong></p>'
            : '<button id="profileStartExamBtn" class="primary start-button" type="button" style="width:100%;margin-top:10px;">ابدأ الوظيفة ←</button>'}
        </div>`;
    } else {
      publishedHtml = '<p class="muted">لا توجد وظيفة منشورة حالياً. ستظهر هنا عندما ينشر الأستاذ وظيفة جديدة.</p>';
    }

    if (ownResult.exists()) {
      const data = ownResult.data();
      completed = 1;
      const final = getFinalScore(data);
      bestMark = final === null ? "بانتظار تصحيح السؤال التطبيقي" : final.toFixed(2) + " / 20";

      const classSnap = await getDocs(query(
        collection(db, "publicRankings"),
        where("studentClass", "==", studentClass)
      ));
      const classmates = classSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(item => (item.testId || "wazifa2") === publishedTestId);
      classmates.sort(sortByFinalScore);
      let previous = null;
      let rankNumber = 0;
      let rank = "—";
      classmates.forEach((item, index) => {
        const score = getRankingScore(item);
        if (score !== previous) {
          rankNumber = index + 1;
          previous = score;
        }
        if (item.studentUid === user.uid || item.id === user.uid + "__" + publishedTestId || item.id === user.uid) {
          rank = rankNumber;
        }
      });

      const mcq = Number(data.score || 0);
      const manual = data.handwrittenMark;
      resultHtml = `
        <div class="profile-result">
          <h3>نتيجة الوظيفة</h3>
          <p>الاختيار من متعدد: <strong>${mcq} / 16</strong></p>
          <p>السؤال التطبيقي: <strong>${manual == null ? "بانتظار تصحيح الأستاذ" : Number(manual) + " / 4"}</strong></p>
          <p>العلامة النهائية: <strong>${bestMark}</strong></p>
          <p>ترتيبك في القسم: <strong>${rank} ${typeof rank === "number" ? getRankMedal(rank) : ""}</strong> ${final === null ? '<small>(ترتيب مؤقت حسب علامة الاختيار من متعدد)</small>' : ""}</p>
          <p>الجائزة: <strong>${typeof rank === "number" ? (getRankMedal(rank) || "لا توجد ميدالية حالياً") : "بانتظار ترتيبك"}</strong></p>
        </div>`;
    }

    let announcementsHtml = '<div style="border:2px solid #dc2626;background:#fff1f2;color:#b91c1c;border-radius:12px;padding:14px;margin:12px 0;"><strong>لا توجد إشعارات جديدة من الأستاذ.</strong></div>';
    try {
      const announcementsSnap = await getDocs(collection(db, "announcements"));
      const announcements = announcementsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const time = value => value?.toMillis?.() ?? (value?.seconds ? value.seconds * 1000 : 0);
          return time(b.createdAt) - time(a.createdAt);
        });
      announcementsHtml = announcements.length
        ? announcements.map(item => {
            const date = item.createdAt?.toDate
              ? item.createdAt.toDate().toLocaleString("ar-DZ")
              : "";
            return `
              <article style="border:2px solid #dc2626;background:#fff1f2;color:#b91c1c;border-radius:12px;padding:14px;margin:10px 0;">
                <h3 style="margin:0 0 8px;color:#b91c1c;">📢 ${esc(item.title || "إشعار هام")}</h3>
                <p style="margin:0;color:#b91c1c;white-space:pre-wrap;line-height:1.8;">${esc(item.message || "")}</p>
                ${date ? `<small style="display:block;margin-top:8px;color:#991b1b;">${esc(date)}</small>` : ""}
              </article>`;
          }).join("")
        : '<div style="border:2px solid #dc2626;background:#fff1f2;color:#b91c1c;border-radius:12px;padding:14px;margin:12px 0;"><strong>لا توجد إشعارات جديدة من الأستاذ.</strong></div>';
    } catch (error) {
      console.error("Student announcements loading error:", error);
      announcementsHtml = '<p class="muted small">تعذر تحميل الإشعارات حالياً.</p>';
    }

    $("studentProfileContent").innerHTML = `
      <div class="profile-grid">
        <div class="profile-item"><span>الاسم واللقب</span><strong>${esc(name)}</strong></div>
        <div class="profile-item"><span>القسم</span><strong>${esc(studentClass.replace("Class ", "1م"))}</strong></div>
        <div class="profile-item"><span>طريقة الدخول</span><strong>الاسم + القسم + الرمز السري</strong></div>
        <div class="profile-item"><span>الاختبارات المكتملة</span><strong>${completed}</strong></div>
        <div class="profile-item"><span>أفضل علامة مسجلة</span><strong>${bestMark}</strong></div>
      </div>
      <div style="margin:14px 0;padding:14px;border:1px solid #93c5fd;border-radius:12px;background:#eff6ff;">
        <strong>🔔 فعّل إشعارات Kadri_Class</strong>
        <p class="muted small" style="margin:6px 0 10px;">لتصلك التذكيرات اليومية والإشعارات الهامة والوظائف الجديدة.</p>
        <button id="enableStudentPushBtn" class="primary" type="button" style="width:100%;">تفعيل الإشعارات</button>
        <p id="studentPushStatus" class="muted small" aria-live="polite"></p>
      </div>
      <h3 style="color:#b91c1c;">📢 إشعارات هامة من الأستاذ</h3>
      ${announcementsHtml}
      <h3>📚 الوظائف</h3>
      ${publishedHtml}
      <h3>📖 سجل الوظائف المنجزة</h3>
      ${resultHtml}
      <div id="profileExamNotice" class="notice hidden" role="alert" aria-live="polite" style="margin:16px 0;"></div>
      <button id="studentLogoutBtn" class="secondary" type="button" style="width:100%;margin-top:18px;border:2px solid #b45353;color:#9b2c2c;">تسجيل الخروج</button>
    `;
    $("studentProfileCard").scrollIntoView({ behavior: "smooth", block: "start" });

    $("enableStudentPushBtn").onclick = async () => {
      const button = $("enableStudentPushBtn");
      const status = $("studentPushStatus");
      button.disabled = true;
      status.textContent = "جارٍ طلب الإذن وتسجيل جهازك...";
      try {
        const { enableKadriNotifications } = await import("./push-client.js");
        await enableKadriNotifications("student");
        status.textContent = "تم تفعيل تسجيل الإشعارات لهذا الجهاز. سنرسل إشعار اختبار بعد اكتمال إعداد الإرسال.";
        button.textContent = "الإشعارات مفعّلة";
      } catch (error) {
        console.error("Student push setup error:", error);
        status.textContent = error.message || "تعذر تفعيل الإشعارات. حاول مجدداً.";
        button.disabled = false;
      }
    };

    $("studentLogoutBtn").onclick = async () => {
      const button = $("studentLogoutBtn");
      button.disabled = true;
      try {
        await signOut(auth);
        $("studentProfileCard").classList.add("hidden");
        $("startCard").classList.remove("hidden");
        $("studentProfileContent").innerHTML = "";
        $("studentName").value = "";
        $("studentPin").value = "";
        setAuthMode("login");
watchHomeAnnouncements();
      } catch (error) {
        console.error("Student logout error:", error);
        const message = $("profileExamNotice");
        message.textContent = "تعذر تسجيل الخروج. حاول مجدداً.";
        message.classList.remove("hidden");
        button.disabled = false;
      }
    };

    if ($("profileStartExamBtn")) $("profileStartExamBtn").onclick = async () => {
      const button = $("profileStartExamBtn");
      const message = $("profileExamNotice");
      button.disabled = true;
      message.classList.add("hidden");
      try {
        await beginStudentExam();
      } catch (error) {
        console.error("Profile exam start error:", error);
        message.textContent = error.message || "تعذر بدء الاختبار. حاول مجدداً.";
        message.classList.remove("hidden");
      } finally {
        button.disabled = false;
      }
    };
  } catch (error) {
    console.error("Student profile error:", error);
    $("studentProfileContent").innerHTML = '<p>تعذر تحميل ملفك الشخصي. حاول مجدداً.</p>';
  }
}

$("studentProfileBtn").onclick = openStudentProfile;
$("closeStudentProfileBtn").onclick = () => {
  $("studentProfileCard").classList.add("hidden");
  $("startCard").classList.remove("hidden");
};

/* =========================================
   START EXAM
========================================= */

function setAuthMode(mode) {
  authMode = mode;
  $("authSubmitBtn").textContent = mode === "register"
    ? "إنشاء الحساب"
    : "تسجيل الدخول";
  $("registerModeBtn").textContent = mode === "register"
    ? "لديك حساب بالفعل؟ تسجيل الدخول"
    : "ليس لديك حساب؟ إنشاء حساب جديد";
  $("studentPin").autocomplete = mode === "register" ? "new-password" : "current-password";
  $("notice").classList.add("hidden");
}

$("registerModeBtn").onclick = () => setAuthMode(authMode === "login" ? "register" : "login");

async function beginStudentExam() {
  const user = auth.currentUser;
  if (!user || user.email?.toLowerCase() === "afterdark706@gmail.com") {
    throw new Error("يرجى الدخول بحساب التلميذ، وليس حساب الأستاذ.");
  }

  const uid = user.uid;
  const meta=await getDoc(doc(db,"settings","exams"));
  activeTestId=meta.exists()?(meta.data().activeTestId||"wazifa2"):"wazifa2";
  const scheduleSnap=await getDoc(doc(db,"examTests",activeTestId));
  const schedule=scheduleSnap.exists()?scheduleSnap.data():null;
  activeTestName=schedule?.title||"وظيفة 2";
  const startText = new Date(Number(schedule.startAt)).toLocaleString("ar-DZ", { dateStyle: "medium", timeStyle: "short" });
  const endText = new Date(Number(schedule.endAt)).toLocaleString("ar-DZ", { dateStyle: "medium", timeStyle: "short" });
  $("examDuration").textContent = "مدة الاختبار: من " + startText + " إلى " + endText;
  if (!schedule || !Number.isFinite(Number(schedule.startAt)) || !Number.isFinite(Number(schedule.endAt))) {
    throw new Error("لم يتم تحديد موعد الاختبار بعد. يرجى التواصل مع الأستاذ.");
  }
  const now = Date.now();
  if (now < Number(schedule.startAt)) {
    throw new Error("لم يحن موعد بداية الاختبار بعد.");
  }
  if (now > Number(schedule.endAt)) {
    throw new Error("انتهى وقت بدء الاختبار. لا يمكن فتح محاولة جديدة.");
  }

  const previousRanking=await getDoc(doc(db,"publicRankings",uid+"__"+activeTestId));
  const legacy=activeTestId==="wazifa2"?await getDoc(doc(db,"publicRankings",uid)):{exists:()=>false};
  if(previousRanking.exists()||legacy.exists())throw new Error("لقد أرسلت هذا الاختبار بهذا الحساب من قبل.");

  await loadQuiz();
  $("nameLabel").textContent = name;

  // Focus mode: during the exam, keep only the site header and the quiz visible.
  document.body.classList.add("exam-mode");
  $("startCard").classList.add("hidden");
  $("rankingCard").classList.add("hidden");
  $("studentProfileCard").classList.add("hidden");
  $("examBankPublic").classList.add("hidden");
  $("quizCard").classList.remove("hidden");
  render();
}

$("authSubmitBtn").onclick = async () => {
  name = $("studentName").value.trim().replace(/\s+/g, " ");
  studentClass = $("studentClass").value;
  const pin = $("studentPin").value.trim();

  if (name.length < 3) {
    notice("يرجى كتابة الاسم واللقب الكامل.");
    return;
  }
  if (!classes.includes(studentClass)) {
    notice("يرجى اختيار القسم.");
    return;
  }
  if (!/^\d{6}$/.test(pin)) {
    notice("يجب إدخال رمز سري مكوّن من 6 أرقام بالضبط.");
    return;
  }

  $("authSubmitBtn").disabled = true;
  try {
    const authEmail = await makeStudentAuthEmail(name, studentClass, pin);

    if (authMode === "register") {
      const credential = await createUserWithEmailAndPassword(auth, authEmail, pin);
      await setDoc(doc(db, "studentProfiles", credential.user.uid), {
        name,
        studentClass,
        pin,
        loginMethod: "name-class-pin",
        createdAt: serverTimestamp()
      });
    } else {
      const credential = await signInWithEmailAndPassword(auth, authEmail, pin);
      const profile = await getDoc(doc(db, "studentProfiles", credential.user.uid));
      if (!profile.exists()) {
        await signOut(auth);
        throw new Error("لم نعثر على ملف التلميذ. تحقق من الاسم والقسم والرمز السري.");
      }
      const profileData = profile.data();
      if (profileData.name !== name || profileData.studentClass !== studentClass) {
        await signOut(auth);
        throw new Error("الاسم أو القسم أو الرمز السري غير صحيح.");
      }
      name = profileData.name;
      studentClass = profileData.studentClass;
    }

    await openStudentProfile();
  } catch (error) {
    console.error("Student account error:", error);
    const messages = {
      "auth/email-already-in-use": "يوجد ملف بهذه البيانات والرمز السري. اختر تسجيل الدخول.",
      "auth/weak-password": "الرمز السري غير مقبول. استخدم 6 أرقام.",
      "auth/invalid-credential": "الاسم أو القسم أو الرمز السري غير صحيح.",
      "auth/user-not-found": "لم يتم العثور على ملف بهذه البيانات. اختر إنشاء حساب جديد إذا كانت هذه أول مرة.",
      "auth/wrong-password": "الرمز السري غير صحيح.",
      "auth/network-request-failed": "تحقق من اتصال الإنترنت ثم حاول مجدداً.",
      "permission-denied": "تعذر حفظ ملفك. تحقق من اتصال الإنترنت وصلاحيات قاعدة البيانات."
    };
    notice(messages[error.code] || error.message || "تعذر إتمام العملية.");
  } finally {
    $("authSubmitBtn").disabled = false;
  }
};

onAuthStateChanged(auth, async user => {
  const isStudent = !!user && user.email?.toLowerCase() !== "afterdark706@gmail.com";
  $("studentProfileBtn").classList.toggle("hidden", !isStudent);
  if (!isStudent) return;
  try {
    const profile = await getDoc(doc(db, "studentProfiles", user.uid));
    if (profile.exists()) {
      name = profile.data().name;
      studentClass = profile.data().studentClass;
      await openStudentProfile();
    }
  } catch (error) {
    console.warn("Could not restore student profile:", error);
  }
});

setAuthMode("login");
watchHomeAnnouncements();

// Compress the single handwritten solution photo.
async function compressImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("الملف المختار ليس صورة.");
  }

  const image = await createImageBitmap(file);
  const canvas = document.createElement("canvas");

  const maxSide = 1200;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));

  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();

  let quality = 0.65;
  let blob;

  do {
    blob = await new Promise(resolve =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );

    if (!blob) throw new Error("تعذر ضغط الصورة.");

    quality -= 0.08;

  } while (blob.size > 500 * 1024 && quality >= 0.25);

  if (blob.size > 500 * 1024) {
    throw new Error("الصورة كبيرة جداً. اختر صورة أصغر.");
  }

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Display the ranking for the student's class after submission.
async function showClassRanking(submissionId, score) {
  const container = document.createElement("div");
  container.id = "classRanking";
  container.style.marginTop = "20px";

  $("doneText").insertAdjacentElement("afterend", container);

  container.innerHTML = `
    <h3 style="margin-bottom:12px;">ترتيب القسم — ${esc(studentClass)}</h3>
    <p>جارٍ تحميل الترتيب...</p>
  `;

  try {
    const rankingQuery = query(
      collection(db, "publicRankings"),
      where("studentClass", "==", studentClass)
    );

    const snapshot = await getDocs(rankingQuery);

    const students = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    })).filter(student => (student.testId || "wazifa2") === activeTestId);

   students.sort(sortByFinalScore);

    let rows = "";
    let previousFinalScore = null;
let currentRank = 0;

students.forEach((student, index) => {
  const studentScore = Number(student.score || 0);
  const finalScore = getFinalScore(student);

  if (finalScore !== previousFinalScore) {
    currentRank = index + 1;
    previousFinalScore = finalScore;
  }

      const isCurrentStudent = student.id === submissionId;

      const manual = student.handwrittenMark;

      const finalMark =
        manual === null || manual === undefined || manual === ""
          ? "—"
          : `${(studentScore + Number(manual)).toFixed(2)} /20`;

      rows += `
        <tr style="${isCurrentStudent ? "background:#e8f5e9;font-weight:bold;" : ""}">
          <td style="padding:10px;text-align:center;">${currentRank} ${getRankMedal(currentRank)}</td>
          <td style="padding:10px;">${esc(student.name)}${isCurrentStudent ? " (أنت)" : ""}</td>
          <td style="padding:10px;text-align:center;direction:ltr;">${studentScore}/16</td>
          <td style="padding:10px;text-align:center;direction:ltr;">${finalMark}</td>
        </tr>
      `;
    });

    if (!students.length) {
      container.innerHTML = `
        <h3>ترتيب القسم — ${esc(studentClass)}</h3>
        <p>لا توجد نتائج أخرى حالياً.</p>
      `;
      return;
    }

    container.innerHTML = `
      <h3 style="margin-bottom:12px;">ترتيب القسم — ${esc(studentClass)}</h3>

      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;text-align:right;">
          <thead>
            <tr style="background:#f1f1f1;">
              <th style="padding:10px;text-align:center;">الترتيب</th>
              <th style="padding:10px;">اسم التلميذ</th>
              <th style="padding:10px;text-align:center;">العلامة /16</th>
              <th style="padding:10px;text-align:center;">العلامة النهائية /20</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

  } catch (error) {
    console.error("Ranking error:", error);

    container.innerHTML = `
      <h3>ترتيب القسم</h3>
      <p>تعذر تحميل الترتيب حالياً. يمكنك المحاولة لاحقاً.</p>
    `;
  }
}

function render() {
  $("progress").textContent = `${page + 1} / 17`;
  $("progressBar").style.width = `${((page + 1) / 17) * 100}%`;

  let html = "";

  if (page < 16) {
    const q = quiz.mcq[page];

    html = `
      <div class="question">
        <p class="qtitle">
          ${page + 1}. ${formatMathText(q.q)}
          <span class="qtype">— اختيار من متعدد</span>
        </p>

        ${q.options.map((option, i) => `
          <label class="option">
            <input type="radio" name="answer" value="${i}"
              ${answers[page] === i ? "checked" : ""}>
            <span>${formatMathText(option)}</span>
          </label>
        `).join("")}
      </div>`;

  } else {
    const q = quiz.imageQuestions[0];

    html = `
      <div class="question">
        <p class="qtitle">
          17. ${formatMathText(q.q)}
          <span class="qtype">— السؤال التطبيقي (4 نقاط)</span>
        </p>

        ${q.imageUrl ? `<img src="${esc(q.imageUrl)}" alt="رسم التمرين الهندسي" style="display:block;width:100%;max-width:760px;height:auto;margin:14px auto;border:1px solid #dbe3ee;border-radius:10px;">` : ""}

        <div class="filebox">
          <label>اختر صورة واضحة للحل الكامل
            <input type="file" id="answerFile"
              accept="image/*" capture="environment">
          </label>

          <span class="muted small" id="fileStatus">
            ${answerFile ? "تم اختيار صورة" : "لم يتم اختيار صورة بعد"}
          </span>
        </div>

        <p class="muted small">
          أرسل صورة واحدة تحتوي على الحل الكامل للسؤال.
          تأكد من وضوح الكتابة قبل الإرسال.
        </p>
      </div>`;
  }

  $("questions").innerHTML = html;

  activateMathFields();

  if (page === 16) {
    $("answerFile").onchange = event => {
      answerFile = event.target.files[0] || null;

      $("fileStatus").textContent =
        answerFile?.name || "لم يتم اختيار صورة";
    };
  }

  $("prevBtn").disabled = page === 0;
  $("nextBtn").classList.toggle("hidden", page === 16);
  $("submitBtn").classList.toggle("hidden", page !== 16);
}

$("nextBtn").onclick = () => {
  if (page < 16) {
    const selected = document.querySelector(
      'input[name="answer"]:checked'
    );

    if (!selected) {
      notice("أجب عن السؤال قبل الانتقال.");
      return;
    }

    answers[page] = Number(selected.value);
  }

  page++;
  $("notice").classList.add("hidden");
  render();
};

$("prevBtn").onclick = () => {
  if (page > 0) {
    if (page < 16) {
      const selected = document.querySelector(
        'input[name="answer"]:checked'
      );

      if (selected) answers[page] = Number(selected.value);
    }

    page--;
    $("notice").classList.add("hidden");
    render();
  }
};

$("submitBtn").onclick = async () => {
  $("submitBtn").disabled = true;
  $("submitBtn").textContent = "جارٍ الإرسال...";

  try {
    if (!studentClass) {
      throw new Error("القسم غير محدد.");
    }

    if (!auth.currentUser) {
      throw new Error("انتهت جلسة الاتصال. أعد تحميل الصفحة.");
    }

    if (Object.keys(answers).length !== 16) {
      throw new Error("تحقق من إجابة الأسئلة الستة عشر.");
    }

    if (!answerFile) {
      throw new Error("يرجى إرفاق صورة الحل قبل الإرسال.");
    }

    const uid = auth.currentUser.uid;

    // Calculate the MCQ score.
    const score = quiz.mcq.reduce(
      (total, q, i) =>
        total + (answers[i] === Number(q.correct) ? 1 : 0),
      0
    );

    // Compress the photo before saving anything.
    const imageData = await compressImage(answerFile);

    // Each test has its own submission record.
    const submissionId = uid + "__" + activeTestId;

    // Save the submission and photo atomically.
    const batch = writeBatch(db);

    const submissionRef = doc(db, "submissions", submissionId);

    const imageRef = doc(
      db,
      "submissions",
      submissionId,
      "images",
      "solution"
    );

    batch.set(submissionRef, {
      name,
      studentUid: uid,
      studentClass,
      testId: activeTestId,
      testName: activeTestName,
      answers,
      score,
      imagesCount: 1,
      handwrittenMark: null,
      createdAt: serverTimestamp()
    });

    batch.set(imageRef, {
      questionNumber: 17,
      imageData,
      createdAt: serverTimestamp()
    });

    await batch.commit();

    // Publish the student's ranking entry.
    let rankingWarning = "";

    try {
      await setDoc(
        doc(db, "publicRankings", submissionId),
        {
          name,
          studentUid: uid,
          studentClass,
          testId: activeTestId,
          testName: activeTestName,
          score,
          handwrittenMark: null,
          createdAt: serverTimestamp()
        }
      );
    } catch (rankingError) {
      console.error("Ranking publication error:", rankingError);
      rankingWarning = " تعذر تحديث ترتيب القسم حالياً.";
    }

    document.body.classList.remove("exam-mode");
    $("quizCard").classList.add("hidden");
    $("doneCard").classList.remove("hidden");

    $("doneText").textContent =
      `تم حفظ إجاباتك. علامتك الأولية: ${score} / 16. السؤال التطبيقي من 4 نقاط، وسيصححه الأستاذ.${rankingWarning}`;

    await showClassRanking(submissionId, score);

  } catch (error) {
    console.error("Submission error:", error);

    if (error.code === "permission-denied") {
      notice(
        "تعذر قبول الإرسال. ربما أرسلت الاختبار من هذا الجهاز من قبل، أو توجد مشكلة في صلاحيات قاعدة البيانات."
      );
    } else {
      notice("تعذر الإرسال: " + error.message);
    }

    $("submitBtn").disabled = false;
    $("submitBtn").textContent = "إرسال الإجابات";
  }
};
