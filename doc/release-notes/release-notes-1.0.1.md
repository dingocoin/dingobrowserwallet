## New

**Consolidate coins.** Large wallets accumulate many small coins, and a single
transaction can only spend about 664 of them, so a send could fail with "Too
many coins for one transaction" despite plenty of balance. Consolidate coins
merges the smallest confirmed coins into one coin at the same address, so later
sends need fewer inputs and can move more at once. It is in the account **⋮**
menu, and on that send error as a button. The dialog shows how many coins are
merged, the fee and the resulting coin before asking for your password, then
links the transaction on the explorer. It is safe to run again immediately.

## Improved

**Every password field now says which password it wants.** Accounts from a seed
phrase unlock with the **wallet password**, while legacy and imported keys each
have their own **account password**. Send, Export, Consolidate and both signing
windows now name the one they need, instead of asking for "password" and leaving
you to guess.

**Accounts are grouped by kind.** The menu lists them under *Seed phrase* and
*Legacy & imported keys*, and the main view shows which kind the active account
is. "Create account" now explains that the new address comes from your existing
seed phrase and uses the wallet password; it previously read like a prompt to
invent a new one.

**The recovery phrase is called a seed phrase** throughout the interface.

## Fixed

**Web pages always get a real answer from the wallet.** Two bugs meant a site
could be told the wrong thing, or nothing at all:

- The Close buttons on the signing windows sent their reason as a *result*
  rather than an error. Since sites treat any result as success, one could
  submit the text "No active account" where a signature belonged.
- Closing a signing window with the window's own close button sent nothing, so
  the page waited forever.

Each request now settles exactly once, and failures arrive as errors.

## Firefox

This is the first release with a working Firefox build, and the wallet is now
submitted to [addons.mozilla.org](https://addons.mozilla.org). Firefox needs
different manifest keys than Chrome for the background script and the add-on ID,
and Mozilla now requires every extension to declare what data it handles.

**About the data collection notice Firefox shows at install:** the wallet has no
analytics, no telemetry and no crash reporting. The declaration covers what the
wallet must do to function — it asks Dingocoin's Electrum servers for your
addresses' balances and unspent coins, and broadcasts your signed transactions
to them. **Your seed phrase and private keys never leave your browser.** They
are encrypted with your password and, like any extension's storage, sync through
your own browser account if you have sync enabled.

## Verifying this build

The build is reproducible: from the attached source archive, `npm ci && npm run
build:firefox` reproduces every file inside the published extension byte for
byte. Compare the extracted contents rather than the package's own checksum —
zip containers record timestamps, so the packaged file differs between builds
even when the code inside is identical.
