
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getFirestore, doc, getDoc, collection, serverTimestamp,
  getDocs, query, where, setDoc, writeBatch, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getAuth, signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const $ = id => document.getElementById(id);

let quiz, name = "", studentClass = "", page = 0;
let answers = {};
let answerFile = null;

// Public ranking real-time listener
let rankingUnsubscribe = null;

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
  const snap = await getDoc(doc(db, "settings", "quiz"));
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

// Render public ranking.
function renderPublicRanking(snapshot, selectedClass) {
  const students = snapshot.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));

  // Keep ranking sorted by MCQ score /16.
  students.sort((a, b) =>
    Number(b.score || 0) - Number(a.score || 0)
  );

  if (!students.length) {
    $("rankingResults").innerHTML = `
      <h3>🏆 ترتيب ${esc(selectedClass)}</h3>
      <p>لا توجد نتائج في هذا القسم حالياً.</p>
    `;
    return;
  }

  let rows = "";
  let previousScore = null;
  let currentRank = 0;

  students.forEach((student, index) => {
    const studentScore = Number(student.score || 0);

    if (studentScore !== previousScore) {
      currentRank = index + 1;
      previousScore = studentScore;
    }

    const manual = student.handwrittenMark;

    const finalMark =
      manual === null || manual === undefined || manual === ""
        ? "—"
        : `${(studentScore + Number(manual)).toFixed(2)} /20`;

    rows += `
      <tr>
        <td style="padding:10px;text-align:center;">
          ${currentRank}
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
}

// Open the ranking page.
$("showRankingBtn").onclick = () => {
  stopRankingListener();

  $("startCard").classList.add("hidden");
  $("rankingCard").classList.remove("hidden");
  $("notice").classList.add("hidden");

  $("rankingClasses").innerHTML = `
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
    <p class="muted small">اختر قسمك لعرض ترتيب التلاميذ.</p>
  `;
};

// Select a class and listen for live ranking updates.
$("rankingClasses").onclick = event => {
  const button = event.target.closest("[data-class]");

  if (!button) return;

  const selectedClass = button.dataset.class;

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
      renderPublicRanking(snapshot, selectedClass);
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
   START EXAM
========================================= */

$("startBtn").onclick = async () => {
  name = $("studentName").value.trim();
  studentClass = $("studentClass").value;

  if (name.length < 3) {
    notice("يرجى كتابة الاسم واللقب بشكل صحيح.");
    return;
  }

  if (!classes.includes(studentClass)) {
    notice("يرجى اختيار القسم قبل بدء الاختبار.");
    return;
  }

  $("startBtn").disabled = true;

  try {
    await signInAnonymously(auth);

    // Check whether this browser account has already submitted.
    const uid = auth.currentUser.uid;
    const previousRanking = await getDoc(
      doc(db, "publicRankings", uid)
    );

    if (previousRanking.exists()) {
      throw new Error("لقد أرسلت الاختبار من هذا الجهاز من قبل. لا يمكنك الإرسال مرة ثانية.");
    }

    await loadQuiz();

    $("nameLabel").textContent = name;

    $("startCard").classList.add("hidden");
    $("quizCard").classList.remove("hidden");

    render();

  } catch (error) {
    notice(error.message || "تعذر الاتصال بالخادم.");
    $("startBtn").disabled = false;
  }
};

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
    }));

    students.sort((a, b) =>
      Number(b.score || 0) - Number(a.score || 0)
    );

    let rows = "";
    let previousScore = null;
    let currentRank = 0;

    students.forEach((student, index) => {
      const studentScore = Number(student.score || 0);

      if (studentScore !== previousScore) {
        currentRank = index + 1;
        previousScore = studentScore;
      }

      const isCurrentStudent = student.id === submissionId;

      const manual = student.handwrittenMark;

      const finalMark =
        manual === null || manual === undefined || manual === ""
          ? "—"
          : `${(studentScore + Number(manual)).toFixed(2)} /20`;

      rows += `
        <tr style="${isCurrentStudent ? "background:#e8f5e9;font-weight:bold;" : ""}">
          <td style="padding:10px;text-align:center;">${currentRank}</td>
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

    // The UID is the permanent submission document ID.
    const submissionId = uid;

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
          studentClass,
          score,
          handwrittenMark: null,
          createdAt: serverTimestamp()
        }
      );
    } catch (rankingError) {
      console.error("Ranking publication error:", rankingError);
      rankingWarning = " تعذر تحديث ترتيب القسم حالياً.";
    }

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
