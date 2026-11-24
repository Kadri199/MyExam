
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getFirestore, doc, getDoc, setDoc,
  collection, getDocs, query, orderBy,
  updateDoc, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getAuth, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const $ = id => document.getElementById(id);

let quiz = null;
let submissions = [];
let studentProfiles = [];
let selectedClass = "Class 9";
let selectedTestId="wazifa2";

const classes = ["Class 9", "Class 10", "Class 11", "Class 12"];

function notice(t) {
  $("notice").textContent = t;
  $("notice").classList.remove("hidden");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

// Calculate the current total mark out of 20.
// If the handwritten mark is not entered yet, use the MCQ score temporarily.
function getRankingScore(student) {
  return Number(student.score || 0) +
    Number(student.handwrittenMark ?? 0);
}

// Sort by the current total mark, highest first.
function sortClassResults(results) {
  return [...results].sort((a, b) =>
    getRankingScore(b) - getRankingScore(a)
  );
}

// Assign equal ranks to pupils with equal marks.
function getAwardBadge(rank) {
  if (rank === 1) return '<span class="rank-medal gold">🥇 ذهبية</span>';
  if (rank === 2) return '<span class="rank-medal silver">🥈 فضية</span>';
  if (rank === 3) return '<span class="rank-medal bronze">🥉 برونزية</span>';
  return "";
}

function getRankedResults(results) {
  const sorted = sortClassResults(results);

  let previousScore = null;
  let currentRank = 0;

  return sorted.map((student, index) => {
    const currentScore = getRankingScore(student);

    if (currentScore !== previousScore) {
      currentRank = index + 1;
      previousScore = currentScore;
    }

    return {
      ...student,
      rank: currentRank
    };
  });
}

$("loginBtn").onclick = async () => {
  try {
    await signInWithEmailAndPassword(
      auth,
      $("email").value,
      $("password").value
    );
  } catch (e) {
    notice("تعذر تسجيل الدخول: " + e.message);
  }
};

$("logoutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  const teacherEmail = "afterdark706@gmail.com";
  const isTeacherAccount = user
    && !user.isAnonymous
    && user.email?.trim().toLowerCase() === teacherEmail;

  if (isTeacherAccount) {
    $("loginCard").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    await loadAll();
  } else {
    $("loginCard").classList.remove("hidden");
    $("dashboard").classList.add("hidden");

    if (user && !user.isAnonymous) {
      notice("هذا الحساب ليس حساب الأستاذ المصرّح له. سجّل الدخول باستعمال " + teacherEmail);
    }
  }
});

async function loadAll() {
  // Load independent dashboard sections at the same time.
  // A slow exam-settings request must not delay submissions or student accounts.
  await Promise.allSettled([
    loadActiveTest(),
    loadResults(),
    loadStudentPins()
  ]);
}

async function loadActiveTest() {
  try {
    const metaSnap = await getDoc(doc(db, "settings", "exams"));
    const meta = metaSnap.exists() ? metaSnap.data() : {};
    selectedTestId = meta.activeTestId || "wazifa2";

    // Results may have finished loading before the active test setting.
    if (submissions.length) renderClassRanking();
  } catch (error) {
    console.error("Active exam setting error:", error);
    // Keep the safe default test ID if settings cannot be read.
  }
}

$("refreshBtn").onclick = loadResults;

function createClassFilters() {
  if ($("classFilters")) return;

  const table = $("resultsBody").closest("table");

  table.insertAdjacentHTML("beforebegin", `
    <div id="classFilters"
      style="display:flex;flex-wrap:wrap;gap:8px;margin:15px 0;">
      ${classes.map(c => `
        <button type="button"
          class="secondary"
          data-class="${c}"
          style="padding:10px 16px;border-radius:8px;cursor:pointer;">
          ${c}
        </button>
      `).join("")}
    </div>

    <div style="margin-bottom:15px">
      <button type="button" id="printClassBtn">
        طباعة نتائج القسم
      </button>
    </div>
  `);

  document.querySelectorAll("[data-class]").forEach(button => {
    button.onclick = () => {
      selectedClass = button.dataset.class;
      renderClassRanking();
    };
  });

  $("printClassBtn").onclick = printClass;
}

async function loadResults() {
  const refreshButton = $("refreshBtn");
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "جارٍ التحديث...";
  }
  $("resultsBody").innerHTML = '<tr><td colspan="7">جارٍ تحميل النتائج...</td></tr>';

  try {
    const snap = await getDocs(
      query(
        collection(db, "submissions"),
        orderBy("createdAt", "desc")
      )
    );

    submissions = snap.docs.map(d => ({id:d.id,...d.data(),testId:d.data().testId||"wazifa2",testName:d.data().testName||"وظيفة 2"}));

    // Do not recreate public ranking documents while merely loading results.
    // Rankings are created at student submission and updated only when the
    // teacher changes a handwritten mark. This keeps intentional deletions intact.

    createClassFilters();
    renderClassRanking();

  } catch (error) {
    notice("تعذر تحميل النتائج: " + error.message);
    $("resultsBody").innerHTML = '<tr><td colspan="7">تعذر تحميل النتائج. حاول التحديث.</td></tr>';
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "تحديث النتائج";
    }
  }
}

async function loadStudentPins() {
  try {
    const snap = await getDocs(collection(db, "studentProfiles"));
    studentProfiles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStudentPins();
  } catch (error) {
    console.error("Student PIN list error:", error);
    $("studentPinsBody").innerHTML = '<tr><td colspan="3">تعذر تحميل قائمة الرموز. تحقق من صلاحيات قاعدة البيانات.</td></tr>';
  }
}

function renderStudentPins() {
  const search = ($("studentPinSearch")?.value || "").trim().toLowerCase();
  const filtered = studentProfiles.filter(p =>
    String(p.name || "").toLowerCase().includes(search) ||
    String(p.studentClass || "").toLowerCase().includes(search) ||
    String(p.studentClass || "").replace("Class ", "1م").includes(search)
  );
  $("studentPinsBody").innerHTML = filtered.length
    ? filtered.map(p => `
        <tr>
          <td>${esc(p.name || "—")}</td>
          <td>${esc(String(p.studentClass || "").replace("Class ", "1م"))}</td>
          <td><strong style="direction:ltr;display:inline-block;">${p.pin ? esc(p.pin) : "غير متوفر — حساب قديم"}</strong></td>
        </tr>
      `).join("")
    : '<tr><td colspan="3">لا توجد نتائج مطابقة.</td></tr>';
}

$("studentPinSearch").addEventListener("input", renderStudentPins);
$("refreshStudentPinsBtn").onclick = loadStudentPins;

function renderClassRanking() {
  const classResults = getRankedResults(
    submissions.filter(s => s.studentClass === selectedClass && (s.testId||"wazifa2")===selectedTestId)
  );

  document.querySelectorAll("[data-class]").forEach(button => {
    const active = button.dataset.class === selectedClass;
    button.style.background = active ? "#173b67" : "";
    button.style.color = active ? "#ffffff" : "";
  });

  if ($("printClassBtn")) {
    $("printClassBtn").textContent = `🖨 طباعة نتائج ${selectedClass}`;
  }
  $("countAll").textContent = classResults.length;

  $("avgScore").textContent = classResults.length
    ? (
        classResults.reduce((sum, s) => sum + getRankingScore(s), 0) /
        classResults.length
      ).toFixed(2)
    : "—";

  $("topScore").textContent = classResults.length
    ? `${getRankingScore(classResults[0]).toFixed(2)} / 20`
    : "—";

  $("resultsBody").innerHTML = classResults.length
    ? classResults.map(s => {
        const manual = s.handwrittenMark ?? "";

        const final = manual === ""
          ? "—"
          : getRankingScore(s).toFixed(2);

        return `
          <tr>
            <td class="rank">${s.rank} ${s.handwrittenMark == null ? "" : getAwardBadge(s.rank)}</td>
            <td>${esc(s.name)}</td>
            <td><b>${s.score ?? "—"}</b></td>

            <td>
              <input
                type="number"
                min="0"
                max="4"
                step="0.25"
                value="${manual}"
                placeholder="0 - 4"
                data-mark="${esc(s.id)}"
                style="width:85px;padding:7px"
              >
            </td>

            <td>
              <b data-final="${esc(s.id)}">${final}</b>
            </td>

            <td>
              ${s.createdAt?.toDate
                ? s.createdAt.toDate().toLocaleString("ar-DZ")
                : "—"}
            </td>

            <td>
              <button
                class="secondary detail-btn"
                data-detail="${esc(s.id)}">
                عرض الصور
              </button>
            </td>
          </tr>
        `;
      }).join("")
    : `
        <tr>
          <td colspan="7">
            لا توجد نتائج في ${selectedClass} بعد.
          </td>
        </tr>
      `;

  document.querySelectorAll("[data-mark]").forEach(input => {
    input.addEventListener("input", () => {
      const id = input.dataset.mark;
      const value = input.value.trim();

      const student = submissions.find(s => s.id === id);
      const finalCell = document.querySelector(`[data-final="${id}"]`);

      if (!finalCell) return;

      if (value === "") {
        finalCell.textContent = "—";
        input.setCustomValidity("");
        return;
      }

      const n = Number(value);

      if (!Number.isFinite(n) || n < 0 || n > 4) {
        input.setCustomValidity("أدخل علامة بين 0 و4");
        return;
      }

      input.setCustomValidity("");

      finalCell.textContent =
        (Number(student?.score || 0) + n).toFixed(2);
    });

    input.addEventListener("change", async () => {
      const id = input.dataset.mark;
      const value = input.value.trim();
      const student = submissions.find(s => s.id === id);

      if (!student) return;

      if (value === "") {
        try {
          input.disabled = true;

          await updateDoc(doc(db, "submissions", id), {
            handwrittenMark: deleteField()
          });

          delete student.handwrittenMark;

          // Also remove the handwritten mark from the public ranking.
          await setDoc(doc(db, "publicRankings", id), {
            name: student.name,
            studentClass: student.studentClass,
            score: student.score,
            handwrittenMark: deleteField()
          }, { merge: true });

          notice("تم حذف علامة الحلول الكتابية.");

          // Recalculate ranking after deleting the mark.
          renderClassRanking();

        } catch (error) {
          notice("تعذر حذف العلامة: " + error.message);
        } finally {
          input.disabled = false;
        }

        return;
      }

      const n = Number(value);

      if (!Number.isFinite(n) || n < 0 || n > 4) {
        input.setCustomValidity("أدخل علامة بين 0 و4");
        input.reportValidity();
        return;
      }

      input.setCustomValidity("");

      try {
        input.disabled = true;

        await updateDoc(doc(db, "submissions", id), {
          handwrittenMark: n
        });

        student.handwrittenMark = n;

        // Also publish the handwritten mark to the public ranking.
        await setDoc(doc(db, "publicRankings", id), {
          name: student.name,
          studentClass: student.studentClass,
          score: student.score,
          handwrittenMark: n
        }, { merge: true });

        notice("تم حفظ علامة الحلول الكتابية وتحديث الترتيب.");

        // Recalculate ranking immediately after saving the mark.
        renderClassRanking();

      } catch (error) {
        notice("تعذر حفظ العلامة: " + error.message);
      } finally {
        input.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-detail]").forEach(button => {
    button.onclick = () => showDetails(button.dataset.detail);
  });
}

function printClass() {
  // Printed results use the same final-mark ranking as the dashboard.
  const classResults = getRankedResults(
    submissions.filter(s => s.studentClass === selectedClass && (s.testId||"wazifa2")===selectedTestId)
  );

  const rows = classResults.map(s => {
    const manual = s.handwrittenMark ?? "";

    const final = manual === ""
      ? "—"
      : getRankingScore(s).toFixed(2);

    return `
      <tr>
        <td>${s.rank}</td>
        <td>${esc(s.name)}</td>
        <td>${s.score ?? "—"}</td>
        <td>${manual === "" ? "—" : manual}</td>
        <td>${final}</td>
      </tr>
    `;
  }).join("");

  const w = window.open("", "_blank");

  if (!w) {
    alert("اسمح بفتح النوافذ المنبثقة للطباعة.");
    return;
  }

  w.document.write(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>نتائج ${selectedClass}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          direction: rtl;
          padding: 25px;
        }
        h2, p { text-align: center; }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          border: 1px solid #555;
          padding: 10px;
          text-align: center;
        }
        th { background: #eee; }
        @media print {
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      <h2>اختبار الرياضيات</h2>
      <h3 style="text-align:center">${selectedClass}</h3>
      <p>عدد التلاميذ: ${classResults.length}</p>

      <table>
        <thead>
          <tr>
            <th>الترتيب</th>
            <th>اسم التلميذ</th>
            <th>الاختيار المتعدد / 16</th>
            <th>الحلول الكتابية / 4</th>
            <th>العلامة النهائية / 20</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <script>
        window.onload = () => window.print();
      <\/script>
    </body>
    </html>
  `);

  w.document.close();
}

async function showDetails(id) {
  document.getElementById("photoViewerModal")?.remove();

  const student = submissions.find(s => s.id === id);
  if (!student) return;

  const modal = document.createElement("div");
  modal.id = "photoViewerModal";

  modal.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: rgba(0,0,0,0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 15px;
    direction: rtl;
  `;

  const panel = document.createElement("div");
  panel.style.cssText = `
    background: white;
    color: #222;
    width: 100%;
    max-width: 850px;
    max-height: 90vh;
    overflow-y: auto;
    border-radius: 12px;
    padding: 20px;
  `;

  const header = document.createElement("div");
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 15px;
  `;

  const title = document.createElement("h2");
  title.textContent = `حل التلميذ: ${student.name || ""}`;
  title.style.margin = "0";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕ إغلاق";
  closeBtn.style.cssText = `
    background: #b42318;
    color: white;
    border: none;
    border-radius: 7px;
    padding: 10px 16px;
    cursor: pointer;
    font-size: 15px;
  `;

  function closeViewer() {
    modal.remove();
    document.removeEventListener("keydown", handleEscape);
  }

  function handleEscape(event) {
    if (event.key === "Escape") closeViewer();
  }

  closeBtn.addEventListener("click", closeViewer);
  modal.addEventListener("click", event => {
    if (event.target === modal) closeViewer();
  });
  document.addEventListener("keydown", handleEscape);

  header.append(title, closeBtn);

  const info = document.createElement("p");
  info.textContent =
    `القسم: ${student.studentClass || ""} — العلامة الأولية: ${student.score ?? 0}/16`;

  const content = document.createElement("div");
  content.textContent = "جارٍ تحميل صورة الحل...";

  panel.append(header, info, content);
  modal.appendChild(panel);
  document.body.appendChild(modal);

  try {
    const imagesSnapshot = await getDocs(
      collection(db, "submissions", id, "images")
    );

    content.innerHTML = "";

    if (imagesSnapshot.empty) {
      content.textContent = "لم يتم العثور على صورة الحل.";
      return;
    }

    imagesSnapshot.forEach(imageDoc => {
      const image = imageDoc.data();

      const imageTitle = document.createElement("h3");
      imageTitle.textContent = "السؤال 17 — الحل الكامل";

      const img = document.createElement("img");
      img.src = image.imageData;
      img.alt = "صورة حل التلميذ";
      img.style.cssText = `
        display: block;
        max-width: 100%;
        height: auto;
        margin: 10px auto 25px;
        border: 1px solid #ddd;
        border-radius: 8px;
      `;

      content.append(imageTitle, img);
    });
  } catch (error) {
    console.error(error);
    content.textContent = "حدث خطأ أثناء تحميل الصورة. حاول مجدداً.";
  }
}
