# Dingocoin Wallet

A Dingocoin wallet browser extension (Manifest V3) for Chrome and Firefox, built with React and TypeScript.

Web pages can call the wallet through `window.dingo`:

- `getActiveAccountAddress()`
- `requestSign(hexContent)`
- `requestSignTransaction(vins, vouts)`

The user approves every signing request in a popup window.

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

## Production build

```sh
npm run build       # extension/chrome.zip and extension/firefox.xpi
```

The version in `source/manifest.json` is replaced at build time with the `version` from `package.json`. To release, bump the version in `package.json` and rebuild.

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
