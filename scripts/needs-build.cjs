"use strict";

const { readdirSync, statSync } = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const rendererEntry = path.join(projectRoot, "dist", "index.html");
const buildInputs = [
  path.join(projectRoot, "src"),
  path.join(projectRoot, "index.html"),
  path.join(projectRoot, "vite.config.ts"),
  path.join(projectRoot, "tsconfig.json"),
  path.join(projectRoot, "package.json"),
  path.join(projectRoot, "package-lock.json")
];

function newestModifiedTime(targetPath) {
  const stats = statSync(targetPath);
  if (!stats.isDirectory()) return stats.mtimeMs;

  let newest = stats.mtimeMs;
  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    const entryPath = path.join(targetPath, entry.name);
    newest = Math.max(newest, newestModifiedTime(entryPath));
  }
  return newest;
}

function rendererNeedsBuild() {
  let outputModifiedTime;
  try {
    outputModifiedTime = statSync(rendererEntry).mtimeMs;
  } catch {
    return true;
  }

  try {
    return buildInputs.some(
      (inputPath) => newestModifiedTime(inputPath) > outputModifiedTime
    );
  } catch {
    // A missing or unreadable build input should fall back to the safe path.
    return true;
  }
}

if (rendererNeedsBuild()) {
  console.log("Renderer sources changed or no build was found.");
  process.exitCode = 1;
} else {
  console.log("Existing renderer build is current.");
}
