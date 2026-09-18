// Packages the sources for Mozilla Add-ons review.
//
// AMO requires the original sources for any add-on that ships bundled or
// minified code, together with instructions that reproduce the uploaded
// files exactly. See https://extensionworkshop.com/documentation/publish/source-code-submission/
//
// The archive is built from `git archive HEAD`, so it holds exactly the
// tracked files at the current commit: no node_modules, no build output, no
// local scratch files. Dependencies are fetched by `npm ci` from the
// lockfile during the reviewer's build.
//
// Writes extension/source/dingocoin-wallet-<version>-source.zip plus a
// SHA256SUMS next to it. Pass --allow-dirty to package a modified tree
// (the archive still reflects HEAD, not the working tree, so only do this
// knowingly).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const { version } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const manifestVersion = JSON.parse(
  readFileSync(path.join(root, "source/manifest.json"), "utf8"),
).version;

const problems = [];
if (manifestVersion !== version) {
  problems.push(
    `package.json is ${version} but source/manifest.json is ${manifestVersion}. ` +
      "Keep them in sync so the archive matches the uploaded version.",
  );
}

const dirty = git("status", "--porcelain");
if (dirty && !process.argv.includes("--allow-dirty")) {
  problems.push(
    "The working tree has uncommitted changes. The archive is built from " +
      "HEAD, so it would not contain them. Commit first, or pass " +
      `--allow-dirty if that is what you want.\n${dirty}`,
  );
}

if (problems.length > 0) {
  console.error(`Cannot package the sources:\n\n- ${problems.join("\n\n- ")}`);
  process.exit(1);
}

const commit = git("rev-parse", "HEAD");
const outDir = path.join(root, "extension/source");
const zipName = `dingocoin-wallet-${version}-source.zip`;
const zipPath = path.join(outDir, zipName);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// The commit is what makes the build reproducible, so state it in the
// archive rather than only in the submission notes.
const buildInfo = `Dingocoin Wallet ${version} - source archive

Commit:     ${commit}
Repository: https://github.com/dingocoin/dingobrowserwallet
Packaged:   ${new Date().toISOString()}

Build instructions are in README.md, under "Building from source (for
Mozilla Add-ons reviewers)".
`;
const buildInfoPath = path.join(outDir, "BUILD-INFO.txt");
writeFileSync(buildInfoPath, buildInfo);

git("archive", "--format=zip", "-9", `--output=${zipPath}`, "HEAD");
execFileSync("zip", ["-q", "-j", "-g", zipPath, buildInfoPath], { cwd: root });
rmSync(buildInfoPath);

// A reviewer cannot build without these, and a stray .gitignore rule or a
// file that was never committed would silently leave one out.
const required = [
  "BUILD-INFO.txt",
  "README.md",
  "package.json",
  "package-lock.json",
  "webpack.config.js",
  "tsconfig.json",
  ".babelrc",
  ".nvmrc",
  "source/manifest.json",
  "polyfills/crypto.js",
];
const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const missing = required.filter((file) => !listing.includes(file));
if (missing.length > 0) {
  console.error(
    `The archive is missing files needed to build it:\n- ${missing.join("\n- ")}`,
  );
  process.exit(1);
}
if (listing.some((file) => file.startsWith("node_modules/"))) {
  console.error("The archive contains node_modules. It should not.");
  process.exit(1);
}

const sha256 = createHash("sha256")
  .update(readFileSync(zipPath))
  .digest("hex");
writeFileSync(path.join(outDir, "SHA256SUMS"), `${sha256}  ${zipName}\n`);

const mb = (statSync(zipPath).size / 1024 / 1024).toFixed(2);
console.log(`Wrote extension/source/${zipName}`);
console.log(`  commit  ${commit}`);
console.log(`  files   ${listing.length}`);
console.log(`  size    ${mb} MB (AMO allows up to 200 MB)`);
console.log(`  sha256  ${sha256}`);
