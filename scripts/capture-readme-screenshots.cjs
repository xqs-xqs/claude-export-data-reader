const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "docs", "screenshots");
const viewport = { width: 1800, height: 1125 };

app.commandLine.appendSwitch("force-device-scale-factor", "1.25");
app.commandLine.appendSwitch("disable-background-timer-throttling");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(window, expression, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await window.webContents.executeJavaScript(
      `Boolean(${expression})`
    );
    if (ready) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function settle(window) {
  await window.webContents.executeJavaScript(
    "document.fonts && document.fonts.ready"
  );
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
  );
  window.webContents.invalidate();
  await delay(1200);
}

async function capture(window, filename) {
  await settle(window);
  const image = await window.webContents.capturePage();
  await writeFile(path.join(outputDirectory, filename), image.toPNG());
  console.log(`${filename}: ${image.getSize().width}x${image.getSize().height}`);
}

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(source);
}

app.whenReady().then(async () => {
  await mkdir(outputDirectory, { recursive: true });

  const window = new BrowserWindow({
    ...viewport,
    show: false,
    frame: false,
    backgroundColor: "#f7f7f5",
    webPreferences: {
      backgroundThrottling: false,
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `readme-screenshots-${Date.now()}`
    }
  });

  try {
    await window.loadFile(path.join(root, "dist", "index.html"), {
      query: { demo: "1" }
    });
    await waitFor(window, "document.querySelector('.conversation')", "demo conversation");
    await evaluate(
      window,
      `localStorage.setItem("theme", "light");
       localStorage.setItem("outline-open", "true");
       document.querySelector(".conversation-scroll").scrollTop = 0;`
    );
    await capture(window, "01-reader-overview.png");

    await evaluate(
      window,
      `(() => {
        const scroller = document.querySelector(".conversation-scroll");
        const target = document.querySelector(".markdown table");
        if (!scroller || !target) return false;
        const top = scroller.scrollTop + target.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top - 540;
        scroller.scrollTop = Math.max(0, top);
        return true;
      })()`
    );
    await capture(window, "02-rich-content.png");

    await evaluate(window, `document.querySelector(".search-launch").click()`);
    await waitFor(
      window,
      "document.querySelector('.global-search-dialog[open]')",
      "global search dialog"
    );
    await evaluate(
      window,
      `(() => {
        const input = document.querySelector(".global-search-input input");
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        ).set;
        setter.call(input, "本地");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()`
    );
    await waitFor(
      window,
      "document.querySelectorAll('.global-search-group').length > 0",
      "search results"
    );
    await capture(window, "03-full-text-search.png");

    await evaluate(
      window,
      `document.querySelector('[aria-label="关闭全局搜索"]').click()`
    );
    await waitFor(
      window,
      "!document.querySelector('.global-search-dialog[open]')",
      "search dialog to close"
    );
    await evaluate(window, `document.querySelector(".library-view-button").click()`);
    await waitFor(
      window,
      "document.querySelector('.structured-memory-list')",
      "structured memory list"
    );
    await evaluate(
      window,
      `document.querySelector(".conversation-scroll").scrollTop = 0;
       document.querySelector(".account-card").click();`
    );
    await waitFor(window, "document.querySelector('.account-menu')", "account menu");
    await capture(window, "04-memory-and-accounts.png");
  } finally {
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
