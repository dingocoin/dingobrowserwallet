// Account and recovery-phrase records, as stored in browser.storage.sync.
//
// `accounts` holds three kinds of entries:
//   Legacy private key, created before recovery phrases existed. This format
//   must keep working unchanged so existing users' accounts load after updates:
//     { salt, iv, ciphertext, label, address }  (dingocoin.encrypt, AES-256-CBC)
//   Imported private key:
//     { type: "key", label, address, vault }    (dingocoin.encryptVault)
//   Recovery-phrase account, derived at dingocoin.HD_PATH/<index>:
//     { type: "hd", index, label, address }
//
// `wallet` holds the recovery phrase, encrypted with the wallet password:
//     { vault }                                  (BIP39 entropy)
const dingocoin = require("./dingocoin");

const accountType = (account) => {
  if (account.type === "hd" || account.type === "key") {
    return account.type;
  }
  return "legacy";
};

// Imported and legacy private keys are not covered by the recovery phrase.
const isRecoveryPhraseAccount = (account) => accountType(account) === "hd";

const createWallet = async (mnemonic, password) => {
  return {
    vault: await dingocoin.encryptVault(
      dingocoin.mnemonicToEntropy(mnemonic),
      password
    ),
  };
};

// Resolves to the recovery phrase, or null if the password is wrong.
const revealMnemonic = async (wallet, password) => {
  const entropy = await dingocoin.decryptVault(wallet.vault, password);
  return entropy === null ? null : dingocoin.entropyToMnemonic(entropy);
};

// Lowest index not used by a recovery-phrase account, so an account that was
// removed comes back with the same address when it is added again.
const nextHdIndex = (accounts) => {
  const used = new Set(
    accounts.filter(isRecoveryPhraseAccount).map((account) => account.index)
  );
  let index = 0;
  while (used.has(index)) {
    index++;
  }
  return index;
};

const hdAccount = (entropy, index, label) => {
  return {
    type: "hd",
    index,
    label: label || `Account ${index + 1}`,
    address: dingocoin.toAddress(dingocoin.hdPrivateKey(entropy, index)),
  };
};

// First account for a newly created or restored recovery phrase.
const firstHdAccount = (mnemonic) => {
  return hdAccount(dingocoin.mnemonicToEntropy(mnemonic), 0, "");
};

// Resolves to the next recovery-phrase account, or null if the password is wrong.
const createHdAccount = async (wallet, password, accounts, label) => {
  const entropy = await dingocoin.decryptVault(wallet.vault, password);
  if (entropy === null) {
    return null;
  }
  return hdAccount(entropy, nextHdIndex(accounts), label);
};

const createKeyAccount = async (privKey, password, label) => {
  return {
    type: "key",
    label,
    address: dingocoin.toAddress(privKey),
    vault: await dingocoin.encryptVault(privKey, password),
  };
};

// Resolves to the account's private key, or null if the password is wrong.
const unlockAccount = async (account, password, wallet) => {
  let privKey = null;
  try {
    switch (accountType(account)) {
      case "legacy":
        privKey = dingocoin.decrypt(account, password);
        break;
      case "key":
        privKey = await dingocoin.decryptVault(account.vault, password);
        break;
      case "hd": {
        if (!wallet) {
          throw new Error("Recovery phrase not found");
        }
        const entropy = await dingocoin.decryptVault(wallet.vault, password);
        privKey =
          entropy === null ? null : dingocoin.hdPrivateKey(entropy, account.index);
        break;
      }
    }
    // Legacy AES-CBC has no integrity check: a wrong password yields a random
    // key, which the address comparison catches.
    if (privKey !== null && dingocoin.toAddress(privKey) === account.address) {
      return privKey;
    }
  } catch (e) {
    if (e.message === "Recovery phrase not found") {
      throw e;
    }
  }
  return null;
};

module.exports = {
  accountType,
  isRecoveryPhraseAccount,
  createWallet,
  revealMnemonic,
  nextHdIndex,
  firstHdAccount,
  createHdAccount,
  createKeyAccount,
  unlockAccount,
};
