# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Dingocoin wallet browser extension (Manifest V3) built with React 17 + TypeScript. It began as the `abhijithvijayan/web-extension-starter` template. `README.md` is still that template's README, so some of it is out of date. For example, the `opera` scripts it lists do not exist in `package.json`.

## Commands

```bash
yarn install
yarn dev:chrome        # webpack --watch → extension/chrome/
yarn dev:firefox       # webpack --watch → extension/firefox/
yarn build:chrome      # production build → extension/chrome/ + extension/chrome.zip
yarn build:firefox     # production build → extension/firefox/ + extension/firefox.xpi
yarn build             # both
yarn lint              # eslint on .ts/.tsx only (plain .js files are not linted)
yarn lint:fix
```

- There is no test suite.
- Babel only transpiles. Type errors come from `fork-ts-checker-webpack-plugin` during a webpack build, so run a build to type-check.
- To load the build, open `chrome://extensions`, turn on Developer Mode, and use "Load unpacked" on `extension/chrome`. In Firefox, use `about:debugging` and pick `extension/firefox/manifest.json`.
- The toolchain is old: webpack 4, node-sass 4, and TypeScript 4.1. CI (`.travis.yml`) uses Node 12, and node-sass 4 does not build on modern Node versions.
- The release version comes from `package.json`. `wext-manifest-loader` overwrites the `version` in `source/manifest.json` with it. Manifest keys with a vendor prefix, such as `__firefox__applications` or `__chrome|opera__...`, only go into that browser's build.

## Architecture

### Build entry points (`webpack.config.js`)
- `background`: `source/Background/index.ts`, the MV3 service worker.
- `popup`, `signData`, `signTransaction`: one React page each, in `source/<Name>/index.tsx`. Each has an HTML template in `views/<name>.html` that HtmlWebpackPlugin fills in.
- `source/assets/` is **copied verbatim, not bundled**. `assets/js/contentScript.js` and `assets/js/dingoApi.js` can't use imports. `contentScript.js` depends on `browser-polyfill.js`, which is copied from `node_modules` and loaded first through the manifest.

### Webpage → wallet signing flow
Messages pass through four contexts:

1. **`dingoApi.js`** is injected into the page's own JS context as a `<script>` tag. It defines `window.dingo`, which has `getActiveAccountAddress()`, `requestSign(hexContent)`, and `requestSignTransaction(vins, vouts)`. Each call sends a `window.postMessage` with `type: "DingoApi"` and a random `id`, then waits for a `DingoApiResponse` with the same `id`.
2. **`contentScript.js`** runs on every `https://*/*` page. It forwards those messages with `browser.runtime.sendMessage({request, origin})` and posts the response back to the page.
3. **`Background/index.ts`** answers `getActiveAccountAddress` directly from storage. For the signing actions, it opens a popup window at `signData.html` or `signTransaction.html` and passes the request in the **URL query string**:
   - `vins` becomes a flat list: `txid,vout,txid,vout,...`
   - `vouts` (an object) becomes `address,amount,...`
   - A vout key of `data` means an OP_RETURN payload in hex.
4. **The `SignData` / `SignTransaction` pages** ask for the account password, sign, and send `{result}` or `{error}` on `BroadcastChannel("dingo_bg_popup_" + id)`. The background is listening on that channel and resolves the original message with the reply.

When you add a new dApp-facing API method, all four files must change together.

`SignTransaction` treats the vins supplied by the dApp as contributing 0 to the fee or balance. It pulls every UTXO of the active account from the provider and adds them as extra inputs. Change goes back to the active account.

### Key modules
- **`source/dingocoin.js`**: all chain and crypto logic, in CommonJS.
  - Address version bytes: P2PKH `0x1e`, P2SH `0x16`. WIF prefix: `0x9e`.
  - Keys: secp256k1.
  - Transactions are built with a forked `bitcoinjs-lib`, with scriptSigs assembled by hand.
  - Encryption: AES-256-CBC with padding off (it relies on the 32-byte private key), keyed by PBKDF2-SHA512 with 20000 iterations.
  - It uses Node's `crypto` and `Buffer`, which work only because **webpack 4 polyfills Node core modules automatically**. Moving to webpack 5 requires adding those polyfills explicitly.
- **`source/provider.js`**: REST client for the wallet backend `https://bewp0.dingocoin.io`, with `/utxos/:addr`, `/mempool/:addr`, and `/sendrawtransaction/`. Requests time out after 5s. The manifest's `host_permissions` must cover any backend host.
- **`source/Popup/Popup.tsx`**: the main wallet UI in a single large component. It covers creating, importing, exporting, and deleting accounts, switching the active account, showing the balance, and sending.

### Storage model (`browser.storage.sync`)
- `accounts`: an array of `{salt, iv, ciphertext, label, address}`, where `ciphertext` is the encrypted 32-byte private key.
- `activeAccount`: a copy of one entry from `accounts`.
- The code never stores a password hash. To check a password, it decrypts the key and compares the address derived from it with the stored `address`.

### Amounts and fees
- Amounts are satoshis stored as `BigInt` (1 DINGO = 1e8 sat).
- `toSatoshi` and `fromSatoshi` convert through web3-utils gwei with a ÷10 or ×10 adjustment.
- The fee is `FEE_RATE` (1 DINGO) per started kB of the signed tx size plus a 100-byte margin. The estimate comes from a loop that signs a trial tx with a throwaway key and raises the fee until it covers the size.
- The fee loop and `satoshiToLocaleString` are duplicated in `Popup.tsx` and `SignTransaction.tsx`, so a change to either must be made in both files.
- Outputs below `DUST_THRESHOLD` (1000 sat) are rejected.

### TypeScript settings
`strictNullChecks` is off and `allowJs` is on. The code uses `any` heavily and imports the JS modules without types. `source/index.d.ts` only declares `*.png` modules.
