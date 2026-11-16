// Finds the coins of an Electrum standard wallet so they can be swept into an
// extension account. Keys derived from the Electrum seed are only held in
// memory for the sweep; nothing is stored.
const dingocoin = require("./dingocoin");
const { ElectrumError } = require("./electrum");

// Electrum stops generating addresses after 20 unused receiving and 10 unused
// change addresses by default. Scanning 20 on both chains covers both.
const ELECTRUM_GAP_LIMIT = 20;
// Give up rather than scan without end if a server reports every address as used.
const MAX_ADDRESSES_PER_CHAIN = 10000;

// ElectrumX refuses to list a very long history ("history too large"), and
// only a used address can have one.
const hasHistory = async (provider, address) => {
  try {
    return (await provider.getHistory(address)).length > 0;
  } catch (err) {
    if (err instanceof ElectrumError && /history too large/i.test(err.message)) {
      return true;
    }
    throw err;
  }
};

// Used addresses on one chain, scanned in batches of gapLimit until the last
// gapLimit addresses are all unused. Every used address in a fetched batch is
// kept, even past the gap, since finding more coins than Electrum shows is
// harmless.
const scanChain = async ({ rootKey, chain, provider, gapLimit, maxAddresses }) => {
  const used = [];
  let unusedRun = 0;
  for (let start = 0; unusedRun < gapLimit; start += gapLimit) {
    if (start >= maxAddresses) {
      throw new Error("This wallet has too many addresses to scan.");
    }
    const batch = Array.from({ length: gapLimit }, (_, offset) => {
      const index = start + offset;
      const privKey = dingocoin.electrumPrivateKey(rootKey, chain, index);
      return { chain, index, privKey, address: dingocoin.toAddress(privKey) };
    });
    const usedFlags = await Promise.all(
      batch.map((entry) => hasHistory(provider, entry.address))
    );
    batch.forEach((entry, i) => {
      if (usedFlags[i]) {
        used.push(entry);
        unusedRun = 0;
      } else {
        unusedRun++;
      }
    });
  }
  return used;
};

// Resolves to { usedAddresses, coins } for the Electrum wallet at rootKey
// (from dingocoin.electrumRootKey). coins are the spendable outputs of every
// used receiving and change address, as [{ txid, vout, amount: BigInt,
// height, address, privKey }], ready for dingocoin.selectSweep.
const findElectrumCoins = async ({
  rootKey,
  provider,
  gapLimit = ELECTRUM_GAP_LIMIT,
  maxAddressesPerChain = MAX_ADDRESSES_PER_CHAIN,
}) => {
  const chains = await Promise.all(
    [dingocoin.ELECTRUM_RECEIVING_CHAIN, dingocoin.ELECTRUM_CHANGE_CHAIN].map(
      (chain) =>
        scanChain({
          rootKey,
          chain,
          provider,
          gapLimit,
          maxAddresses: maxAddressesPerChain,
        })
    )
  );
  const used = chains.flat();

  const coins = [];
  for (let start = 0; start < used.length; start += gapLimit) {
    const batch = used.slice(start, start + gapLimit);
    const utxoLists = await Promise.all(
      batch.map((entry) => provider.getSpendableUtxos(entry.address))
    );
    batch.forEach((entry, i) => {
      for (const utxo of utxoLists[i]) {
        coins.push({
          txid: utxo.txid,
          vout: utxo.vout,
          amount: BigInt(utxo.amount),
          height: utxo.height,
          address: entry.address,
          privKey: entry.privKey,
        });
      }
    });
  }
  return { usedAddresses: used.length, coins };
};

module.exports = { ELECTRUM_GAP_LIMIT, findElectrumCoins };
