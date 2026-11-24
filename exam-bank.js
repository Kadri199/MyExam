import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const $ = id => document.getElementById(id);

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const terms = { term1: "الفصل الأول", term2: "الفصل الثاني", term3: "الفصل الثالث" };
let allPhotos = [];
let selectedTerm = "term1";

function formatDate(value) {
  if (!value || typeof value.toDate !== "function") return "";
  return value.toDate().toLocaleDateString("ar-DZ");
}

function renderPublicGallery() {
  const gallery = $("bankGallery");
  if (!gallery) return;

  const photos = allPhotos.filter(photo => photo.trimester === selectedTerm)
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

  document.querySelectorAll("[data-bank-term]").forEach(button => {
    const active = button.dataset.bankTerm === selectedTerm;
    button.style.background = active ? "#173b67" : "";
    button.style.color = active ? "#fff" : "";
  });

  if (!photos.length) {
    gallery.innerHTML = '<p class="muted small">لا توجد صور مضافة في هذا الفصل حالياً.</p>';
    return;
  }

  gallery.innerHTML = photos.map(photo => {
    const safeTitle = escapeHtml(photo.title || "فرض أو اختبار");
    const safeDate = escapeHtml(formatDate(photo.createdAt));
    const safeFile = escapeHtml((photo.title || "exam").replace(/[\\/:*?"<>|]/g, "-")) + ".jpg";
    return '<article style="border:1px solid #e2eaf5;border-radius:13px;padding:13px;margin:12px 0;background:#fff;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
      '<strong>' + safeTitle + '</strong><span class="muted small">' + safeDate + '</span></div>' +
      '<img src="' + photo.imageData + '" alt="' + safeTitle + '" loading="lazy" ' +
      'style="display:block;width:100%;height:auto;max-height:850px;object-fit:contain;border-radius:9px;background:#f3f7fd;">' +
      '<a href="' + photo.imageData + '" download="' + safeFile + '" class="secondary" ' +
      'style="display:inline-block;margin-top:12px;padding:9px 14px;border-radius:9px;font-weight:700;">⬇ تنزيل الصورة</a></article>';
  }).join("");
}

document.querySelectorAll("[data-bank-term]").forEach(button => {
  button.addEventListener("click", () => {
    selectedTerm = button.dataset.bankTerm;
    renderPublicGallery();
  });
});

onSnapshot(collection(db, "examBank"), snapshot => {
  allPhotos = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  renderPublicGallery();
  renderAdminList();
}, error => {
  const gallery = $("bankGallery");
  if (gallery) gallery.innerHTML = '<p class="muted small">تعذر تحميل المكتبة حالياً. حاول مجدداً لاحقاً.</p>';
  console.error("Exam bank read error:", error);
});

function renderAdminList() {
  const list = $("bankAdminList");
  if (!list) return;

  const currentTerm = $("bankTrimester")?.value || "term1";
  const photos = allPhotos.filter(photo => photo.trimester === currentTerm)
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

  if (!photos.length) {
    list.innerHTML = '<p class="muted small">لا توجد صور في هذا الفصل بعد.</p>';
    return;
  }

  list.innerHTML = photos.map(photo =>
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #e2eaf5;padding:10px 0;">' +
    '<span>' + escapeHtml(photo.title || "فرض أو اختبار") + '</span>' +
    '<button type="button" class="secondary" data-bank-delete="' + escapeHtml(photo.id) + '">حذف</button></div>'
  ).join("");

  list.querySelectorAll("[data-bank-delete]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!confirm("هل تريد حذف هذه الصورة نهائياً؟")) return;
      button.disabled = true;
      try {
        await deleteDoc(doc(db, "examBank", button.dataset.bankDelete));
      } catch (error) {
        alert("تعذر حذف الصورة: " + error.message);
        button.disabled = false;
      }
    });
  });
}

$("bankTrimester")?.addEventListener("change", renderAdminList);

function fileToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("تعذرت قراءة الصورة."));
    reader.readAsDataURL(blob);
  });
}

async function compressPhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error("اختر ملفات صور فقط.");
  if (typeof createImageBitmap !== "function") throw new Error("يرجى تحديث المتصفح لدعم ضغط الصور.");

  const bitmap = await createImageBitmap(file);
  let width = bitmap.width;
  let height = bitmap.height;
  const maxSide = 1500;

  if (Math.max(width, height) > maxSide) {
    const scale = maxSide / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  while (true) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.78));
    if (blob && blob.size <= 480 * 1024) {
      bitmap.close?.();
      return fileToDataUrl(blob);
    }

    if (width <= 750 || height <= 750) {
      bitmap.close?.();
      throw new Error("حجم الصورة كبير بعد الضغط. اختر صورة أصغر.");
    }

    width = Math.round(width * 0.82);
    height = Math.round(height * 0.82);
  }
}

const uploadButton = $("uploadBankBtn");
if (uploadButton) {
  onAuthStateChanged(auth, user => {
    const isTeacher = !!user && !user.isAnonymous &&
      user.providerData.some(provider => provider.providerId === "password");
    const panel = $("examBankAdmin");
    if (panel) panel.classList.toggle("hidden", !isTeacher);
    if (!isTeacher && $("bankUploadStatus")) $("bankUploadStatus").textContent = "";
  });

  uploadButton.addEventListener("click", async () => {
    const files = Array.from($("bankPhotos")?.files || []);
    const title = $("bankTitle")?.value.trim() || "";
    const trimester = $("bankTrimester")?.value || "term1";
    const status = $("bankUploadStatus");

    if (!files.length) { status.textContent = "اختر صورة واحدة على الأقل."; return; }
    if (files.length > 8) { status.textContent = "يمكن رفع 8 صور كحد أقصى في كل مرة."; return; }
    if (!terms[trimester]) { status.textContent = "اختر فصلاً صحيحاً."; return; }

    uploadButton.disabled = true;
    let uploaded = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        status.textContent = "جارٍ ضغط ورفع الصورة " + (i + 1) + " من " + files.length + "...";
        const imageData = await compressPhoto(files[i]);
        await addDoc(collection(db, "examBank"), {
          title: title || files[i].name.replace(/\.[^.]+$/, ""),
          trimester,
          imageData,
          fileName: files[i].name.slice(0, 180),
          createdAt: serverTimestamp()
        });
        uploaded++;
      }
      status.textContent = "تم رفع " + uploaded + " صورة بنجاح.";
      $("bankPhotos").value = "";
      $("bankTitle").value = "";
    } catch (error) {
      status.textContent = "تم رفع " + uploaded + " صورة. تعذر إكمال الرفع: " + error.message;
    } finally {
      uploadButton.disabled = false;
    }
  });
}
