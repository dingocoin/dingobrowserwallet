# Dingocoin Wallet

A Dingocoin wallet browser extension (Manifest V3) for Chrome and Firefox, built with React and TypeScript.

Web pages can call the wallet through `window.dingo`:

- `getActiveAccountAddress()`
- `requestSign(hexContent)`
- `requestSignTransaction(vins, vouts)`

The user approves every signing request in a popup window.

New wallets use a 12-word seed phrase (BIP39). Accounts derive at `m/44'/3'/0'/0/<index>`, the same path as Dingocoin's [BIP39 tool](https://github.com/dingocoin/bip39). Private keys (WIF) can still be imported, and accounts created by earlier versions keep working.

## Requirements

- [Node.js](https://nodejs.org) 24 LTS (see `.nvmrc`)
- npm (bundled with Node.js)

## Development

```sh
npm ci                 # install dependencies from package-lock.json
npm run dev:chrome     # rebuild extension/chrome on change
npm run dev:firefox    # rebuild extension/firefox on change
```

Load the unpacked build in a browser:

- **Chrome**: open `chrome://extensions`, enable Developer mode, click **Load unpacked** and select `extension/chrome`.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and select `extension/firefox/manifest.json`.

## Checks

```sh
npm run lint        # ESLint
npm run typecheck   # TypeScript
npm test            # node:test known-answer tests for source/dingocoin.js
```

## Test builds

Every pull request and every push to `master` builds the extension in CI. The PR gets a comment, and the run summary gets a section, both linking to `dingocoin-wallet-<version>-<commit>-chrome-test.zip`. To install it:

1. Download the zip. Don't extract it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Drag the zip onto the page.

Test builds show as **Dingocoin Wallet (test build)**, with the commit in the version. They share a fixed extension ID, so dropping a newer test build replaces the previous one and keeps its accounts. Because that ID differs from the Chrome Web Store release, a test build never touches a store install's wallet. To make one locally, run `npm run build:chrome:test`, which writes `extension/chrome-test.zip`.

## Production build

```sh
npm run build       # extension/chrome.zip and extension/firefox.xpi
```

The version in `source/manifest.json` is replaced at build time with the `version` from `package.json`.

## Releasing

Official releases are Chrome packages published as GitHub Releases. Test builds are never released.

1. **Bump the version.** Update `version` in both `package.json` and `source/manifest.json`, for example with `npm version 1.0.1 --no-git-tag-version`, then edit the manifest by hand. Merge the change to `master`.
2. **Run the Release workflow.** Open **Actions → Release → Run workflow** on `master`.
   - **What it checks:** that the version hasn't been released yet, plus lint, typecheck and tests.
   - **What it builds:** the Chrome release package, which it also confirms is a release build (no test key) of that version.
   - **What it creates:** a **draft** release `v<version>` with `dingocoin-wallet-<version>-chrome.zip`, `SHA256SUMS`, install instructions and generated notes.
3. **Publish.** Review the draft and click **Publish release**, which creates the `v<version>` tag.
4. **Upload to the store.** Upload the zip to the Chrome Web Store developer dashboard.

To make the same package locally, run `npm run build:chrome && npm run package:release`. It writes to `extension/release/`.

The Firefox build (`extension/firefox.xpi`) works as a temporary add-on for testing. Go to `about:debugging` → **Load Temporary Add-on** and pick the xpi or `extension/firefox/manifest.json`. It is not part of official releases yet, because a permanent Firefox install requires signing by Mozilla (addons.mozilla.org).

### Browser-specific manifest keys

`source/manifest.json` is processed by [`wext-manifest-loader`](https://github.com/abhijithvijayan/wext-manifest-loader). Prefix a key with vendors to include it only in those builds:

```json
{
  "__chrome__minimum_chrome_version": "88",
  "__chrome|opera__name": "Only in Chromium builds"
}
```

## Building from source (for Mozilla Add-ons reviewers)

This add-on ships bundled and minified code, so Mozilla requires the sources
and instructions that reproduce the uploaded files. Everything needed is in
this archive; `BUILD-INFO.txt` names the exact commit it was made from.

**Environment.** Any OS with [Node.js](https://nodejs.org) 24 (`.nvmrc` pins
the major; `package.json` requires >= 24.11.0) and the bundled npm. This
matches the default AMO reviewer image (Ubuntu 24.04, Node 24, npm 11), so no
special setup is needed. No other tools, no global installs, and nothing
web-based.

**Build.**

```bash
npm ci                  # installs exactly the versions in package-lock.json
npm run build:firefox
```

**Output.** `extension/firefox/` is the unpacked add-on and
`extension/firefox.xpi` is the packaged one. The xpi is what was uploaded.

**Reproducibility.** Building this archive in a clean container with an empty
npm cache reproduces every file in `extension/firefox/` byte for byte. Compare
the contents rather than the xpi's own checksum: the zip container records
timestamps, so the packaged file differs between builds even when every file
inside it is identical.

**Toolchain.** [webpack](https://webpack.js.org) bundles the five entry points
(`background`, `popup`, `signData`, `signTransaction`, `setup`);
[Babel](https://babeljs.io) transpiles TypeScript and JSX;
[Terser](https://terser.org) and
[cssnano](https://cssnano.github.io/cssnano/) minify;
[sass](https://sass-lang.com) compiles the SCSS;
`html-webpack-plugin` fills the templates in `views/`; and
[`wext-manifest-loader`](https://github.com/abhijithvijayan/wext-manifest-loader)
turns `source/manifest.json` into a per-browser manifest, dropping the
`__chrome__`/`__firefox__` key prefixes and taking `version` from
`package.json`. All of it is open source and configured in
`webpack.config.js`. No obfuscation is used.

**Dependencies.** `npm ci` fetches everything from the npm registry, with one
exception: `bitcoinjs-lib` is a fork pinned to an immutable commit,
`git+https://github.com/rkbling/bitcoinjs-lib.git#001c194c4ab8373aa893e04bba7091f2bc471ca4`.
It is public and npm clones it over HTTPS during the install, so no
credentials are needed. The fork changes two files against upstream 6.0.1,
`src/bufferutils.js` and `src/types.js`, to read and write 64-bit satoshi
amounts as `BigInt`. Upstream caps amounts at Bitcoin's 21 million coins and
at `2^53 - 1`, which cannot represent Dingocoin's supply. No cryptographic
code is changed. `npm ls bitcoinjs-lib` shows the pinned commit, and
`diff -r` against `bitcoinjs-lib@6.0.1` from the registry shows the two
files.

**Checks.** `npm run lint`, `npm run typecheck`, and `npm test` all pass.
`npm run lint:firefox` runs Mozilla's addons-linter and reports 0 errors.

**Reproducing the archive.** `npm run package:source` rebuilds it from the
tracked files at HEAD.

## License

MIT © The Dingocoin Project. See [LICENCE](LICENCE).
