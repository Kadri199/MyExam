import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const $ = id => document.getElementById(id);
let quiz = null;
let tests = [];
let selectedTestId = "wazifa2";
let activeTestId = "wazifa2";
let saveTimer = null;
let saving = false;
let pendingSave = false;
let dirty = false;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function status(message) { $("saveStatus").textContent = message; }
function toLocalDateTimeInput(timestamp) {
  const date = new Date(Number(timestamp));
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0,16);
}
function mathEditor(key) {
  return `<div style="margin:8px 0 15px;padding:10px;background:#f5f7fa;border-radius:8px;">
    <div style="font-size:13px;margin-bottom:7px;">أداة إدراج عبارة رياضية:</div>
    <math-field data-math-key="${key}" virtual-keyboard-mode="manual" style="display:block;width:100%;min-height:48px;padding:8px;border:1px solid #ccc;border-radius:6px;background:white;"></math-field>
    <button type="button" class="secondary" data-insert-math="${key}" style="margin-top:7px;">إدراج العبارة في النص</button>
  </div>`;
}
function renderTestManager() {
  $("testManager").innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">
    ${tests.map(t=>`<button type="button" data-test="${esc(t.id)}" class="${t.id===selectedTestId?"primary":"secondary"}">${esc(t.title||"اختبار")} ${t.id===activeTestId?"— منشور":""}</button>`).join("")}
    <button id="addTestBtn" class="secondary" type="button">＋ إضافة اختبار</button>
  </div>
  <button id="publishTestBtn" class="primary" type="button">نشر الاختبار المحدد للتلاميذ</button>`;
  document.querySelectorAll("[data-test]").forEach(button => button.onclick = async () => {
    if (dirty && !await saveNow()) return;
    selectedTestId = button.dataset.test;
    await loadQuiz();
    renderTestManager();
  });
  $("addTestBtn").onclick = addTest;
  $("publishTestBtn").onclick = publishSelectedTest;
}
async function loadTests() {
  const legacy = await getDoc(doc(db,"settings","quiz"));
  const base = legacy.exists() ? legacy.data() : {
    title:"وظيفة 2",
    mcq:Array.from({length:16},(_,i)=>({q:`السؤال ${i+1}`,options:["الخيار الأول","الخيار الثاني","الخيار الثالث"],correct:0})),
    imageQuestions:[{q:"السؤال 17 — الحل الكامل"}]
  };
  const snap = await getDocs(collection(db,"examTests"));
  tests = snap.docs.map(d=>({id:d.id,...d.data()}));
  if (!tests.some(t=>t.id==="wazifa2")) {
    base.title = "وظيفة 2";
    base.startAt = base.startAt || Date.now();
    base.endAt = base.endAt || new Date("2026-11-24T23:59:00+01:00").getTime();
    await setDoc(doc(db,"examTests","wazifa2"),base);
    tests.push({id:"wazifa2",...base});
  }
  const metaRef = doc(db,"settings","exams");
  const metaSnap = await getDoc(metaRef);
  const meta = metaSnap.exists() ? metaSnap.data() : {};
  activeTestId = meta.activeTestId && tests.some(t=>t.id===meta.activeTestId) ? meta.activeTestId : "wazifa2";
  await setDoc(metaRef,{activeTestId,tests:tests.map(t=>({id:t.id,title:t.title}))},{merge:true});
  selectedTestId = activeTestId;
  renderTestManager();
  await loadQuiz();
}
async function loadQuiz() {
  const snap = await getDoc(doc(db,"examTests",selectedTestId));
  if (!snap.exists()) throw new Error("الاختبار غير موجود");
  quiz = snap.data();
  if (!Array.isArray(quiz.mcq)) quiz.mcq = [];
  if (!Array.isArray(quiz.imageQuestions) || !quiz.imageQuestions.length) quiz.imageQuestions = [{q:"السؤال 17 — الحل الكامل"}];
  $("testTitle").value = quiz.title || "";
  $("testStartAt").value = toLocalDateTimeInput(quiz.startAt || Date.now());
  $("testEndAt").value = toLocalDateTimeInput(quiz.endAt || Date.now());
  $("currentTestTitle").textContent = "تحرير: " + (quiz.title || "اختبار");
  renderEditor();
  dirty = false;
  status("تم تحميل الاختبار. الحفظ التلقائي جاهز.");
}
function renderEditor() {
  let html = "";
  quiz.mcq.forEach((q,i) => {
    html += `<section class="panel editor-q"><h3>السؤال ${i+1} — اختيار من متعدد</h3>
      <label>نص السؤال<textarea rows="3" data-q="${i}" data-field="q" data-editor-key="q-${i}">${esc(q.q)}</textarea></label>
      ${mathEditor(`q-${i}`)}
      <div class="grid">${(q.options||[]).map((o,j)=>`<div><label>الخيار ${j+1}<textarea rows="2" data-q="${i}" data-option="${j}" data-editor-key="o-${i}-${j}">${esc(o)}</textarea></label>${mathEditor(`o-${i}-${j}`)}</div>`).join("")}</div>
      <label>الإجابة الصحيحة<select data-q="${i}" data-field="correct">${[0,1,2].map(n=>`<option value="${n}" ${Number(q.correct)===n?"selected":""}>الخيار ${n+1}</option>`).join("")}</select></label>
    </section>`;
  });
  quiz.imageQuestions.forEach((q,i) => {
    html += `<section class="panel editor-q"><h3>السؤال ${i+17} — إجابة بصورة</h3>
      <label>نص السؤال<textarea rows="3" data-imgq="${i}" data-editor-key="img-${i}">${esc(q.q)}</textarea></label>
      ${mathEditor(`img-${i}`)}
    </section>`;
  });
  $("editor").innerHTML = html;
  document.querySelectorAll("[data-insert-math]").forEach(button => button.onclick = () => {
    const key = button.dataset.insertMath;
    const formula = document.querySelector(`[data-math-key="${key}"]`);
    const target = document.querySelector(`[data-editor-key="${key}"]`);
    if (!formula || !target) return;
    const latex = formula.value.trim();
    if (!latex) { status("أدخل العبارة الرياضية أولاً."); return; }
    const expression = ` \\(${latex}\\) `;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    target.value = target.value.slice(0,start) + expression + target.value.slice(end);
    const cursor = start + expression.length;
    target.focus(); target.setSelectionRange(cursor,cursor);
    formula.value = "";
    scheduleAutosave();
  });
}
function collectEditorValues() {
  if (!quiz) return;
  quiz.title = $("testTitle").value.trim();
  document.querySelectorAll("[data-q][data-field]").forEach(el => {
    const i = Number(el.dataset.q);
    if (quiz.mcq[i]) quiz.mcq[i][el.dataset.field] = el.dataset.field==="correct" ? Number(el.value) : el.value;
  });
  document.querySelectorAll("[data-q][data-option]").forEach(el => {
    const q = quiz.mcq[Number(el.dataset.q)];
    if (q?.options) q.options[Number(el.dataset.option)] = el.value;
  });
  document.querySelectorAll("[data-imgq]").forEach(el => {
    const q = quiz.imageQuestions[Number(el.dataset.imgq)];
    if (q) q.q = el.value;
  });
  const startAt = Date.parse($("testStartAt").value);
  const endAt = Date.parse($("testEndAt").value);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) throw new Error("يرجى تحديد تاريخ بداية ونهاية صحيحين.");
  quiz.startAt = startAt;
  quiz.endAt = endAt;
}
function scheduleAutosave() {
  dirty = true;
  status("توجد تعديلات — جارٍ انتظار الحفظ التلقائي...");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(), 1000);
}
async function saveNow() {
  if (!quiz) return false;
  clearTimeout(saveTimer);
  try {
    collectEditorValues();
    if (saving) { pendingSave = true; return true; }
    saving = true;
    status("جارٍ الحفظ تلقائياً...");
    await setDoc(doc(db,"examTests",selectedTestId),quiz);
    if (selectedTestId==="wazifa2") await setDoc(doc(db,"settings","quiz"),quiz);
    const idx = tests.findIndex(t=>t.id===selectedTestId);
    if (idx>=0) tests[idx] = {id:selectedTestId,...quiz};
    const metaSnap = await getDoc(doc(db,"settings","exams"));
    const meta = metaSnap.exists()?metaSnap.data():{};
    await setDoc(doc(db,"settings","exams"),{activeTestId:meta.activeTestId||activeTestId,tests:tests.map(t=>({id:t.id,title:t.title}))},{merge:true});
    dirty = false;
    status("✓ تم الحفظ " + new Date().toLocaleTimeString("ar-DZ"));
    renderTestManager();
    if (pendingSave) { pendingSave = false; saving = false; return await saveNow(); }
    saving = false;
    return true;
  } catch (error) {
    saving = false;
    status("تعذر الحفظ: " + error.message);
    return false;
  }
}
async function addTest() {
  if (dirty && !await saveNow()) return;
  const title = prompt("اكتب اسم الاختبار الجديد");
  if (!title?.trim()) return;
  const id = "test_" + Date.now();
  const item = {
    title:title.trim(),
    startAt:Date.now(),
    endAt:Date.now()+7*24*60*60*1000,
    mcq:Array.from({length:16},(_,i)=>({q:`السؤال ${i+1}`,options:["الخيار الأول","الخيار الثاني","الخيار الثالث"],correct:0})),
    imageQuestions:[{q:"السؤال 17 — الحل الكامل"}]
  };
  await setDoc(doc(db,"examTests",id),item);
  tests.push({id,...item});
  selectedTestId = id;
  const metaSnap = await getDoc(doc(db,"settings","exams"));
  const meta = metaSnap.exists()?metaSnap.data():{};
  await setDoc(doc(db,"settings","exams"),{activeTestId:meta.activeTestId||activeTestId,tests:tests.map(t=>({id:t.id,title:t.title}))},{merge:true});
  renderTestManager();
  await loadQuiz();
}
async function publishSelectedTest() {
  if (dirty && !await saveNow()) return;
  await setDoc(doc(db,"settings","exams"),{activeTestId:selectedTestId,tests:tests.map(t=>({id:t.id,title:t.title}))},{merge:true});
  activeTestId = selectedTestId;
  renderTestManager();
  status("تم نشر الاختبار المحدد للتلاميذ.");
}
$("editor").addEventListener("input",scheduleAutosave);
$("editor").addEventListener("change",scheduleAutosave);
["testTitle","testStartAt","testEndAt"].forEach(id => {
  $(id).addEventListener("input",scheduleAutosave);
  $(id).addEventListener("change",scheduleAutosave);
});
$("saveQuizBtn").onclick = async () => {
  const ok = await saveNow();
  if (ok) status("✓ تم الحفظ النهائي بنجاح.");
};
onAuthStateChanged(auth, async user => {
  if (!user || user.isAnonymous || user.email !== "afterdark706@gmail.com") {
    $("editorLoginMessage").classList.remove("hidden");
    $("examEditorApp").classList.add("hidden");
    return;
  }
  $("editorLoginMessage").classList.add("hidden");
  $("examEditorApp").classList.remove("hidden");
  try { await loadTests(); }
  catch (error) { status("تعذر تحميل الاختبارات: " + error.message); }
});
window.addEventListener("beforeunload", event => {
  if (dirty) { event.preventDefault(); event.returnValue = ""; }
});
