// تطبيق الثيم فـ صفحة العرض
const themeToggleBtn = document.getElementById("themeToggle");
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("app_theme", theme);
  if (themeToggleBtn) themeToggleBtn.textContent = theme === "dark" ? "☀️" : "🌙";
}
applyTheme(localStorage.getItem("app_theme") || "dark");

themeToggleBtn?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(current === "dark" ? "light" : "dark");
});

document.addEventListener("DOMContentLoaded", async () => {
  const statusText = document.getElementById("status");
  const downloadBtn = document.getElementById("downloadBtn");
  const previewImg = document.getElementById("preview");

  const { screenshotData } = await chrome.storage.local.get("screenshotData");
  if (!screenshotData || !screenshotData.captures) {
    statusText.textContent = "No screenshot data found.";
    return;
  }

  const { captures, width, height, dpr } = screenshotData;
  const canvas = document.createElement("canvas");
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");

  const loadImage = (src) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });

  try {
    for (let i = 0; i < captures.length; i++) {
      statusText.textContent = `Stitching image (${i + 1}/${captures.length})...`;
      const img = await loadImage(captures[i].dataUrl);
      ctx.drawImage(img, 0, captures[i].y * dpr);
    }

    statusText.textContent = "Ready!";
    const fullImageUri = canvas.toDataURL("image/png");
    previewImg.src = fullImageUri;
    downloadBtn.style.display = "inline-block";

    downloadBtn.onclick = () => {
      const a = document.createElement("a");
      a.href = fullImageUri;
      a.download = `screenshot_${Date.now()}.png`;
      a.click();
    };
  } catch (e) {
    console.error(e);
    statusText.textContent = "Error assembling image.";
  }
});