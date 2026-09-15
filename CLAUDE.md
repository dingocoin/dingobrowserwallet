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
npm run build:chrome:test # Chrome test build → extension/chrome-test/ + extension/chrome-test.zip
npm run package:release   # after build:chrome: checks it's a release build of package.json's version → extension/release/
npm run lint              # ESLint 10 flat config (eslint.config.mjs)
npm run typecheck         # tsc --noEmit
npm test                  # node:test, test/**/*.test.js
node --test --test-name-pattern="signs a transaction" test/dingocoin.test.js   # a single test
```

- The target browser is passed as `--env browser=<chrome|firefox>`. The config copies it into `TARGET_BROWSER`, because `wext-manifest-loader` reads that environment variable.
- Babel only transpiles. Type errors come from `npm run typecheck` or from `fork-ts-checker-webpack-plugin` during a webpack build.
- CI is `.github/workflows/ci.yml`. It runs lint, typecheck, tests, and both builds. It then uploads the Chrome test zip, the Chrome release zip, and the Firefox xpi as single-file artifacts (`archive: false`), so each downloads as the file itself. On PRs from this repo it keeps one `<!-- test-build -->` comment updated with the links.
- Releases come from `.github/workflows/release.yml`, which runs manually on `master` (`workflow_dispatch`). It refuses a version that is already tagged or has a release or draft. It runs lint, typecheck and tests, builds Chrome, runs `scripts/package-release.mjs`, and creates a **draft** GitHub Release `v<version>` with the zip and `SHA256SUMS`; publishing the draft creates the tag.
  - **Before releasing:** keep `version` in `package.json` and `source/manifest.json` in sync. The script checks this.
  - **Firefox:** not released. It needs AMO signing for permanent installs, and Mozilla's `data_collection_permissions` declaration still has to be decided before any AMO submission.
- A test build (`--env testBuild`, Chrome only) runs `TestBuildManifestPlugin` in `webpack.config.js`. The plugin adds a fixed public `key`, which gives the stable ID `lkfemlihploppkbhippkdnindnbfkedn`. It also appends "(test build)" to the name and sets `version_name` to `<version> test <commit>` (from `BUILD_SHA` or `git rev-parse`). Chrome gives each unpacked directory a new ID, and a dropped zip is unpacked into a new directory, so without the key every test zip would install separately with empty storage. Release builds must not contain the key.
- Lint has 0 errors but many warnings from existing code, such as `set-state-in-effect` and `no-create-ref`. `eslint.config.mjs` downgrades a few rules to warnings for now.
- The release version comes from `package.json`. `wext-manifest-loader` overwrites the `version` in `source/manifest.json` with it. Manifest keys with a vendor prefix, such as `__firefox__browser_specific_settings` or `__chrome|opera__...`, only go into that browser's build.
- Firefox needs different manifest keys, which are vendor-prefixed:
  - **Background:** Chrome gets `background.service_worker`. Firefox gets `background.scripts`, because it rejects `service_worker` with "background.service_worker is currently disabled".
  - **Add-on ID:** Firefox's ID lives in `browser_specific_settings.gecko`. The MV2 `applications` key is invalid in MV3, and without the ID `storage.sync` fails for temporary add-ons.
  - **Checking it:** `npm run lint:firefox` (addons-linter, which also runs in CI) must report 0 errors. Its `DANGEROUS_EVAL` and `UNSAFE_VAR_ASSIGNMENT` warnings come from bundled libraries.

## Architecture

### Build entry points (`webpack.config.js`)
- `background`: `source/Background/index.ts`, the MV3 service worker.
- `popup`, `signData`, `signTransaction`, `setup`: one React page each, in `source/<Name>/index.tsx`. Each has an HTML template in `views/<name>.html` that HtmlWebpackPlugin fills in.
- `setup` is the recovery phrase flow (create with a 3-word backup check, or restore). The popup opens it in a full tab with `browser.tabs.create("setup.html?mode=create|restore")`, because the toolbar popup closes when it loses focus. Nothing is saved until the flow completes, and it never overwrites an existing `wallet`.
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

Every request gets exactly one response, `{result}` or `{error}`. Pages must send failures as `onEnd(errorMessage, null)`, never as a `result`: the NFT platform treats any `result` as success. If the user closes the request window without answering, `promptUser` in `Background/index.ts` resolves `{error: "User closed the request window"}` after a 1s grace period. The grace period lets an Approve or Reject posted just before the window closes win.

When you add a new dApp-facing API method, all four files must change together.

The Dingocoin NFT platform (`dingocoin/dingonft-frontend` and `dingonft-provider`, live at nft.dingocoin.com) is the main consumer of this API:
- It calls `requestSign(sha256Hex)` and verifies the signature by recovering the public key from the 64-byte r||s signature.
- It calls `requestSignTransaction` for list, buy, and reprice. Buy and reprice pass the asset's UTXO as a required vin, which its backend signs afterwards.
- Its backend requires all inputs after `vins[0]` to come from one address, and every output to be ≥ 1 DINGO.

`SignTransaction` treats the vins supplied by the dApp as contributing 0 to the fee or balance. It pulls every UTXO of the active account from the provider and adds them as extra inputs. Change goes back to the active account.

### Key modules
- **`source/dingocoin.js`**: all chain and crypto logic, in CommonJS.
  - Recovery phrases: 12-word BIP39 (English) via `@scure/bip39`. Accounts derive at `HD_PATH/<index>` = `m/44'/3'/0'/0/<index>` via `@scure/bip32`, with no BIP39 passphrase. Coin type 3 matches Dingocoin's BIP39 tool (github.com/dingocoin/bip39). **Never change `HD_PATH`**: existing phrases would restore to different addresses.
  - `encryptVault`/`decryptVault`: the format for secrets stored from recovery phrases onwards. It uses WebCrypto PBKDF2-SHA512 (600,000 iterations, stored in the record) and AES-256-GCM, and returns `null` for a wrong password. These functions are async and use `globalThis.crypto.subtle`, not the `crypto` polyfill.
  - `encrypt`/`decrypt` (below) are only for legacy accounts created before recovery phrases.
  - Address version bytes: P2PKH `0x1e`, P2SH `0x16`. WIF prefix: `0x9e`.
  - Keys and ECDSA: secp256k1 through `@noble/curves`. `sign`/`verify` take 32-byte digests only (`prehash: false`), use RFC 6979 nonces, and produce/require low-S 64-byte `r||s` signatures.
  - Transactions are built with a forked `bitcoinjs-lib`, with scriptSigs assembled by hand.
  - Encryption: AES-256-CBC with padding off (it relies on the 32-byte private key), keyed by PBKDF2-SHA512 with 20000 iterations.
  - It uses Node's `crypto` and `Buffer`. Webpack 5 doesn't polyfill these. `webpack.config.js` points `crypto` at `polyfills/crypto.js`, which exports only `randomBytes`, `createHash`, `pbkdf2Sync`, and `createCipheriv`/`createDecipheriv` from the browserify packages. `crypto-browserify` itself is not used, so that `elliptic` stays out of the bundle. If `dingocoin.js` needs another `crypto` function, add it to that file.
  - `test/dingocoin.test.js` holds known-answer vectors, generated by the original webpack 4 build, for addresses, WIF, decrypting a stored account, signatures, and full signed transaction hex. Any change to crypto dependencies or polyfills must keep these tests passing. The tests run in Node, not in the bundle.
- **`source/accounts.js`**: the stored record types, and `unlockAccount(account, password, wallet)`, which returns the private key or `null`. Every place that needs a key must go through `unlockAccount`: popup Send and Export, SignData, and SignTransaction. It is also where recovery-phrase accounts are created (`createHdAccount` picks the lowest unused index) and imported keys are encrypted (`createKeyAccount`).
- **`source/electrum.js`**: a minimal Electrum protocol client over WebSocket.
  - Servers: `SERVERS` lists the Dingocoin ElectrumX servers from https://1209k.com/bitcoin-eye/ele.php?chain=dingo. It uses their `wss` port (3341), because extensions can't open raw TCP/TLS sockets.
  - Connection: it starts at a random server and fails over to the others. It refuses servers whose `server.features` genesis hash isn't Dingocoin's. One connection is shared per page, and it reconnects to the next server if the connection drops.
  - Parsing: responses go through `parseJson`, which keeps integers above 2^53 exact as strings, because Electrum sends satoshi amounts as JSON numbers. Never `JSON.parse` Electrum responses directly.
- **`source/provider.js`**: the wallet's network API, built on Electrum. Addresses are queried by `dingocoin.electrumScriptHash`.
  - `getUtxos` wraps `blockchain.scripthash.listunspent`. It returns confirmed and unconfirmed outputs, minus outputs already spent in the mempool.
  - `getSpendableUtxos` is `getUtxos` without immature coinbase outputs. It checks only outputs from the last `COINBASE_MATURITY` blocks: an output is a coinbase if its txid equals `blockchain.transaction.id_from_pos(height, 0)`. Send and SignTransaction must use this, not `getUtxos`.
  - `getBalance` wraps `get_balance` and returns `{confirmed, unconfirmed}`. The popup shows these as Balance and Pending; don't sum `getUtxos` for display, since that would count pending amounts twice.
  - `sendRawTransaction` returns `{txid}`, or `{code, message}` if the network rejects the transaction. It rejects only if no server is reachable.
  - All amounts are satoshi strings. `createProvider(getClient)` exists for tests.
- **Block explorer**: https://explorer.dingocoin.com, with `/address/<address>` and `/tx/<txid>`.
- **`source/Popup/Popup.tsx`**: the main wallet UI in a single large component. It covers creating, importing, exporting, and deleting accounts, switching the active account, showing the balance, and sending. The same page also runs in a tab as `popup.html?view=full` (the navbar's "Open in a tab" button; `FULL_PAGE` / `.full-page` styles). In that mode, setup navigates the tab instead of opening a new one.

### Storage model (`browser.storage.sync`)
- `accounts`: an array of three record types. The type is decided by `accountType()` in `source/accounts.js`.
  - **Legacy private key** (no `type`): `{salt, iv, ciphertext, label, address}`, AES-256-CBC with PBKDF2 at 20,000 iterations. Accounts created by older versions use this format. **It must keep loading unchanged.**
  - **Imported private key**: `{type: "key", label, address, vault}`. It has its own password.
  - **Recovery-phrase account**: `{type: "hd", index, label, address}`. It holds no secret; its key is derived from `wallet` with the wallet password.
- `wallet`: `{vault}`, which is the BIP39 entropy encrypted with the wallet password. It is absent until the user creates or restores a phrase.
- `activeAccount`: a copy of one entry from `accounts`. The signing pages read it together with `wallet`.
- The code never stores a password hash. Vault records fail to decrypt with a wrong password. For legacy records, `unlockAccount` compares the address derived from the decrypted key with the stored `address`.
- `test/accounts.test.js` checks derivation against vectors taken from the dingocoin/bip39 tool.

### Amounts and fees
- Amounts are satoshis stored as `BigInt` (1 DINGO = 1e8 sat).
- `toSatoshi` and `fromSatoshi` convert amount strings with plain BigInt math. `toSatoshi` rejects more than 8 decimal places instead of rounding.
- Network rules, confirmed against Dingocoin's source and the live network, and encoded as constants in `dingocoin.js`:
  - **`DUST_THRESHOLD` = 1 DINGO.** Dingocoin's `GetDustThreshold` returns `COIN`, and the network rejects any spendable output below it with "64: dust".
  - **Size limit.** A standard transaction must be under 100,000 bytes ("64: tx-size"); the wallet caps selection at `MAX_TX_BYTES` = 99,000.
  - **Coinbase maturity.** Coinbase outputs need `COINBASE_MATURITY` = 240 blocks.
- **Fee.** `feeForBytes(bytes)` = `FEE_RATE` (1 DINGO) per started kB, plus a 100-byte margin. That is at least the node's minimum relay fee.
- **Coin selection (`dingocoin.selectCoins({utxos, outputs, data, required})`)** picks the largest coins first and estimates size from upper bounds (149 bytes per P2PKH input). It returns `{inputs, fee}` to pass to `createSignedRawTransaction`:
  - **Change.** It adds change only if the change is ≥ `DUST_THRESHOLD`; smaller leftovers go to the fee.
  - **Required inputs.** `required` inputs (from a dApp) are always spent and count as zero value.
  - **Errors.** It throws `CoinSelectionError` with a `reason` of `dust`, `insufficient`, or `too-large`. `too-large` includes `maxAmount`, the most one transaction can send.
  - **Where it's used.** Both Popup Send and SignTransaction use `selectCoins`. Never spend every UTXO: large wallets have thousands.
- **Consolidation (`dingocoin.selectConsolidation({utxos})`)** plans a send back to the owner's own address. It merges up to `MAX_CONSOLIDATION_INPUTS` (664) of the smallest confirmed coins into one output, with no change.
  - **Skipped coins.** Unconfirmed coins are skipped, as are coins worth no more than the fee their input adds.
  - **Errors.** If fewer than two coins qualify, it throws `CoinSelectionError("nothing")`.
  - **In the popup.** It is reached from the account ⋮ menu, and from the "Too many coins for one transaction" send error. Running it again immediately is safe, because ElectrumX's `listunspent` leaves out outputs already spent in the mempool.
- `satoshiToLocaleString` is duplicated in `Popup.tsx` and `SignTransaction.tsx`.

### TypeScript settings
`strictNullChecks` is off and `allowJs` is on. The code uses `any` heavily and imports the JS modules without types. `source/index.d.ts` declares `*.png` and `*.scss` modules. TypeScript is pinned to 6.0 because typescript-eslint doesn't support TypeScript 7 yet.
