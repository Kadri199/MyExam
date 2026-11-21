
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getFirestore, doc, getDoc, addDoc, collection, serverTimestamp,
  getDocs, query, where, setDoc
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

$("startBtn").onclick = async () => {
  name = $("studentName").value.trim();
  studentClass = $("studentClass").value;

  if (name.length < 3) {
    notice("يرجى كتابة الاسم واللقب بشكل صحيح.");
    return;
  }

  if (!["Class 9", "Class 10", "Class 11", "Class 12"].includes(studentClass)) {
    notice("يرجى اختيار القسم قبل بدء الاختبار.");
    return;
  }

  $("startBtn").disabled = true;

  try {
    await signInAnonymously(auth);
    await loadQuiz();

    $("nameLabel").textContent = name;

    $("startCard").classList.add("hidden");
    $("quizCard").classList.remove("hidden");

    render();

  } catch (error) {
    notice("تعذر الاتصال: " + error.message);
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

// Display the ranking for the student's class.
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
      Number(b.score) - Number(a.score)
    );

    let rows = "";
    let previousScore = null;
    let currentRank = 0;

    students.forEach((student, index) => {
      const studentScore = Number(student.score);

      if (studentScore !== previousScore) {
        currentRank = index + 1;
        previousScore = studentScore;
      }

      const isCurrentStudent = student.id === submissionId;

      rows += `
        <tr style="${isCurrentStudent ? "background:#e8f5e9;font-weight:bold;" : ""}">
          <td style="padding:10px;text-align:center;">${currentRank}</td>
          <td style="padding:10px;">${esc(student.name)}${isCurrentStudent ? " (أنت)" : ""}</td>
          <td style="padding:10px;text-align:center;direction:ltr;">${studentScore}/16</td>
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
              <th style="padding:10px;text-align:center;">العلامة</th>
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
          ${page + 1}. ${esc(q.q)}
          <span class="qtype">— اختيار من متعدد</span>
        </p>

        ${q.options.map((option, i) => `
          <label class="option">
            <input type="radio" name="answer" value="${i}"
              ${answers[page] === i ? "checked" : ""}>
            <span>${esc(option)}</span>
          </label>
        `).join("")}
      </div>`;

  } else {
    const q = quiz.imageQuestions[0];

    html = `
      <div class="question">
        <p class="qtitle">
          17. ${esc(q.q)}
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

    if (Object.keys(answers).length !== 16) {
      throw new Error("تحقق من إجابة الأسئلة الستة عشر.");
    }

    if (!answerFile) {
      throw new Error("يرجى إرفاق صورة الحل قبل الإرسال.");
    }

    const score = quiz.mcq.reduce(
      (total, q, i) =>
        total + (answers[i] === Number(q.correct) ? 1 : 0),
      0
    );

    // Compress the photo before saving the submission.
    const imageData = await compressImage(answerFile);

    // Save student information and MCQ score.
    const submission = await addDoc(
      collection(db, "submissions"),
      {
        name,
        studentClass,
        answers,
        score,
        imagesCount: 1,
        handwrittenMark: null,
        createdAt: serverTimestamp()
      }
    );

    // Save the single compressed solution photo.
    await addDoc(
      collection(db, "submissions", submission.id, "images"),
      {
        questionNumber: 17,
        imageData,
        createdAt: serverTimestamp()
      }
    );

    // Save only the information needed for the public ranking.
    try {
      await setDoc(
        doc(db, "publicRankings", submission.id),
        {
          name,
          studentClass,
          score,
          createdAt: serverTimestamp()
        }
      );
    } catch (rankingError) {
      console.error("Could not save ranking entry:", rankingError);
    }

    $("quizCard").classList.add("hidden");
    $("doneCard").classList.remove("hidden");

    $("doneText").textContent =
      `تم حفظ إجاباتك. علامتك الأولية: ${score} / 16. السؤال التطبيقي من 4 نقاط، وسيصححه الأستاذ.`;

    await showClassRanking(submission.id, score);

  } catch (error) {
    notice("تعذر الإرسال: " + error.message);

    $("submitBtn").disabled = false;
    $("submitBtn").textContent = "إرسال الإجابات";
  }
};
