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

// Plans a sweep: one transaction that sends the largest coins to the
// destination as a single output, with no change.
//
// utxos: [{ txid, vout, amount: BigInt, ... }], typically from several
// addresses. Other fields (such as the key that spends a coin) are kept on the
// returned inputs. Coins worth no more than the fee their input adds are
// skipped. At most MAX_CONSOLIDATION_INPUTS coins fit in one transaction, the
// same one-output shape as a consolidation; sweeping again moves the rest.
// Returns { inputs, fee, amount, total, eligible, tooSmall }, where amount is
// what the destination receives, total is the value of every eligible coin,
// eligible is how many coins could be swept in total and tooSmall is how many
// were skipped as worth no more than their fee.
// Throws CoinSelectionError("nothing") when there is nothing worth sweeping.
const selectSweep = ({ utxos }) => {
  const inputFee = (BigInt(P2PKH_INPUT_BYTES) * FEE_RATE + 999n) / 1000n;
  const outpoint = (x) => `${x.txid}:${x.vout}`;
  const eligible = utxos
    .filter((utxo) => utxo.amount > inputFee)
    .sort((a, b) =>
      a.amount === b.amount
        ? outpoint(a).localeCompare(outpoint(b))
        : a.amount > b.amount
        ? -1
        : 1
    );
  if (eligible.length === 0) {
    throw new CoinSelectionError("nothing", "There are no coins to sweep.");
  }
  const inputs = eligible.slice(0, MAX_CONSOLIDATION_INPUTS);
  const inputTotal = inputs.reduce((sum, utxo) => sum + utxo.amount, 0n);
  const fee = feeForBytes(
    TX_OVERHEAD_BYTES + inputs.length * P2PKH_INPUT_BYTES + P2PKH_OUTPUT_BYTES
  );
  if (inputTotal - fee < DUST_THRESHOLD) {
    throw new CoinSelectionError(
      "nothing",
      "These coins are worth less than the fee to sweep them."
    );
  }
  return {
    inputs,
    fee,
    amount: inputTotal - fee,
    total: eligible.reduce((sum, utxo) => sum + utxo.amount, 0n),
    eligible: eligible.length,
    tooSmall: utxos.length - eligible.length,
  };
};

// Output script paying a P2PKH or P2SH address.
const outputScript = (address) => {
  if (isP2pkh(address)) {
    return Buffer.from("76a914" + getHash(address) + "88ac", "hex");
  }
  if (isP2sh(address)) {
    return Buffer.from("a914" + getHash(address) + "87", "hex");
  }
  throw new Error("Unknown address type");
};

// Signs a transaction that spends coins held by different keys to one output.
// inputs: [{ txid, vout, amount: BigInt, privKey }], each a P2PKH output of
// privKey's compressed-key address. The destination receives the inputs'
// total minus fee.
const createSignedSweepTransaction = (inputs, destination, fee) => {
  if (inputs.length === 0) {
    throw new Error("Nothing to sweep");
  }
  const inputAmount = inputs.reduce((sum, input) => sum + input.amount, 0n);
  const outputAmount = inputAmount - fee;
  if (outputAmount < DUST_THRESHOLD) {
    throw new Error("Vout amount falls below dust threshold");
  }

  const tx = new bitcoin.Transaction();
  for (const input of inputs) {
    tx.addInput(Buffer.from(input.txid, "hex").reverse(), input.vout);
  }
  tx.addOutput(outputScript(destination), outputAmount);

  // Each input is signed against its own key's script; scriptSigs are only
  // filled in afterwards, since they are not part of the signed hash.
  const scriptSigs = inputs.map((input, index) => {
    const signHash = tx.hashForSignature(
      index,
      outputScript(toAddress(input.privKey)),
      bitcoin.Transaction.SIGHASH_ALL
    );
    const signatureDer = bitcoin.script.signature.encode(
      Buffer.from(sign(signHash, input.privKey)),
      bitcoin.Transaction.SIGHASH_ALL
    );
    const publicKey = Buffer.from(toPublicKey(input.privKey));
    return Buffer.concat([
      Buffer.from([signatureDer.length]),
      signatureDer,
      Buffer.from([publicKey.length]),
      publicKey,
    ]);
  });
  scriptSigs.forEach((scriptSig, index) => {
    tx.ins[index].script = scriptSig;
  });

  return { tx: tx.toHex(), inputAmount, outputAmount };
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

// Electrum's own seed format, which is not BIP39. It is used only to sweep
// coins out of an Electrum wallet; the extension never stores these seeds.
// Electrum recognizes a seed by a version prefix of its HMAC, not by a word
// list or checksum, and a standard wallet's keys are at m/0/<index>
// (receiving) and m/1/<index> (change). Reference: electrum/mnemonic.py and
// from_seed in electrum/keystore.py (github.com/spesmilo/electrum).
const ELECTRUM_RECEIVING_CHAIN = 0;
const ELECTRUM_CHANGE_CHAIN = 1;

// Ranges in which Electrum drops the spaces between characters (CJK_INTERVALS).
const ELECTRUM_CJK_RANGES = [
  [0x4e00, 0x9fff], [0x3400, 0x4dbf], [0x20000, 0x2a6df], [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f], [0xf900, 0xfaff], [0x2f800, 0x2fa1d], [0x3190, 0x319f],
  [0x2e80, 0x2eff], [0x2f00, 0x2fdf], [0x31c0, 0x31ef], [0x2ff0, 0x2fff],
  [0xe0100, 0xe01ef], [0x3100, 0x312f], [0x31a0, 0x31bf], [0xff00, 0xffef],
  [0x3040, 0x309f], [0x30a0, 0x30ff], [0x31f0, 0x31ff], [0x1b000, 0x1b0ff],
  [0xac00, 0xd7af], [0x1100, 0x11ff], [0xa960, 0xa97f], [0xd7b0, 0xd7ff],
  [0x3130, 0x318f], [0xa4d0, 0xa4ff], [0x16f00, 0x16f9f], [0xa000, 0xa48f],
  [0xa490, 0xa4cf],
];

const isCjk = (char) => {
  if (char === undefined) {
    return false;
  }
  const codePoint = char.codePointAt(0);
  return ELECTRUM_CJK_RANGES.some(([low, high]) => low <= codePoint && codePoint <= high);
};

// Whether a mark has a nonzero canonical combining class, which is what
// Python's unicodedata.combining reports and JavaScript has no API for.
// Unicode normalization reorders adjacent marks by class unless one has class
// 0, so a mark with class above 1 moves behind U+0334 (class 1) and a mark
// with class below 232 moves before U+0315 (class 232). Class-0 marks such as
// U+034F never move. The mark must already be decomposed (as everything is
// after NFKD); a precomposed mark would be decomposed by the test itself.
// Checked against Python 3's unicodedata for every code point both know.
const hasCombiningClass = (mark) => {
  const afterLow = mark + "\u0334";
  const beforeHigh = "\u0315" + mark;
  return (
    afterLow.normalize("NFD") !== afterLow ||
    beforeHigh.normalize("NFD") !== beforeHigh
  );
};

// Python's str.split() whitespace, which differs from JavaScript's \s (no
// U+FEFF; adds U+001C-U+001F and U+0085).
const PYTHON_WHITESPACE =
  // eslint-disable-next-line no-control-regex -- U+001C-U+001F are Python whitespace
  /[\t\n\v\f\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

// Electrum's normalize_text: NFKD, lowercase, accents (combining characters)
// removed, whitespace collapsed, and no spaces between CJK characters.
const normalizeElectrumText = (text) => {
  const collapsed = Array.from(text.normalize("NFKD").toLowerCase())
    .filter((char) => !(/\p{M}/u.test(char) && hasCombiningClass(char)))
    .join("")
    .split(PYTHON_WHITESPACE)
    .filter((word) => word !== "")
    .join(" ");
  const chars = Array.from(collapsed);
  return chars
    .filter(
      (char, i) => !(char === " " && isCjk(chars[i - 1]) && isCjk(chars[i + 1]))
    )
    .join("");
};

// Electrum seed type: "standard", "segwit", "2fa" or "2fa_segwit", or null if
// the phrase is not an Electrum seed (Electrum's calc_seed_type). Seeds from
// Electrum before 2.0 ("old" seeds) are not recognized.
const electrumSeedType = (phrase) => {
  const normalized = normalizeElectrumText(phrase);
  if (normalized === "") {
    return null;
  }
  const version = crypto
    .createHmac("sha512", "Seed version")
    .update(normalized, "utf8")
    .digest("hex");
  // Counted on the text as typed, as upstream does (CJK words lose their
  // spaces in normalization).
  const wordCount = phrase.split(PYTHON_WHITESPACE).filter((w) => w !== "").length;
  if (version.startsWith("01")) {
    return "standard";
  }
  if (version.startsWith("100")) {
    return "segwit";
  }
  // Two-factor seeds share their prefix with an older derivation that Electrum
  // tells apart by word count.
  if (version.startsWith("101") && (wordCount === 12 || wordCount >= 20)) {
    return "2fa";
  }
  if (version.startsWith("102")) {
    return "2fa_segwit";
  }
  return null;
};

// BIP32 root of an Electrum wallet. The passphrase is what Electrum calls the
// seed extension ("" if none was set).
const electrumRootKey = (phrase, passphrase = "") => {
  const seed = crypto.pbkdf2Sync(
    Buffer.from(normalizeElectrumText(phrase), "utf8"),
    Buffer.from("electrum" + normalizeElectrumText(passphrase), "utf8"),
    2048,
    64,
    "sha512"
  );
  return HDKey.fromMasterSeed(seed);
};

// Private key of a standard Electrum wallet's address <index> on <chain>
// (ELECTRUM_RECEIVING_CHAIN or ELECTRUM_CHANGE_CHAIN).
const electrumPrivateKey = (rootKey, chain, index) => {
  if (chain !== ELECTRUM_RECEIVING_CHAIN && chain !== ELECTRUM_CHANGE_CHAIN) {
    throw new Error("Invalid Electrum chain");
  }
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error("Invalid address index");
  }
  return Buffer.from(rootKey.deriveChild(chain).deriveChild(index).privateKey);
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
  selectSweep,
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
  createSignedSweepTransaction,
  HD_PATH,
  normalizeMnemonic,
  generateMnemonic,
  mnemonicError,
  mnemonicToEntropy,
  entropyToMnemonic,
  hdPrivateKey,
  ELECTRUM_RECEIVING_CHAIN,
  ELECTRUM_CHANGE_CHAIN,
  normalizeElectrumText,
  electrumSeedType,
  electrumRootKey,
  electrumPrivateKey,
  encryptVault,
  decryptVault,
};
