// إدارة الثيم (Dark / Light)
const themeToggleBtn = document.getElementById("themeToggle");
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("app_theme", theme);
  if (themeToggleBtn) {
    themeToggleBtn.textContent = theme === "dark" ? "☀️" : "🌙";
  }
}
applyTheme(localStorage.getItem("app_theme") || "dark");
themeToggleBtn?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(current === "dark" ? "light" : "dark");
});

// دالة الكابتير الآمنة ضد Quota Limit
async function captureTabSafe(windowId, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    } catch (err) {
      if (err.message && err.message.includes("MAX_CAPTURE_VISIBLE_TAB")) {
        await new Promise((r) => setTimeout(r, 800));
      } else {
        throw err;
      }
    }
  }
  return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

let isPaused = false;
let isStopped = false;
let isRunning = false;

document.addEventListener("DOMContentLoaded", () => {
  const statusText = document.getElementById("statusText");
  const percentText = document.getElementById("percentText");
  const blocksContainer = document.getElementById("blocksContainer");
  const startBtn = document.getElementById("startBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const stopBtn = document.getElementById("stopBtn");
  const activeControls = document.getElementById("activeControls");

  // تجهيز المربعات
  blocksContainer.innerHTML = "";
  for (let i = 0; i < 16; i++) {
    const b = document.createElement("div");
    b.className = "block";
    blocksContainer.appendChild(b);
  }

  startBtn.addEventListener("click", async () => {
    if (isRunning) return;
    isRunning = true;
    isPaused = false;
    isStopped = false;

    startBtn.style.display = "none";
    activeControls.style.display = "flex";
    pauseBtn.textContent = "⏸ Pause";
    statusText.textContent = "Detecting scroll area...";

    await runCaptureProcess();
  });

  pauseBtn.addEventListener("click", () => {
    isPaused = !isPaused;
    if (isPaused) {
      pauseBtn.textContent = "▶ Continue";
      statusText.textContent = "Paused";
    } else {
      pauseBtn.textContent = "⏸ Pause";
      statusText.textContent = "Resuming capture...";
    }
  });

  stopBtn.addEventListener("click", () => {
    isStopped = true;
    isPaused = false;
    statusText.textContent = "Stopping...";
  });

  async function runCaptureProcess() {
    let tabId = null;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) {
        throw new Error("Cannot capture this page!");
      }
      tabId = tab.id;

      // إخفاء الـ scrollbars
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        css: "::-webkit-scrollbar { display: none !important; } html { scroll-behavior: auto !important; }"
      });

      // 1. الكاشف الذكي: كيعرف واش كاين Scroll فـ Gemini / ChatGPT ولا الصفحة عادية
      const [metricsRes] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const docHeight = Math.max(
            document.body.scrollHeight, document.documentElement.scrollHeight,
            document.body.offsetHeight, document.documentElement.offsetHeight
          );
          const windowScrollable = (docHeight - window.innerHeight) > 50;

          // تقليب على الحاوية ديال الشات (Gemini, ChatGPT, Claude)
          const candidates = document.querySelectorAll(
            'main, [role="main"], .conversation-container, .chat-history, .chat-mode-scroller, div, section'
          );

          let bestContainer = null;
          let maxScrollDiff = 0;

          for (const el of candidates) {
            if (el.clientHeight < 250 || el.clientWidth < (window.innerWidth * 0.35)) continue;
            const style = window.getComputedStyle(el);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
              const diff = el.scrollHeight - el.clientHeight;
              if (diff > maxScrollDiff) {
                maxScrollDiff = diff;
                bestContainer = el;
              }
            }
          }

          if (bestContainer && (maxScrollDiff > (docHeight - window.innerHeight) || !windowScrollable)) {
            bestContainer.setAttribute('data-target-scroller', 'true');
            return {
              isInner: true,
              totalHeight: bestContainer.scrollHeight,
              viewportHeight: bestContainer.clientHeight,
              viewportWidth: window.innerWidth,
              devicePixelRatio: window.devicePixelRatio || 1
            };
          }

          return {
            isInner: false,
            totalHeight: docHeight,
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth,
            devicePixelRatio: window.devicePixelRatio || 1
          };
        }
      });

      const { isInner, totalHeight, viewportHeight, viewportWidth, devicePixelRatio } = metricsRes.result;
      const totalSteps = Math.ceil(totalHeight / viewportHeight);
      const blocks = Array.from(blocksContainer.children);

      // 2. كنرجعو الشات لأول ميساج فـ الفوق قبل ما نبداو
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (isInner) => {
          if (isInner) {
            const el = document.querySelector('[data-target-scroller="true"]');
            if (el) el.scrollTop = 0;
          } else {
            window.scrollTo(0, 0);
          }
        },
        args: [isInner]
      });
      await new Promise((r) => setTimeout(r, 400));

      const captures = [];
      let currentY = 0;
      let step = 0;

      // 3. حلقة السكرول الشاملة
      while (currentY < totalHeight) {
        if (isStopped) {
          cleanUpAndReset(tab.id, "Capture stopped by user.", isInner);
          return;
        }

        while (isPaused) {
          if (isStopped) {
            cleanUpAndReset(tab.id, "Capture stopped by user.", isInner);
            return;
          }
          await new Promise((r) => setTimeout(r, 200));
        }

        statusText.textContent = `Capturing part ${step + 1}/${totalSteps}...`;

        // سكرول الشات أو الصفحة
        const [scrollRes] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (y, isInner) => {
            if (isInner) {
              const el = document.querySelector('[data-target-scroller="true"]');
              if (el) {
                el.scrollTop = y;
                return el.scrollTop;
              }
            }
            window.scrollTo(0, y);
            document.documentElement.scrollTop = y;
            document.body.scrollTop = y;
            return window.scrollY || document.documentElement.scrollTop || 0;
          },
          args: [currentY, isInner]
        });

        const actualY = scrollRes.result;

        // تحديث المربعات والنسبة
        const progressRatio = (step + 1) / totalSteps;
        const percentage = Math.min(100, Math.round(progressRatio * 100));
        percentText.textContent = `${percentage}%`;

        const activeIndex = Math.min(blocks.length - 1, Math.floor(progressRatio * blocks.length));
        blocks.forEach((b, idx) => {
          if (idx < activeIndex) b.className = "block done";
          else if (idx === activeIndex) b.className = "block active";
        });

        // مهلة 700ms باش محتوى الشات يترينديرا مزيان
        await new Promise((r) => setTimeout(r, 700));

        if (isStopped) {
          cleanUpAndReset(tab.id, "Capture stopped by user.", isInner);
          return;
        }

        const dataUrl = await captureTabSafe(tab.windowId);
        captures.push({ y: actualY, dataUrl });

        if (actualY + viewportHeight >= totalHeight) break;

        currentY += viewportHeight;
        step++;
      }

      blocks.forEach((b) => (b.className = "block done"));
      percentText.textContent = "100%";
      statusText.textContent = "Assembling full conversation...";

      // تنظيف وإعادة الصفحة لأصلها
      await cleanUpDOM(tab.id, isInner);

      // حفظ الداتا وفتح صفحة العرض
      await chrome.storage.local.set({
        screenshotData: {
          captures,
          width: viewportWidth,
          height: totalHeight,
          dpr: devicePixelRatio
        }
      });

      chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
      window.close();

    } catch (err) {
      console.error(err);
      if (tabId) await cleanUpDOM(tabId, true).catch(() => {});
      cleanUpAndReset(null, "Error: " + (err.message || "Failed"), false);
    }
  }

  async function cleanUpDOM(tabId, isInner) {
    if (!tabId) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (isInner) => {
        if (isInner) {
          const el = document.querySelector('[data-target-scroller="true"]');
          if (el) el.removeAttribute('data-target-scroller');
        }
        window.scrollTo(0, 0);
      },
      args: [isInner]
    }).catch(() => {});

    await chrome.scripting.removeCSS({
      target: { tabId },
      css: "::-webkit-scrollbar { display: none !important; } html { scroll-behavior: auto !important; }"
    }).catch(() => {});
  }

  async function cleanUpAndReset(tabId, message, isInner) {
    if (tabId) await cleanUpDOM(tabId, isInner);

    isRunning = false;
    isPaused = false;
    isStopped = false;

    statusText.textContent = message;
    percentText.textContent = "0%";
    activeControls.style.display = "none";
    startBtn.style.display = "block";
    startBtn.textContent = "▶ Start Again";

    const blocks = Array.from(blocksContainer.children);
    blocks.forEach((b) => (b.className = "block"));
  }
});