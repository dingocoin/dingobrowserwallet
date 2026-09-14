const crypto = require("crypto");
const secp256k1 = require("secp256k1");
const bs58 = require("bs58");
const bitcoin = require("bitcoinjs-lib");
const Web3Utils = require("web3-utils");

const DUST_THRESHOLD = 1000n;
const FEE_RATE = 100000000n;
const UTXO_MAX_AMOUNT = 10000000000n * 100000000n - 1n; // 10 billion minus 1.

const isBs58 = (x) => {
  return x.match(/^[1-9A-HJ-NP-Za-km-z]+$/);
};

const toSatoshi = (x) => {
  if (x === null || x === undefined || typeof x !== "string" || x === "") {
    throw new Error("Expected string input");
  }
  return (BigInt(Web3Utils.toWei(x, "gwei")) / 10n).toString();
};

const fromSatoshi = (x) => {
  if (x === null || x === undefined || typeof x !== "string" || x === "") {
    throw new Error("Expected string input");
  }
  return Web3Utils.fromWei((BigInt(x) * 10n).toString(), "gwei").toString();
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

// Get SECP256k1 public key of private key.
const toPublicKey = (privKey) => {
  return secp256k1.publicKeyCreate(privKey, true);
}

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

// Create Dingocoin address from secp256k1 priv key.
const toAddress = (privKey) => {
  const pubKey = secp256k1.publicKeyCreate(privKey, true);
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

const sign = (data, privateKey) => {
  return secp256k1.ecdsaSign(data, privateKey).signature;
};

const verify = (data, signature, publicKey) => {
  return secp256k1.ecdsaVerify(signature, data, publicKey);
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
    const signature = Buffer.from(
      secp256k1.ecdsaSign(signHash, privKey).signature
    );
    const signatureDer = bitcoin.script.signature.encode(
      signature,
      bitcoin.Transaction.SIGHASH_ALL
    );

    // Compute and encode public key (SEC).
    const publicKey = Buffer.from(secp256k1.publicKeyCreate(privKey));

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

module.exports = {
  DUST_THRESHOLD,
  FEE_RATE,
  UTXO_MAX_AMOUNT,
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
  toAddress,
  sign,
  verify,
  encrypt,
  decrypt,
  createSignedRawTransaction,
};
