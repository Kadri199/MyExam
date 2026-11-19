
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getFirestore, doc, getDoc, addDoc, collection, serverTimestamp
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
let files = {};

const defaultQuiz = {
  title: "اختبار الرياضيات",
  mcq: Array.from({ length: 16 }, (_, i) => ({
    q: `السؤال ${i + 1} — أضف نص السؤال من لوحة الأستاذ`,
    options: ["الخيار الأول", "الخيار الثاني", "الخيار الثالث"],
    correct: 0
  })),
  imageQuestions: Array.from({ length: 4 }, (_, i) => ({
    q: `السؤال ${i + 17} — أرفق صورة الحل`
  }))
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

// Compress image in the browser, without any paid service.
async function compressImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("الملف المختار ليس صورة.");
  }

  const image = await createImageBitmap(file);
  const canvas = document.createElement("canvas");

  const maxSide = 1000;
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
    throw new Error("الصورة كبيرة جداً. اختر صورة أصغر أو أوضح.");
  }

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function render() {
  $("progress").textContent = `${page + 1} / 20`;
  $("progressBar").style.width = `${((page + 1) / 20) * 100}%`;

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
    const n = page - 16;
    const q = quiz.imageQuestions[n];

    html = `
      <div class="question">
        <p class="qtitle">
          ${page + 1}. ${esc(q.q)}
          <span class="qtype">— إجابة بصورة</span>
        </p>

        <div class="filebox">
          <label>اختر صورة واضحة للحل
            <input type="file" id="answerFile"
              accept="image/*" capture="environment">
          </label>

          <span class="muted small" id="fileStatus">
            ${files[n] ? "تم اختيار صورة" : "لم يتم اختيار صورة بعد"}
          </span>
        </div>
      </div>`;
  }

  $("questions").innerHTML = html;

  if (page >= 16) {
    $("answerFile").onchange = event => {
      files[page - 16] = event.target.files[0];

      $("fileStatus").textContent =
        files[page - 16]?.name || "لم يتم اختيار صورة";
    };
  }

  $("prevBtn").disabled = page === 0;
  $("nextBtn").classList.toggle("hidden", page === 19);
  $("submitBtn").classList.toggle("hidden", page !== 19);
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

  } else if (!files[page - 16]) {
    notice("يرجى إرفاق صورة الحل لهذا السؤال.");
    return;
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

    if (Object.keys(answers).length !== 16 ||
        Object.keys(files).length !== 4) {
      throw new Error(
        "تحقق من إجابة الأسئلة الستة عشر وإرفاق الصور الأربع."
      );
    }

    const score = quiz.mcq.reduce(
      (total, q, i) =>
        total + (answers[i] === Number(q.correct) ? 1 : 0),
      0
    );

    // Save student information and selected class.
    const submission = await addDoc(
      collection(db, "submissions"),
      {
        name,
        studentClass,
        answers,
        score,
        imagesCount: 4,
        createdAt: serverTimestamp()
      }
    );

    // Save the four compressed solution images.
    for (let i = 0; i < 4; i++) {
      const imageData = await compressImage(files[i]);

      await addDoc(
        collection(db, "submissions", submission.id, "images"),
        {
          questionNumber: i + 17,
          imageData,
          createdAt: serverTimestamp()
        }
      );
    }

    $("quizCard").classList.add("hidden");
    $("doneCard").classList.remove("hidden");

    $("doneText").textContent =
      `تم حفظ إجاباتك. علامتك الأولية: ${score} / 16.`;

  } catch (error) {
    notice("تعذر الإرسال: " + error.message);

    $("submitBtn").disabled = false;
    $("submitBtn").textContent = "إرسال الإجابات";
  }
};
