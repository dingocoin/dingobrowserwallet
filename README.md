# Dingocoin Wallet

A Dingocoin wallet browser extension (Manifest V3) for Chrome and Firefox, built with React and TypeScript.

Web pages can call the wallet through `window.dingo`:

- `getActiveAccountAddress()`
- `requestSign(hexContent)`
- `requestSignTransaction(vins, vouts)`

The user approves every signing request in a popup window.

New wallets use a 12-word recovery phrase (BIP39). Accounts derive at `m/44'/3'/0'/0/<index>`, the same path as Dingocoin's [BIP39 tool](https://github.com/dingocoin/bip39). Private keys (WIF) can still be imported, and accounts created by earlier versions keep working.

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

## License

MIT © The Dingocoin Project. See [LICENCE](LICENCE).
