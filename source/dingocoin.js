const crypto = require("crypto");
const { secp256k1 } = require("@noble/curves/secp256k1.js");
const bip39 = require("@scure/bip39");
const { wordlist } = require("@scure/bip39/wordlists/english.js");
const { HDKey } = require("@scure/bip32");
const bs58 = require("bs58");
const bitcoin = require("bitcoinjs-lib");

// Dingocoin treats every spendable output below 1 DINGO as dust and refuses to
// relay transactions that create one (GetDustThreshold in dingocoin's
// primitives/transaction.h; the network answers "64: dust").
const DUST_THRESHOLD = 100000000n;
const FEE_RATE = 100000000n; // per started kB, plus a 100-byte margin
const UTXO_MAX_AMOUNT = 10000000000n * 100000000n - 1n; // 10 billion minus 1.
// Standard transactions must be smaller than 100,000 bytes ("64: tx-size").
// Leave room for the difference between estimated and actual sizes.
const MAX_TX_BYTES = 99000;
// Coinbase outputs can be spent once the spending block is 240 blocks deeper.
const COINBASE_MATURITY = 240;

const isBs58 = (x) => {
  return x.match(/^[1-9A-HJ-NP-Za-km-z]+$/);
};

const SATOSHI_PER_DINGO = 100000000n;

// DINGO amount string ("1", "1.", ".5", "-2.00000001") to satoshis, as a string.
// Dingocoin has 8 decimal places; more precision is an error, not rounded away.
const toSatoshi = (x) => {
  if (x === null || x === undefined || typeof x !== "string" || x === "") {
    throw new Error("Expected string input");
  }
  const match = x.match(/^(-?)([0-9]*)(?:\.([0-9]*))?$/);
  if (match === null || (match[2] === "" && !match[3])) {
    throw new Error(`Invalid amount: ${x}`);
  }
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > 8) {
    throw new Error(`Too many decimal places: ${x}`);
  }
  const satoshi =
    BigInt(whole || "0") * SATOSHI_PER_DINGO + BigInt(fraction.padEnd(8, "0"));
  return (sign === "-" ? -satoshi : satoshi).toString();
};

// Satoshi amount string to a DINGO string without trailing zeros ("1.5", "0").
const fromSatoshi = (x) => {
  if (x === null || x === undefined || typeof x !== "string" || x === "") {
    throw new Error("Expected string input");
  }
  const satoshi = BigInt(x);
  const abs = satoshi < 0n ? -satoshi : satoshi;
  const fraction = (abs % SATOSHI_PER_DINGO)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  return (
    (satoshi < 0n ? "-" : "") +
    (abs / SATOSHI_PER_DINGO).toString() +
    (fraction === "" ? "" : `.${fraction}`)
  );
};

// Helper SHA256.
const sha256 = (x) => {
  return crypto.createHash("sha256").update(x).digest();
};

// Helper RIPEMD160.
const ripemd160 = (x) => {
  return crypto.createHash("ripemd160").update(x).digest();
};

// Creates a random Dingocoin private key.
const randomPrivateKey = () => {
  return crypto.randomBytes(32);
};

// Get compressed SECP256k1 public key of private key.
const toPublicKey = (privKey) => {
  return secp256k1.getPublicKey(privKey, true);
};

// Validate WIF.
const isWif = (wif) => {
  if (!isBs58(wif)) {
    return false;
  }
  const raw = bs58.decode(wif);
  if (raw.length !== 37 && raw.length !== 38) {
    return false;
  }
  if (raw[0] !== 0x9e) {
    return false;
  }
  const checksum = sha256(sha256(raw.slice(0, raw.length - 4)));
  return raw.slice(raw.length - 4, raw.length).equals(checksum.slice(0, 4));
};

// Export private key to WIF.
const toWif = (privKey) => {
  const header = Buffer.from([0x9e]);
  const data = privKey;
  const extra = Buffer.from([0x01]);
  const checksum = sha256(sha256(Buffer.concat([header, data, extra])));
  return bs58.encode(
    Buffer.concat([header, data, extra, checksum.slice(0, 4)])
  );
};

// Import private key from WIF.
const fromWif = (wif) => {
  if (!isWif(wif)) {
    throw new Error("Incorrect or unsupported format");
  }
  return bs58.decode(wif).slice(1, 1 + 32);
};

// Validate Dingocoin address.
const isAddress = (address) => {
  if (!isBs58(address)) {
    return false;
  }
  const raw = bs58.decode(address);

  if (raw.length !== 25) {
    return false;
  }
  if (raw[0] !== 0x16 && raw[0] !== 0x1e) {
    return false;
  }
  const checksum = sha256(sha256(raw.slice(0, 21)));
  return raw.slice(21, 25).equals(checksum.slice(0, 4));
};

const getHash = (address) => {
  if (!isAddress(address)) {
    throw new Error("Invalid address");
  }
  return bs58.decode(address).slice(1, 21).toString("hex");
};

const isP2pkh = (address) => {
  if (!isAddress(address)) {
    return false;
  }
  return bs58.decode(address)[0] === 0x1e;
};

const isP2sh = (address) => {
  if (!isAddress(address)) {
    return false;
  }
  return bs58.decode(address)[0] === 0x16;
};

// Electrum identifies an address by the reversed SHA-256 of its output script.
const electrumScriptHash = (address) => {
  let script;
  if (isP2pkh(address)) {
    script = "76a914" + getHash(address) + "88ac";
  } else if (isP2sh(address)) {
    script = "a914" + getHash(address) + "87";
  } else {
    throw new Error("Invalid address");
  }
  return Buffer.from(sha256(Buffer.from(script, "hex")))
    .reverse()
    .toString("hex");
};

// Create Dingocoin address from secp256k1 priv key.
const toAddress = (privKey) => {
  const pubKey = toPublicKey(privKey);
  const data = ripemd160(sha256(pubKey));
  const header = Buffer.from([0x1e]);
  const checksum = sha256(sha256(Buffer.concat([header, data]))).slice(0, 4);
  return bs58.encode(Buffer.concat([header, data, checksum]));
};

// Helper PBKDF2.
const pbkdf2 = (password, salt) => {
  return crypto.pbkdf2Sync(
    Buffer.from(password, "utf8"),
    salt,
    20000,
    32,
    "sha512"
  );
};

// Encrypts data with random PBKDF2 salt and AES-256-CBC IV parameters.
var encrypt = (data, passphrase) => {
  // PBKDF2 expansion.
  const salt = crypto.randomBytes(32);
  const key = pbkdf2(passphrase, salt);

  // Cipher.
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);

  return {
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
};

// Decrypts data with given parameters.
var decrypt = (encrypted, passphrase) => {
  // PBKDF2 expansion.
  const key = pbkdf2(passphrase, Buffer.from(encrypted.salt, "hex"));

  // Cipher.
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    key,
    Buffer.from(encrypted.iv, "hex")
  );
  decipher.setAutoPadding(false);
  const data = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "hex")),
    decipher.final(),
  ]);

  return data;
};

// ECDSA works on 32-byte digests; callers hash first. Never sign raw data.
const assertDigest = (data) => {
  if (!(data instanceof Uint8Array) || data.length !== 32) {
    throw new Error("Expected a 32-byte digest");
  }
};

// Deterministic (RFC 6979) low-S ECDSA signature, as 64 bytes r || s.
const sign = (data, privateKey) => {
  assertDigest(data);
  return secp256k1.sign(data, privateKey, { prehash: false });
};

// Verifies a 64-byte r || s signature. High-S signatures are rejected.
const verify = (data, signature, publicKey) => {
  assertDigest(data);
  return secp256k1.verify(signature, data, publicKey, { prehash: false });
};

// Fee for a transaction of the given size, as the send flows have always charged.
const feeForBytes = (bytes) => {
  return BigInt(Math.ceil((bytes + 100) / 1000)) * FEE_RATE;
};

// Upper bounds for serialized sizes, so estimated fees are never too low.
const TX_OVERHEAD_BYTES = 4 + 3 + 3 + 4; // version, input and output counts, locktime
// Outpoint 36, script length 1, scriptSig (DER signature + sighash ≤ 73 bytes,
// compressed public key 33, two push opcodes) ≤ 108, sequence 4.
const P2PKH_INPUT_BYTES = 149;
const P2PKH_OUTPUT_BYTES = 34;
const outputBytes = (address) => (isP2sh(address) ? 32 : P2PKH_OUTPUT_BYTES);
const dataOutputBytes = (data) => 8 + 1 + 1 + (data.length > 75 ? 2 : 1) + data.length;

class CoinSelectionError extends Error {
  constructor(reason, message, maxAmount) {
    super(message);
    this.name = "CoinSelectionError";
    this.reason = reason; // "dust" | "insufficient" | "too-large" | "nothing"
    this.maxAmount = maxAmount; // for "too-large": the most one transaction can send
  }
}

// Chooses inputs for createSignedRawTransaction and the fee to pass it.
//
// utxos: [{ txid, vout, amount: BigInt }] the wallet may spend, largest first.
// required: inputs that must be spent (e.g. named by a dApp); they count as
//   zero value, like createSignedRawTransaction treats them.
// Returns { inputs, fee }. Change of at least DUST_THRESHOLD comes back to the
// owner; smaller change is left to the miners instead of creating dust.
// Throws CoinSelectionError when the outputs can't be paid.
const selectCoins = ({ utxos, outputs, data = null, required = [] }) => {
  for (const output of outputs) {
    if (output.amount < DUST_THRESHOLD) {
      throw new CoinSelectionError("dust", "Each output must be at least 1 DINGO.");
    }
  }
  const target = outputs.reduce((sum, output) => sum + output.amount, 0n);
  const fixedBytes =
    TX_OVERHEAD_BYTES +
    outputs.reduce((sum, output) => sum + outputBytes(output.address), 0) +
    (data === null ? 0 : dataOutputBytes(data));
  const bytesFor = (inputCount, withChange) =>
    fixedBytes +
    inputCount * P2PKH_INPUT_BYTES +
    (withChange ? P2PKH_OUTPUT_BYTES : 0);

  const outpoint = (x) => `${x.txid}:${x.vout}`;
  const requiredOutpoints = new Set(required.map(outpoint));
  const candidates = utxos
    .filter((utxo) => !requiredOutpoints.has(outpoint(utxo)))
    .sort((a, b) =>
      a.amount === b.amount
        ? outpoint(a).localeCompare(outpoint(b))
        : a.amount > b.amount
        ? -1
        : 1
    );

  const inputs = [...required];
  let total = 0n;
  const maxInputs = Math.floor((MAX_TX_BYTES - fixedBytes) / P2PKH_INPUT_BYTES);
  for (let next = 0; ; next++) {
    if (inputs.length > 0) {
      const changeFee = feeForBytes(bytesFor(inputs.length, true));
      if (total - target - changeFee >= DUST_THRESHOLD) {
        return { inputs, fee: changeFee };
      }
      if (total - target >= feeForBytes(bytesFor(inputs.length, false))) {
        // No change output: whatever is left over (less than the dust threshold
        // plus one fee step) goes to the fee.
        return { inputs, fee: total - target };
      }
    }
    if (next >= candidates.length) {
      throw new CoinSelectionError("insufficient", "Insufficient balance.");
    }
    if (inputs.length + 1 > maxInputs) {
      const usable = Math.max(maxInputs - required.length, 0);
      const best = candidates
        .slice(0, usable)
        .reduce((sum, utxo) => sum + utxo.amount, 0n);
      const maxAmount = best - feeForBytes(bytesFor(required.length + usable, false));
      throw new CoinSelectionError(
        "too-large",
        "This amount needs too many coins for one transaction.",
        maxAmount > 0n ? maxAmount : 0n
      );
    }
    inputs.push(candidates[next]);
    total += candidates[next].amount;
  }
};

// Largest number of coins one consolidation transaction can merge.
const MAX_CONSOLIDATION_INPUTS = Math.floor(
  (MAX_TX_BYTES - TX_OVERHEAD_BYTES - P2PKH_OUTPUT_BYTES) / P2PKH_INPUT_BYTES
);

// Plans a transaction that merges the smallest confirmed coins into one coin
// back to the owner's address, so later sends need fewer inputs.
//
// utxos: [{ txid, vout, amount: BigInt, height }] from getSpendableUtxos.
// Unconfirmed coins are skipped (no chains on pending transactions), and so
// are coins worth no more than the fee their input adds.
// Returns { inputs, fee, amount, eligible } where amount is the new coin's
// value and eligible is how many coins could be merged in total.
// Throws CoinSelectionError("nothing") when fewer than two coins qualify.
const selectConsolidation = ({ utxos }) => {
  const inputFee = (BigInt(P2PKH_INPUT_BYTES) * FEE_RATE + 999n) / 1000n;
  const outpoint = (x) => `${x.txid}:${x.vout}`;
  const eligible = utxos
    .filter((utxo) => utxo.height > 0 && utxo.amount > inputFee)
    .sort((a, b) =>
      a.amount === b.amount
        ? outpoint(a).localeCompare(outpoint(b))
        : a.amount < b.amount
        ? -1
        : 1
    );
  if (eligible.length < 2) {
    throw new CoinSelectionError(
      "nothing",
      "There are not enough confirmed coins to consolidate."
    );
  }
  const inputs = eligible.slice(0, MAX_CONSOLIDATION_INPUTS);
  const total = inputs.reduce((sum, utxo) => sum + utxo.amount, 0n);
  const fee = feeForBytes(
    TX_OVERHEAD_BYTES + inputs.length * P2PKH_INPUT_BYTES + P2PKH_OUTPUT_BYTES
  );
  if (total - fee < DUST_THRESHOLD) {
    throw new CoinSelectionError(
      "nothing",
      "These coins are worth less than the fee to consolidate them."
    );
  }
  return { inputs, fee, amount: total - fee, eligible: eligible.length };
};

const createSignedRawTransaction = (
  vins,
  vouts,
  data,
  fee,
  ownerAddress,
  privKey
) => {
  if (!isP2pkh(ownerAddress)) {
    throw new Error("Owner address must be p2pkh");
  }

  const tx = new bitcoin.Transaction();

  // Collate and append inputs.
  let inputAmount = 0n;
  for (const vin of vins) {
    tx.addInput(Buffer.from(vin.txid, "hex").reverse(), vin.vout);
    inputAmount += vin.amount;
  }

  // Collate and append outputs.
  let outputAmount = 0n;
  for (const vout of vouts) {
    if (vout.amount < DUST_THRESHOLD) {
      throw new Error("Vout amount falls below dust threshold");
    }
    if (isP2pkh(vout.address)) {
      tx.addOutput(
        Buffer.from(
          "76" + "a9" + "14" + getHash(vout.address) + "88" + "ac",
          "hex"
        ),
        vout.amount
      );
    } else if (isP2sh(vout.address)) {
      tx.addOutput(
        Buffer.from("a9" + "14" + getHash(vout.address) + "87", "hex"),
        vout.amount
      );
    } else {
      throw new Error("Unknown vout address type");
    }
    outputAmount += vout.amount;
  }

  // Add change.
  if (inputAmount - outputAmount - fee >= DUST_THRESHOLD) {
    tx.addOutput(
      Buffer.from(
        "76" + "a9" + "14" + getHash(ownerAddress) + "88" + "ac",
        "hex"
      ),
      inputAmount - outputAmount - fee
    );
  }

  // Append data (OP_RETURN).
  if (data !== null) {
    tx.addOutput(bitcoin.payments.embed({ data: [data] }).output, 0n);
  }

  let signatures = [];

  // Sign vins.
  for (let index = 0; index < vins.length; index++) {
    // Compute has to sign.
    const prevScript = Buffer.from(
      "76a914" + getHash(ownerAddress) + "88ac",
      "hex"
    );
    const signHash = tx.hashForSignature(
      index,
      prevScript,
      bitcoin.Transaction.SIGHASH_ALL
    );

    // Sign and encode as DER.
    const signature = Buffer.from(sign(signHash, privKey));
    const signatureDer = bitcoin.script.signature.encode(
      signature,
      bitcoin.Transaction.SIGHASH_ALL
    );

    // Compute and encode public key (SEC).
    const publicKey = Buffer.from(toPublicKey(privKey));

    // Compute signature script.
    const scriptSig = Buffer.concat([
      Buffer.from([signatureDer.length]),
      signatureDer,
      Buffer.from([publicKey.length]),
      publicKey,
    ]);

    signatures.push(scriptSig);
  }

  for (let index = 0; index < vins.length; index++) {
    tx.ins[index].script = signatures[index];
  }

  return {
    tx: tx.toHex(),
    inputAmount: inputAmount,
    outputAmount: outputAmount,
    balanceAmount: inputAmount - outputAmount - fee,
  };
};

// BIP44 path for recovery-phrase accounts: m/44'/3'/0'/0/<index>. Coin type 3
// matches Dingocoin's BIP39 tool (github.com/dingocoin/bip39). Changing this
// would make existing recovery phrases restore to different addresses.
const HD_PATH = "m/44'/3'/0'/0";
const MNEMONIC_WORD_COUNTS = [12, 15, 18, 21, 24];

// Lowercases and collapses whitespace so typed or pasted phrases validate.
const normalizeMnemonic = (phrase) => {
  return phrase.trim().toLowerCase().split(/\s+/).join(" ");
};

// New 12-word (128-bit) English recovery phrase.
const generateMnemonic = () => {
  return bip39.generateMnemonic(wordlist, 128);
};

// Returns null for a valid phrase, otherwise a message describing the problem.
const mnemonicError = (phrase) => {
  const words = normalizeMnemonic(phrase).split(" ").filter((w) => w !== "");
  if (!MNEMONIC_WORD_COUNTS.includes(words.length)) {
    return `Recovery phrases have 12, 15, 18, 21 or 24 words (got ${words.length}).`;
  }
  const unknown = words.findIndex((w) => !wordlist.includes(w));
  if (unknown !== -1) {
    return `Word ${unknown + 1} ("${words[unknown]}") is not a recovery phrase word.`;
  }
  if (!bip39.validateMnemonic(words.join(" "), wordlist)) {
    return "Invalid recovery phrase. Check the spelling and order of the words.";
  }
  return null;
};

const mnemonicToEntropy = (phrase) => {
  return Buffer.from(bip39.mnemonicToEntropy(normalizeMnemonic(phrase), wordlist));
};

const entropyToMnemonic = (entropy) => {
  return bip39.entropyToMnemonic(entropy, wordlist);
};

// Private key of recovery-phrase account <index> (no BIP39 passphrase).
const hdPrivateKey = (entropy, index) => {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error("Invalid account index");
  }
  const seed = bip39.mnemonicToSeedSync(entropyToMnemonic(entropy));
  const key = HDKey.fromMasterSeed(seed).derive(`${HD_PATH}/${index}`);
  return Buffer.from(key.privateKey);
};

// Password-based encryption for secrets stored by this version onwards:
// PBKDF2-SHA512 (WebCrypto) and AES-256-GCM, so a wrong password or corrupted
// data fails to decrypt instead of returning garbage. Parameters are stored
// with the ciphertext so they can be strengthened later.
const VAULT_ITERATIONS = 600000;

const vaultKey = async (password, salt, iterations, usage) => {
  const { subtle } = globalThis.crypto;
  const material = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-512", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage]
  );
};

const encryptVault = async (plaintext, password) => {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await vaultKey(password, salt, VAULT_ITERATIONS, "encrypt");
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );
  return {
    kdf: "pbkdf2-sha512",
    iterations: VAULT_ITERATIONS,
    salt: Buffer.from(salt).toString("hex"),
    cipher: "aes-256-gcm",
    iv: Buffer.from(iv).toString("hex"),
    ciphertext: Buffer.from(ciphertext).toString("hex"),
  };
};

// Resolves to the plaintext, or null if the password is wrong.
const decryptVault = async (vault, password) => {
  if (vault.kdf !== "pbkdf2-sha512" || vault.cipher !== "aes-256-gcm") {
    throw new Error("Unsupported vault format");
  }
  const key = await vaultKey(
    password,
    Buffer.from(vault.salt, "hex"),
    vault.iterations,
    "decrypt"
  );
  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(vault.iv, "hex") },
      key,
      Buffer.from(vault.ciphertext, "hex")
    );
    return Buffer.from(plaintext);
  } catch {
    return null;
  }
};

module.exports = {
  DUST_THRESHOLD,
  FEE_RATE,
  UTXO_MAX_AMOUNT,
  MAX_TX_BYTES,
  COINBASE_MATURITY,
  feeForBytes,
  CoinSelectionError,
  selectCoins,
  MAX_CONSOLIDATION_INPUTS,
  selectConsolidation,
  sha256,
  ripemd160,
  toSatoshi,
  fromSatoshi,
  randomPrivateKey,
  toPublicKey,
  isWif,
  toWif,
  fromWif,
  isAddress,
  electrumScriptHash,
  toAddress,
  sign,
  verify,
  encrypt,
  decrypt,
  createSignedRawTransaction,
  HD_PATH,
  normalizeMnemonic,
  generateMnemonic,
  mnemonicError,
  mnemonicToEntropy,
  entropyToMnemonic,
  hdPrivateKey,
  encryptVault,
  decryptVault,
};
