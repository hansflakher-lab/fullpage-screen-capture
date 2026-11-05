chrome.action.onClicked.addListener(async (tab) => {
  // التأكد من أن الصفحة مسموح تصويرها
  if (!tab.id || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("https://chromewebstore.google.com")) {
    alert("هاد الصفحة ما يمكنش يتخاد ليها كابتير، جرب فـ موقع عادي بحال Wikipedia!");
    return;
  }

  try {
    // تبين علامة فوق الأيقونة بلي راه بادي
    chrome.action.setBadgeText({ text: "📸" });

    // 1. نخفيو الـ scrollbar
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      css: "::-webkit-scrollbar { display: none !important; }"
    });

    // 2. حساب الطول والعرض
    const [dimResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        totalHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        devicePixelRatio: window.devicePixelRatio || 1
      })
    });

    const { totalHeight, viewportHeight, viewportWidth, devicePixelRatio } = dimResult.result;
    const captures = [];
    let currentY = 0;

    // 3. السكرول وأخذ الصور
    while (currentY < totalHeight) {
      const [scrollRes] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (y) => {
          window.scrollTo(0, y);
          return window.scrollY;
        },
        args: [currentY]
      });

      const actualY = scrollRes.result;
      await new Promise((r) => setTimeout(r, 250));

      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
      captures.push({ y: actualY, dataUrl });

      if (actualY + viewportHeight >= totalHeight) break;
      currentY += viewportHeight;
    }

    // 4. ترجيع السكرول والـ scrollbar
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.scrollTo(0, 0)
    });

    await chrome.scripting.removeCSS({
      target: { tabId: tab.id },
      css: "::-webkit-scrollbar { display: none !important; }"
    });

    // حيد العلامة من الأيقونة
    chrome.action.setBadgeText({ text: "" });

    // 5. حفظ البيانات وفتح الصفحة
    await chrome.storage.local.set({
      screenshotData: {
        captures,
        width: viewportWidth,
        height: totalHeight,
        dpr: devicePixelRatio
      }
    });

    chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });

  } catch (err) {
    chrome.action.setBadgeText({ text: "" });
    console.error("Error:", err);
    alert("وقع خطأ: " + err.message);
  }
});