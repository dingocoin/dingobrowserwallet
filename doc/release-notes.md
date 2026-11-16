# Release notes for the next version

Add a note here in the same pull request as any change a user would notice, so
nothing has to be reconstructed from the log on release day. Leave out changes
only a contributor sees, such as build plumbing, CI and refactors.

Write for someone using the wallet: what changed, and why it matters to them.
Past releases are in `doc/release-notes/` and are worth skimming for tone.

On release, this file becomes `doc/release-notes/release-notes-<version>.md`,
and this template takes its place. The Release workflow refuses to run if the
notes for the version being released are missing, so it cannot ship without
them. See the "Releasing" section of `README.md`.

Delete any heading that has nothing under it.

## New

- **Sweep an Electrum wallet.** Electrum's seeds aren't BIP39 seed phrases,
  so restoring one here found no coins. The account menu (⋮) now has
  *Sweep Electrum wallet*: enter the Electrum seed, and the wallet finds the
  coins on all of its receiving and change addresses and sends them to the
  current account in one transaction, after showing the amount and fee. The
  seed is never saved. Standard Electrum seeds are supported, with or
  without a seed extension; SegWit and two-factor seeds are not.

## Improved

- The extension is a much smaller download: about 1.2 MB instead of 5.7 MB,
  and 3.5 MB installed instead of 18.6 MB. Builds no longer include debugging
  data that only developers use.

## Fixed
