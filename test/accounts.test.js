const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const dingocoin = require("../source/dingocoin.js");
const accounts = require("../source/accounts.js");

const ABANDON =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const LEGAL = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const PASSWORD = "correct horse battery staple";

// Addresses and WIFs from Dingocoin's BIP39 tool (github.com/dingocoin/bip39 @ 4d024b0,
// network "DINGO - Dingocoin", BIP44 m/44'/3'/0'/0/i), an independent implementation.
const TOOL_VECTORS = {
  [ABANDON]: [
    ["DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC", "QPkeC1ZfHx3c9g7WTj9cQ8gnvk2iSAfAcbq1aVAWjNTwDAKfZUzx"],
    ["DAcDAtJRztxBHyA6D6h8du1HguyTR43Mas", "QP3j5SpiwZk9k8z9kaV2S6gbrVkoPaWyfW1Wy4x1WUQoyTab9VfH"],
    ["D8K3KyDQ9FXeC3ADCuWW7cnWC7RvjHjV8H", "QSnP9ZrYTcs3iu5x2uft3mGsnFMMisgshuhAMxYLaES6cndEdopn"],
    ["D6RRdXkUbb3pazkYGXAXwbJY5iC8Tyqwzh", "QWrs9eEpooF82vkEJ4xghRJW39JLkLYcq98p5irFA4maqyMaHHyw"],
    ["DTdrvUHbk5oMyi62tM7LqrjAcXfqB7eaad", "QRpr6SYesbYiT6LZSpi8sJgysVCB3YEPYmRRvVAxq5Gu96eVbPkG"],
  ],
  [LEGAL]: [
    ["DMM78DyiwEPzWmykiQQUFcPcUv13YPe2ZK", "QS5B2Yt6HFyVS6G16jiVC1AgdJr44X4kxM3SMyYt86bRhXaickki"],
    ["DUTGAajtBwaAXzLTLEYcGbqZ5L62HU8B69", "QX7ysUdBpWwJBE5eF5wzh9uWaR9kv8faTwiJAk4TmUVGbsc41mqV"],
    ["DCNLfc4CJ1jNEA7PBuKtPxKVToJ8mHCoBa", "QV2cuYeTTkfpD8XTN8Zeg2oASwc9CebLNqXeLjxJC9cwp4SBdYn4"],
    ["DCkJ4MF6rfnxLRQXUi9w3SUmQUpeJ12vPt", "QQpXFWZ1rNjk1ru9GcLhfbCmYB1XzpBnZ6aKPCJv3WLL86uBBcnZ"],
    ["D8mAmrac8yh59mykmbvifCfDj1BiH7KHtp", "QU6fcsrpa2kYu8hcRQb7iTs8LVwEunYjCLGKEGDLpobGn9omQmbp"],
  ],
};

// Legacy account fixture shared with dingocoin.test.js (key = WIF below).
const LEGACY_ACCOUNT = {
  salt: "63479ad69a090b258277ec8fba6f99419a2ffb248981510657c944ccd1148e97",
  iv: "0ab306823035661bb8dba21cc2535231",
  ciphertext: "b41baae2666ad46f551ef35adf6fd0a9c187aa8161bbf2a1017f90b5bd6a97b2",
  label: "",
  address: "DKohUQ8wAGkH5dxkaEJh8obHgzgW5PBaUW",
};
const LEGACY_WIF = "QPJP3ei7W2mPUAVTyXCty9pAhhJEtn4KCnAt3LmEvNrbhn8aNx1j";

describe("recovery phrases", () => {
  it("derives the same accounts as Dingocoin's BIP39 tool", () => {
    assert.equal(dingocoin.HD_PATH, "m/44'/3'/0'/0");
    for (const [mnemonic, expected] of Object.entries(TOOL_VECTORS)) {
      const entropy = dingocoin.mnemonicToEntropy(mnemonic);
      expected.forEach(([address, wif], index) => {
        const privKey = dingocoin.hdPrivateKey(entropy, index);
        assert.equal(dingocoin.toAddress(privKey), address, `${mnemonic} #${index}`);
        assert.equal(dingocoin.toWif(privKey), wif, `${mnemonic} #${index}`);
      });
    }
  });

  it("generates valid 12-word phrases", () => {
    const first = dingocoin.generateMnemonic();
    assert.equal(first.split(" ").length, 12);
    assert.equal(dingocoin.mnemonicError(first), null);
    assert.notEqual(dingocoin.generateMnemonic(), first);
  });

  it("round-trips entropy for 12, 18 and 24-word phrases", () => {
    const phrases = [
      ABANDON,
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon agent",
      "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote",
    ];
    for (const phrase of phrases) {
      assert.equal(dingocoin.entropyToMnemonic(dingocoin.mnemonicToEntropy(phrase)), phrase);
    }
  });

  it("accepts typed or pasted phrases with odd spacing and capitals", () => {
    const messy = `  ${ABANDON.toUpperCase().replace(/ /g, " \n\t ")}  `;
    assert.equal(dingocoin.mnemonicError(messy), null);
    assert.ok(dingocoin.mnemonicToEntropy(messy).equals(dingocoin.mnemonicToEntropy(ABANDON)));
  });

  it("explains invalid phrases", () => {
    assert.match(dingocoin.mnemonicError("abandon abandon"), /12, 15, 18, 21 or 24 words \(got 2\)/);
    assert.match(dingocoin.mnemonicError(ABANDON.replace("about", "abuot")), /Word 12 \("abuot"\)/);
    assert.match(dingocoin.mnemonicError(ABANDON.replace("about", "abandon")), /Check the spelling and order/);
  });

  it("rejects invalid account indexes", () => {
    const entropy = dingocoin.mnemonicToEntropy(ABANDON);
    for (const index of [-1, 1.5, 0x80000000]) {
      assert.throws(() => dingocoin.hdPrivateKey(entropy, index), /Invalid account index/);
    }
  });
});

describe("vault encryption", () => {
  it("round-trips secrets of any length and rejects a wrong password", async () => {
    for (const length of [16, 24, 32]) {
      const secret = crypto.randomBytes(length);
      const vault = await dingocoin.encryptVault(secret, PASSWORD);
      assert.equal(vault.iterations, 600000);
      assert.ok((await dingocoin.decryptVault(vault, PASSWORD)).equals(secret));
      assert.equal(await dingocoin.decryptVault(vault, PASSWORD + "!"), null);
    }
  });

  it("rejects tampered ciphertext", async () => {
    const vault = await dingocoin.encryptVault(Buffer.alloc(16, 7), PASSWORD);
    const bytes = Buffer.from(vault.ciphertext, "hex");
    bytes[0] ^= 1;
    assert.equal(
      await dingocoin.decryptVault({ ...vault, ciphertext: bytes.toString("hex") }, PASSWORD),
      null
    );
  });

  it("reads vaults written with standard PBKDF2-SHA512 and AES-256-GCM", async () => {
    // Built with Node's OpenSSL bindings, independently of encryptVault.
    const secret = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const salt = Buffer.alloc(32, 1);
    const iv = Buffer.alloc(12, 2);
    const key = crypto.pbkdf2Sync(PASSWORD, salt, 1000, 32, "sha512");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final(), cipher.getAuthTag()]);
    const vault = {
      kdf: "pbkdf2-sha512",
      iterations: 1000,
      salt: salt.toString("hex"),
      cipher: "aes-256-gcm",
      iv: iv.toString("hex"),
      ciphertext: ciphertext.toString("hex"),
    };
    assert.ok((await dingocoin.decryptVault(vault, PASSWORD)).equals(secret));
    await assert.rejects(dingocoin.decryptVault({ ...vault, cipher: "aes-256-cbc" }, PASSWORD), /Unsupported/);
  });
});

describe("accounts", () => {
  it("classifies stored account records", () => {
    assert.equal(accounts.accountType(LEGACY_ACCOUNT), "legacy");
    assert.equal(accounts.accountType({ type: "key" }), "key");
    assert.equal(accounts.accountType({ type: "hd", index: 0 }), "hd");
    assert.equal(accounts.isRecoveryPhraseAccount(LEGACY_ACCOUNT), false);
  });

  it("picks the lowest unused recovery-phrase index", () => {
    assert.equal(accounts.nextHdIndex([]), 0);
    assert.equal(accounts.nextHdIndex([LEGACY_ACCOUNT, { type: "hd", index: 0 }]), 1);
    assert.equal(
      accounts.nextHdIndex([{ type: "hd", index: 0 }, { type: "hd", index: 2 }]),
      1
    );
  });

  it("unlocks legacy accounts created before recovery phrases", async () => {
    const privKey = await accounts.unlockAccount(LEGACY_ACCOUNT, PASSWORD, undefined);
    assert.equal(dingocoin.toWif(privKey), LEGACY_WIF);
    assert.equal(await accounts.unlockAccount(LEGACY_ACCOUNT, "wrong password", undefined), null);
  });

  it("creates, reveals and unlocks a recovery-phrase wallet", async () => {
    const wallet = await accounts.createWallet(ABANDON, PASSWORD);
    assert.equal(JSON.stringify(wallet).includes("abandon"), false);
    assert.equal(await accounts.revealMnemonic(wallet, PASSWORD), ABANDON);
    assert.equal(await accounts.revealMnemonic(wallet, "wrong password"), null);

    const first = accounts.firstHdAccount(ABANDON);
    assert.deepEqual(first, {
      type: "hd",
      index: 0,
      label: "Account 1",
      address: TOOL_VECTORS[ABANDON][0][0],
    });

    const second = await accounts.createHdAccount(wallet, PASSWORD, [first], "Savings");
    assert.deepEqual(second, {
      type: "hd",
      index: 1,
      label: "Savings",
      address: TOOL_VECTORS[ABANDON][1][0],
    });
    assert.equal(await accounts.createHdAccount(wallet, "wrong password", [first], ""), null);

    const privKey = await accounts.unlockAccount(second, PASSWORD, wallet);
    assert.equal(dingocoin.toWif(privKey), TOOL_VECTORS[ABANDON][1][1]);
    assert.equal(await accounts.unlockAccount(second, "wrong password", wallet), null);
    await assert.rejects(accounts.unlockAccount(second, PASSWORD, undefined), /Recovery phrase not found/);
  });

  it("stores imported private keys encrypted and unlocks them", async () => {
    const privKey = dingocoin.fromWif(LEGACY_WIF);
    const account = await accounts.createKeyAccount(privKey, PASSWORD, "Imported");
    assert.equal(account.type, "key");
    assert.equal(account.address, LEGACY_ACCOUNT.address);
    assert.equal(JSON.stringify(account).includes(privKey.toString("hex")), false);
    assert.ok((await accounts.unlockAccount(account, PASSWORD, undefined)).equals(privKey));
    assert.equal(await accounts.unlockAccount(account, "wrong password", undefined), null);
  });

  it("refuses a key that does not match the stored address", async () => {
    const wallet = await accounts.createWallet(ABANDON, PASSWORD);
    const tampered = { ...accounts.firstHdAccount(ABANDON), index: 3 };
    assert.equal(await accounts.unlockAccount(tampered, PASSWORD, wallet), null);
  });
});
