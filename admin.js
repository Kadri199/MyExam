
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
let selectedClass = "Class 9";

const classes = ["Class 9", "Class 10", "Class 11", "Class 12"];

function notice(t) {
  $("notice").textContent = t;
  $("notice").classList.remove("hidden");
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
  if (user && !user.isAnonymous) {
    $("loginCard").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    await loadAll();
  } else {
    $("loginCard").classList.remove("hidden");
    $("dashboard").classList.add("hidden");
  }
});

async function loadAll() {
  await loadQuiz();
  await loadResults();
}

async function loadQuiz() {
  const s = await getDoc(doc(db, "settings", "quiz"));

  quiz = s.exists()
    ? s.data()
    : {
        title: "اختبار الرياضيات",
        mcq: Array.from({ length: 16 }, (_, i) => ({
          q: `السؤال ${i + 1}`,
          options: ["الخيار الأول", "الخيار الثاني", "الخيار الثالث"],
          correct: 0
        })),
        imageQuestions: Array.from({ length: 4 }, (_, i) => ({
          q: `السؤال ${i + 17}`
        }))
      };

  renderEditor();
}

function renderEditor() {
  let html = "";

  quiz.mcq.forEach((q, i) => {
    html += `
      <div class="editor-q">
        <h3>السؤال ${i + 1} — اختيار من متعدد</h3>
        <label>
          نص السؤال
          <textarea rows="2" data-q="${i}" data-field="q">${esc(q.q)}</textarea>
        </label>
        <div class="grid">
          ${q.options.map((o, j) => `
            <label>
              الخيار ${j + 1}
              <input data-q="${i}" data-option="${j}" value="${esc(o)}">
            </label>
          `).join("")}
        </div>
        <label>
          الإجابة الصحيحة
          <select data-q="${i}" data-field="correct">
            ${[0, 1, 2].map(n => `
              <option value="${n}" ${Number(q.correct) === n ? "selected" : ""}>
                الخيار ${n + 1}
              </option>
            `).join("")}
          </select>
        </label>
      </div>
    `;
  });

  quiz.imageQuestions.forEach((q, i) => {
    html += `
      <div class="editor-q">
        <h3>السؤال ${i + 17} — إجابة بصورة</h3>
        <label>
          نص السؤال
          <textarea rows="2" data-imgq="${i}">${esc(q.q)}</textarea>
        </label>
      </div>
    `;
  });

  $("editor").innerHTML = html;
}

$("saveQuizBtn").onclick = async () => {
  document.querySelectorAll("[data-q][data-field]").forEach(el => {
    const i = +el.dataset.q;
    quiz.mcq[i][el.dataset.field] =
      el.dataset.field === "correct" ? +el.value : el.value;
  });

  document.querySelectorAll("[data-q][data-option]").forEach(el => {
    quiz.mcq[+el.dataset.q].options[+el.dataset.option] = el.value;
  });

  document.querySelectorAll("[data-imgq]").forEach(el => {
    quiz.imageQuestions[+el.dataset.imgq].q = el.value;
  });

  try {
    await setDoc(doc(db, "settings", "quiz"), quiz);
    $("saveStatus").textContent = "تم حفظ الأسئلة بنجاح.";
  } catch (e) {
    $("saveStatus").textContent = "تعذر الحفظ: " + e.message;
  }
};

$("refreshBtn").onclick = loadResults;

// Class buttons and print button
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

// Load submissions
async function loadResults() {
  try {
    const snap = await getDocs(
      query(
        collection(db, "submissions"),
        orderBy("createdAt", "desc")
      )
    );

    submissions = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    createClassFilters();
    renderClassRanking();

  } catch (error) {
    notice("تعذر تحميل النتائج: " + error.message);
  }
}

// Render selected class
function renderClassRanking() {
  const classResults = submissions
    .filter(s => s.studentClass === selectedClass)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  document.querySelectorAll("[data-class]").forEach(button => {
    const active = button.dataset.class === selectedClass;
    button.style.background = active ? "#173b67" : "";
    button.style.color = active ? "#ffffff" : "";
  });

  $("printClassBtn").textContent = `🖨 طباعة نتائج ${selectedClass}`;

  $("countAll").textContent = classResults.length;

  $("avgScore").textContent = classResults.length
    ? (
        classResults.reduce((sum, s) => sum + (s.score || 0), 0) /
        classResults.length
      ).toFixed(2)
    : "—";

  $("topScore").textContent = classResults.length
    ? `${classResults[0].score}`
    : "—";

  $("resultsBody").innerHTML = classResults.length
    ? classResults.map((s, i) => {
        const manual = s.handwrittenMark ?? "";

        const final = manual === ""
          ? "—"
          : (Number(s.score || 0) + Number(manual)).toFixed(2);

        return `
          <tr>
            <td class="rank">${i + 1}</td>
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

  // Calculate final mark immediately while typing
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

    // Permanently save the mark when editing is finished
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

          notice("تم حذف علامة الحلول الكتابية.");

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

        notice("تم حفظ علامة الحلول الكتابية بنجاح.");

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

// Print selected class in Arabic
function printClass() {
  const classResults = submissions
    .filter(s => s.studentClass === selectedClass)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const rows = classResults.map((s, i) => {
    const manual = s.handwrittenMark ?? "";

    const final = manual === ""
      ? "—"
      : (Number(s.score || 0) + Number(manual)).toFixed(2);

    return `
      <tr>
        <td>${i + 1}</td>
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

// View student photos
async function showDetails(id) {
  const s = submissions.find(x => x.id === id);
  if (!s) return;

  const w = window.open("", "_blank");

  if (!w) {
    alert("اسمح بفتح النوافذ المنبثقة لعرض التفاصيل.");
    return;
  }

  w.document.write(`
    <html lang="ar" dir="rtl">
    <meta charset="utf-8">
    <title>إجابات ${esc(s.name)}</title>
    <body style="font-family:Arial;padding:24px">
      <h2>${esc(s.name)}</h2>
      <h3>${esc(s.studentClass || "")}</h3>
      <h3>علامة الاختيار المتعدد: ${s.score}/16</h3>
      <p>صور الحلول:</p>
      <div id="images">جارٍ تحميل الصور...</div>
    </body>
    </html>
  `);

  try {
    const snap = await getDocs(
      collection(db, "submissions", id, "images")
    );

    const images = snap.docs
      .map(d => d.data())
      .sort((a, b) => a.questionNumber - b.questionNumber);

    const container = w.document.getElementById("images");

    if (!images.length) {
      container.textContent = "لم يتم العثور على صور.";
      return;
    }

    container.innerHTML = images.map(img => `
      <div style="margin:25px 0">
        <h3>السؤال ${img.questionNumber}</h3>
        <img
          src="${esc(img.imageData)}"
          style="max-width:100%;max-height:600px">
      </div>
    `).join("");

  } catch (error) {
    w.document.getElementById("images").textContent =
      "تعذر تحميل الصور: " + error.message;
  }
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
