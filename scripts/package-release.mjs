// Packages the Chrome build in extension/chrome as an official release:
// checks that it is a release build (not a test build) of the version in
// package.json, then writes extension/release/ with a versioned zip and
// SHA256SUMS. Run `npm run build:chrome` first.
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

const { version } = read("package.json");
const builtManifestPath = path.join(root, "extension/chrome/manifest.json");
const zipPath = path.join(root, "extension/chrome.zip");

const problems = [];
if (!existsSync(builtManifestPath) || !existsSync(zipPath)) {
  problems.push("No Chrome build found. Run `npm run build:chrome` first.");
} else {
  const built = JSON.parse(readFileSync(builtManifestPath, "utf8"));
  if (built.version !== version) {
    problems.push(`Built manifest is version ${built.version}, package.json is ${version}.`);
  }
  if ("key" in built || "version_name" in built || /test build/i.test(built.name)) {
    problems.push("extension/chrome is a test build. Run `npm run build:chrome`.");
  }
  if (statSync(zipPath).mtimeMs < statSync(builtManifestPath).mtimeMs) {
    problems.push("extension/chrome.zip is older than the build. Run `npm run build:chrome`.");
  }
}
const sourceVersion = read("source/manifest.json").version;
if (sourceVersion !== version) {
  problems.push(
    `source/manifest.json is version ${sourceVersion}, package.json is ${version}. Keep them in sync.`
  );
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  problems.push(`Version ${version} must be MAJOR.MINOR.PATCH (Chrome only accepts numbers).`);
}
if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`error: ${problem}`);
  }
  process.exit(1);
}

const releaseDir = path.join(root, "extension/release");
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

const chromeZip = `dingocoin-wallet-${version}-chrome.zip`;
copyFileSync(zipPath, path.join(releaseDir, chromeZip));
const sha256 = createHash("sha256")
  .update(readFileSync(path.join(releaseDir, chromeZip)))
  .digest("hex");
writeFileSync(path.join(releaseDir, "SHA256SUMS"), `${sha256}  ${chromeZip}\n`);

console.log(`Packaged Dingocoin Wallet ${version} in extension/release/:`);
console.log(`  ${chromeZip}  sha256 ${sha256}`);
console.log("  SHA256SUMS");

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${version}\nchrome_zip=${chromeZip}\nsha256=${sha256}\n`
  );
}
