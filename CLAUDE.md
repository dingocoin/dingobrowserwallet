# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Dingocoin wallet browser extension (Manifest V3) built with React 17 + TypeScript. It began as the `abhijithvijayan/web-extension-starter` template.

## Commands

Requires Node 24 LTS (`.nvmrc`) and npm. Yarn is no longer used.

```bash
npm ci
npm run dev:chrome        # webpack --watch → extension/chrome/
npm run dev:firefox       # webpack --watch → extension/firefox/
npm run build:chrome      # production build → extension/chrome/ + extension/chrome.zip
npm run build:firefox     # production build → extension/firefox/ + extension/firefox.xpi
npm run build             # both
npm run lint              # ESLint 10 flat config (eslint.config.mjs)
npm run typecheck         # tsc --noEmit
npm test                  # node:test, test/**/*.test.js
node --test --test-name-pattern="signs a transaction" test/dingocoin.test.js   # a single test
```

- The target browser is passed as `--env browser=<chrome|firefox>`. The config copies it into `TARGET_BROWSER`, because `wext-manifest-loader` reads that environment variable.
- Babel only transpiles. Type errors come from `npm run typecheck` or from `fork-ts-checker-webpack-plugin` during a webpack build.
- CI is `.github/workflows/ci.yml`. It runs lint, typecheck, tests, and the build.
- Lint has 0 errors but many warnings from existing code, such as `set-state-in-effect` and `no-create-ref`. `eslint.config.mjs` downgrades a few rules to warnings for now.
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
  - Keys and ECDSA: secp256k1 through `@noble/curves`. `sign`/`verify` take 32-byte digests only (`prehash: false`), use RFC 6979 nonces, and produce/require low-S 64-byte `r||s` signatures.
  - Transactions are built with a forked `bitcoinjs-lib`, with scriptSigs assembled by hand.
  - Encryption: AES-256-CBC with padding off (it relies on the 32-byte private key), keyed by PBKDF2-SHA512 with 20000 iterations.
  - It uses Node's `crypto` and `Buffer`. Webpack 5 doesn't polyfill these. `webpack.config.js` points `crypto` at `polyfills/crypto.js`, which exports only `randomBytes`, `createHash`, `pbkdf2Sync`, and `createCipheriv`/`createDecipheriv` from the browserify packages. `crypto-browserify` itself is not used, so that `elliptic` stays out of the bundle. If `dingocoin.js` needs another `crypto` function, add it to that file.
  - `test/dingocoin.test.js` holds known-answer vectors, generated by the original webpack 4 build, for addresses, WIF, decrypting a stored account, signatures, and full signed transaction hex. Any change to crypto dependencies or polyfills must keep these tests passing. The tests run in Node, not in the bundle.
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
`strictNullChecks` is off and `allowJs` is on. The code uses `any` heavily and imports the JS modules without types. `source/index.d.ts` declares `*.png` and `*.scss` modules. TypeScript is pinned to 6.0 because typescript-eslint doesn't support TypeScript 7 yet.
