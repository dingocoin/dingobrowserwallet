# Notes to Reviewers (addons.mozilla.org)

Paste the text below into the **Notes to Reviewers** field when uploading a
version, and attach `dingocoin-wallet-<version>-source.zip` in the **source
code** field. Both files are on the matching GitHub release.

Mozilla requires the sources because the add-on ships bundled and minified
code. See <https://extensionworkshop.com/documentation/publish/source-code-submission/>.

Keep this text in step with `README.md`, under "Building from source (for
Mozilla Add-ons reviewers)", which is what a reviewer actually follows.

---

The source archive is attached.

BUILD

    npm ci
    npm run build:firefox

The uploaded file is `extension/firefox.xpi`. Node.js 24 and the bundled npm
are the only requirements, which matches your default reviewer image, so no
extra setup is needed. Full instructions, including the toolchain and why each
tool is used, are in `README.md` under "Building from source (for Mozilla
Add-ons reviewers)". `BUILD-INFO.txt` names the exact commit the archive was
made from.

REPRODUCIBILITY

The build is byte-for-byte reproducible. Building from this archive in a clean
container, with an empty npm cache, produces an `extension/firefox/` tree
identical to the uploaded one: all five JavaScript bundles, all four
stylesheets, the four generated HTML files and `manifest.json`.

Please compare the contents rather than the xpi's own checksum. The zip
container records timestamps, so the packaged file differs between builds even
when every file inside it is identical.

DEPENDENCIES

`npm ci` fetches everything from the npm registry with one exception:

    bitcoinjs-lib -> git+https://github.com/rkbling/bitcoinjs-lib.git
                     #001c194c4ab8373aa893e04bba7091f2bc471ca4

That is a public fork pinned to an immutable commit, cloned by npm over HTTPS
during the install, so no credentials are needed. It differs from upstream
6.0.1 in two files, `src/bufferutils.js` and `src/types.js`, which widen
64-bit satoshi amounts to `BigInt`. Upstream caps amounts at Bitcoin's 21
million coins and at `2^53 - 1`, neither of which can represent Dingocoin's
supply. No cryptographic code is changed; you can confirm with `diff -r`
against `bitcoinjs-lib@6.0.1` from the registry.

NO OBFUSCATION

Minification is Terser and cssnano at their webpack defaults, configured in
`webpack.config.js`. Nothing is obfuscated and no logic is transformed to
hinder reading.

Happy to supply anything else that would help the review.
