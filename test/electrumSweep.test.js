// Electrum seed sweeping: seed detection and key derivation against vectors
// from upstream Electrum's own test suite (github.com/spesmilo/electrum), and
// the scan, coin selection and signing built on top.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const bitcoin = require("bitcoinjs-lib");
const bs58 = require("bs58");
const { HDKey } = require("@scure/bip32");
const { secp256k1 } = require("@noble/curves/secp256k1.js");
const dingocoin = require("../source/dingocoin.js");
const { findElectrumCoins } = require("../source/sweep.js");
const { ElectrumError } = require("../source/electrum.js");

const { RECEIVING, CHANGE } = {
  RECEIVING: dingocoin.ELECTRUM_RECEIVING_CHAIN,
  CHANGE: dingocoin.ELECTRUM_CHANGE_CHAIN,
};
const hash160 = (address) => Buffer.from(bs58.decode(address)).subarray(1, 21).toString("hex");

// Emoji, kana and stacked combining marks, from upstream test_wallet_vertical.py.
const UNICODE_HORROR = Buffer.from(
  "e282bf20f09f988020f09f98882020202020e3818620e38191e3819fe381be20e3828fe3" +
  "828b2077cda2cda2cd9d68cda16fcda2cda120ccb8cda26bccb5cd9f6eccb4cd98c7ab77" +
  "ccb8cc9b73cd9820cc80cc8177cd98cda2e1b8a9ccb561d289cca1cda27420cca7cc9568" +
  "cc816fccb572cd8fccb5726f7273cca120ccb6cda1cda06cc4afccb665cd9fcd9f20ccb6" +
  "cd9d696ecda220cd8f74cc9568ccb7cca1cd9f6520cd9fcd9f64cc9b61cd9c72cc95cda1" +
  "6bcca2cca820cda168ccb465cd8f61ccb7cca2cca17274cc81cd8f20ccb4ccb7cda0c3b2" +
  "ccb5ccb666ccb82075cca7cd986ec3adcc9bcd9c63cda2cd8f6fccb7cd8f64ccb8cda265" +
  "cca1cd9d3fcd9e",
  "hex"
).toString("utf8");

// SEED_TEST_CASES from upstream tests/test_mnemonic.py: [name, words, seed
// extension, seed type, BIP32 seed]. The Spanish words use decomposed accents,
// as upstream does.
const SEED_VECTORS = [
  [
    "english",
    "wild father tree among universe such mobile favorite target dynamic credit identify",
    "",
    "segwit",
    "aac2a6302e48577ab4b46f23dbae0774e2e62c796f797d0a1b5faeb528301e3064342dafb79069e7c4c6b8c38ae11d7a973bec0d4f70626f8cc5184a8d0b0756",
  ],
  [
    "english_with_passphrase",
    "wild father tree among universe such mobile favorite target dynamic credit identify",
    "Did you ever hear the tragedy of Darth Plagueis the Wise?",
    "segwit",
    "4aa29f2aeb0127efb55138ab9e7be83b36750358751906f86c662b21a1ea1370f949e6d1a12fa56d3d93cadda93038c76ac8118597364e46f5156fde6183c82f",
  ],
  [
    "japanese",
    "なのか ひろい しなん まなぶ つぶす さがす おしゃれ かわく おいかける けさき かいとう さたん",
    "",
    "standard",
    "d3eaf0e44ddae3a5769cb08a26918e8b308258bcb057bb704c6f69713245c0b35cb92c03df9c9ece5eff826091b4e74041e010b701d44d610976ce8bfb66a8ad",
  ],
  [
    "japanese_with_passphrase",
    "なのか ひろい しなん まなぶ つぶす さがす おしゃれ かわく おいかける けさき かいとう さたん",
    UNICODE_HORROR,
    "standard",
    "251ee6b45b38ba0849e8f40794540f7e2c6d9d604c31d68d3ac50c034f8b64e4bc037c5e1e985a2fed8aad23560e690b03b120daf2e84dceb1d7857dda042457",
  ],
  [
    "chinese",
    "眼 悲 叛 改 节 跃 衡 响 疆 股 遂 冬",
    "",
    "segwit",
    "0b9077db7b5a50dbb6f61821e2d35e255068a5847e221138048a20e12d80b673ce306b6fe7ac174ebc6751e11b7037be6ee9f17db8040bb44f8466d519ce2abf",
  ],
  [
    "chinese_with_passphrase",
    "眼 悲 叛 改 节 跃 衡 响 疆 股 遂 冬",
    "给我一些测试向量谷歌",
    "segwit",
    "6c03dd0615cf59963620c0af6840b52e867468cc64f20a1f4c8155705738e87b8edb0fc8a6cee4085776cb3a629ff88bb1a38f37085efdbf11ce9ec5a7fa5f71",
  ],
  [
    "spanish",
    "almíbar tibio superar vencer hacha peatón príncipe matar consejo polen vehículo odisea",
    "",
    "standard",
    "18bffd573a960cc775bbd80ed60b7dc00bc8796a186edebe7fc7cf1f316da0fe937852a969c5c79ded8255cdf54409537a16339fbe33fb9161af793ea47faa7a",
  ],
  [
    "spanish_with_passphrase",
    "almíbar tibio superar vencer hacha peatón príncipe matar consejo polen vehículo odisea",
    "araña difícil solución término cárcel",
    "standard",
    "363dec0e575b887cfccebee4c84fca5a3a6bed9d0e099c061fa6b85020b031f8fe3636d9af187bf432d451273c625e20f24f651ada41aae2c4ea62d87e9fa44c",
  ],
  [
    "spanish2",
    "equipo fiar auge langosta hacha calor trance cubrir carro pulmón oro áspero",
    "",
    "segwit",
    "001ebce6bfde5851f28a0d44aae5ae0c762b600daf3b33fc8fc630aee0d207646b6f98b18e17dfe3be0a5efe2753c7cdad95860adbbb62cecad4dedb88e02a64",
  ],
  [
    "spanish3",
    "vidrio jabón muestra pájaro capucha eludir feliz rotar fogata pez rezar oír",
    "¡Viva España! repiten veinte pueblos y al hablar dan fe del ánimo español... ¡Marquen arado martillo y clarín",
    "segwit",
    "c274665e5453c72f82b8444e293e048d700c59bf000cacfba597629d202dcf3aab1cf9c00ba8d3456b7943428541fed714d01d8a0a4028fc3a9bb33d981cb49f",
  ],
];

describe("Electrum seed types", () => {
  // Test_seeds.mnemonics from upstream tests/test_mnemonic.py.
  const cases = [
    ["cram swing cover prefer miss modify ritual silly deliver chunk behind inform able", "standard"],
    ["cram swing cover prefer miss modify ritual silly deliver chunk behind inform", null],
    ["cycle rocket west magnet parrot shuffle foot correct salt library feed song", "standard"],
    ["OSTRICH SECURITY DEER AUNT CLIMB INNER ALPHA ARM MUTUAL MARBLE SOLID TASK", "standard"],
    ["   oStRiCh sEcUrItY DeEr aUnT ClImB       InNeR AlPhA ArM MuTuAl mArBlE   SoLiD TaSk  ", "standard"],
    ["science dawn member doll dutch real can brick knife deny drive list", "2fa"],
    ["science dawn member doll dutch real ca brick knife deny drive list", null],
    [" sCience dawn   member doll Dutch rEAl can brick knife deny drive  lisT", "2fa"],
    [
      "bind clever room kidney crucial sausage spy edit canvas soul liquid ribbon slam open alpha suffer gate relax voice carpet law hill woman tonight abstract",
      "2fa",
    ],
    [
      "sibling leg cable timber patient foot occur plate travel finger chef scale radio citizen promote immune must chef fluid sea sphere common acid lab",
      "2fa",
    ],
    ["frost pig brisk excite novel report camera enlist axis nation novel desert", "segwit"],
    ["  fRoSt pig brisk excIte novel rePort CamEra enlist axis nation nOVeL dEsert ", "segwit"],
    ["x8", "standard"],
    ["9dk", "segwit"],
    ["abandon bike", "segwit"],
    ["6vs", "2fa_segwit"],
    ["agree install", "2fa_segwit"],
    ["", null],
    ["   ", null],
  ];
  for (const [phrase, type] of cases) {
    it(`${JSON.stringify(phrase)} is ${type}`, () => {
      assert.equal(dingocoin.electrumSeedType(phrase), type);
    });
  }

  it("does not take a BIP39 phrase for an Electrum seed", () => {
    // The BIP39 test vector all-"abandon" phrase: valid BIP39, not Electrum.
    const phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    assert.equal(dingocoin.mnemonicError(phrase), null);
    assert.equal(dingocoin.electrumSeedType(phrase), null);
  });
});

describe("Electrum seed derivation", () => {
  for (const [name, words, passphrase, type, bip32Seed] of SEED_VECTORS) {
    it(`matches upstream's ${name} seed`, () => {
      assert.equal(dingocoin.electrumSeedType(words), type);
      assert.equal(
        dingocoin.electrumRootKey(words, passphrase).privateExtendedKey,
        HDKey.fromMasterSeed(Buffer.from(bip32Seed, "hex")).privateExtendedKey
      );
    });
  }

  it("derives a standard wallet's receiving and change addresses", () => {
    // test_electrum_seed_standard in upstream tests/test_wallet_vertical.py.
    // Its Bitcoin addresses are 1NNkttn1YvVGdqBW4PR6zvc3Zx3H5owKRf (receiving 0)
    // and 1KSezYMhAJMWqFbVFB2JshYg69UpmEXR4D (change 0); the Dingocoin
    // addresses below have the same hash160 under Dingocoin's version byte.
    const rootKey = dingocoin.electrumRootKey(
      "cycle rocket west magnet parrot shuffle foot correct salt library feed song"
    );
    assert.equal(
      rootKey.privateExtendedKey,
      "xprv9s21ZrQH143K32jECVM729vWgGq4mUDJCk1ozqAStTphzQtCTuoFmFafNoG1g55iCnBTXUzz3zWnDb5CVLGiFvmaZjuazHDL8a81cPQ8KL6"
    );
    const receiving = dingocoin.toAddress(dingocoin.electrumPrivateKey(rootKey, RECEIVING, 0));
    const change = dingocoin.toAddress(dingocoin.electrumPrivateKey(rootKey, CHANGE, 0));
    assert.equal(receiving, "DSWrS9ierLPZAqN6nyQfYgmeT5maTxfW3d");
    assert.equal(change, "DPakXoJLTiFoNFn5ym1sRTiGyHD89H21mz");
    assert.equal(hash160(receiving), hash160("1NNkttn1YvVGdqBW4PR6zvc3Zx3H5owKRf"));
    assert.equal(hash160(change), hash160("1KSezYMhAJMWqFbVFB2JshYg69UpmEXR4D"));
  });

  it("rejects invalid chains and indexes", () => {
    const rootKey = dingocoin.electrumRootKey("x8");
    assert.throws(() => dingocoin.electrumPrivateKey(rootKey, 2, 0), /Invalid Electrum chain/);
    for (const index of [-1, 1.5, 0x80000000]) {
      assert.throws(() => dingocoin.electrumPrivateKey(rootKey, RECEIVING, index), /Invalid address index/);
    }
  });

  it("normalizes like Electrum's normalize_text", () => {
    // Case, accents and whitespace go; spaces between CJK characters go.
    assert.equal(dingocoin.normalizeElectrumText("  Peatón  ÁRBOL\tx "), "peaton arbol x");
    assert.equal(dingocoin.normalizeElectrumText("眼 悲 叛 x y"), "眼悲叛 x y");
    // U+034F COMBINING GRAPHEME JOINER is a mark with combining class 0, which
    // Python's unicodedata.combining keeps. (Removing all marks would break
    // the UNICODE_HORROR vector above.)
    assert.equal(dingocoin.normalizeElectrumText("r\u034fr\u0301"), "r\u034fr");
    // Whitespace is Python's: U+0085 and U+001F split words, U+FEFF doesn't.
    assert.equal(dingocoin.normalizeElectrumText("a\x85b\x1fc"), "a b c");
    assert.equal(dingocoin.normalizeElectrumText("a\ufeffb"), "a\ufeffb");
  });
});

const PRIV_KEY_A = Buffer.alloc(32, 0x11);
const PRIV_KEY_B = Buffer.alloc(32, 0x22);
const DESTINATION = "DKohUQ8wAGkH5dxkaEJh8obHgzgW5PBaUW";
const txid = (n) => n.toString(16).padStart(64, "0");
const DINGO = 100000000n;

describe("selectSweep", () => {
  it("sweeps the largest coins worth more than their input's fee, keeping their keys", () => {
    const utxos = [
      { txid: txid(1), vout: 0, amount: 5n * DINGO, privKey: PRIV_KEY_A },
      { txid: txid(2), vout: 1, amount: 14900000n, privKey: PRIV_KEY_A }, // = one input's fee: skipped
      { txid: txid(3), vout: 0, amount: 20n * DINGO, privKey: PRIV_KEY_B },
    ];
    const plan = dingocoin.selectSweep({ utxos });
    assert.deepEqual(plan.inputs.map((x) => x.txid), [txid(3), txid(1)]);
    assert.equal(plan.inputs[0].privKey, PRIV_KEY_B);
    // 14 + 2 * 149 + 34 = 346 bytes, plus the 100-byte margin: one started kB.
    assert.equal(plan.fee, DINGO);
    assert.equal(plan.amount, 24n * DINGO);
    assert.equal(plan.total, 25n * DINGO);
    assert.equal(plan.eligible, 2);
    assert.equal(plan.tooSmall, 1);
  });

  it("stops at one transaction's worth of coins", () => {
    const count = dingocoin.MAX_CONSOLIDATION_INPUTS + 5;
    const utxos = Array.from({ length: count }, (_, i) => ({
      txid: txid(i + 1),
      vout: 0,
      amount: BigInt(i + 1) * DINGO,
      privKey: PRIV_KEY_A,
    }));
    const plan = dingocoin.selectSweep({ utxos });
    assert.equal(plan.inputs.length, dingocoin.MAX_CONSOLIDATION_INPUTS);
    assert.equal(plan.eligible, count);
    // The five smallest are left for the next sweep.
    assert.equal(plan.inputs.at(-1).amount, 6n * DINGO);
    // Sign it for real: the transaction must fit, and the fee must cover its
    // actual size.
    const keys = Array.from({ length: 50 }, (_, i) => Buffer.alloc(32, i + 1));
    const { tx } = dingocoin.createSignedSweepTransaction(
      plan.inputs.map((input, i) => ({ ...input, privKey: keys[i % keys.length] })),
      DESTINATION,
      plan.fee
    );
    const bytes = tx.length / 2;
    assert.ok(bytes <= dingocoin.MAX_TX_BYTES, `${bytes} bytes`);
    assert.ok(plan.fee >= dingocoin.feeForBytes(bytes));
  });

  it("refuses when there is nothing worth sweeping", () => {
    assert.throws(
      () => dingocoin.selectSweep({ utxos: [] }),
      (err) => err instanceof dingocoin.CoinSelectionError && err.reason === "nothing"
    );
    assert.throws(
      () => dingocoin.selectSweep({ utxos: [{ txid: txid(1), vout: 0, amount: DINGO }] }),
      /worth less than the fee/
    );
  });
});

describe("createSignedSweepTransaction", () => {
  const prevScript = (privKey) =>
    Buffer.from(`76a914${hash160(dingocoin.toAddress(privKey))}88ac`, "hex");

  it("matches createSignedRawTransaction for a single key", () => {
    // createSignedRawTransaction's output is pinned by known-answer vectors and
    // has been accepted by the network; with one key, no change and no data the
    // sweep must produce the same transaction byte for byte.
    const vins = [
      { txid: txid(7), vout: 2, amount: 30n * DINGO },
      { txid: txid(8), vout: 0, amount: 12n * DINGO },
    ];
    const fee = DINGO;
    const expected = dingocoin.createSignedRawTransaction(
      vins,
      [{ address: DESTINATION, amount: 41n * DINGO }],
      null,
      fee,
      dingocoin.toAddress(PRIV_KEY_A),
      PRIV_KEY_A
    );
    const sweep = dingocoin.createSignedSweepTransaction(
      vins.map((vin) => ({ ...vin, privKey: PRIV_KEY_A })),
      DESTINATION,
      fee
    );
    assert.equal(sweep.tx, expected.tx);
    assert.equal(sweep.outputAmount, 41n * DINGO);
  });

  it("signs each input with its own key", () => {
    const inputs = [
      { txid: txid(1), vout: 0, amount: 10n * DINGO, privKey: PRIV_KEY_A },
      { txid: txid(2), vout: 3, amount: 5n * DINGO, privKey: PRIV_KEY_B },
    ];
    const { tx: hex } = dingocoin.createSignedSweepTransaction(inputs, DESTINATION, DINGO);
    const tx = bitcoin.Transaction.fromHex(hex);
    assert.equal(tx.outs.length, 1);
    assert.equal(tx.outs[0].value, 14n * DINGO);
    assert.equal(tx.outs[0].script.toString("hex"), `76a914${hash160(DESTINATION)}88ac`);
    inputs.forEach((input, index) => {
      assert.equal(Buffer.from(tx.ins[index].hash).reverse().toString("hex"), input.txid);
      assert.equal(tx.ins[index].index, input.vout);
      const [signatureDer, publicKey] = bitcoin.script.decompile(tx.ins[index].script);
      assert.deepEqual(Buffer.from(publicKey), Buffer.from(dingocoin.toPublicKey(input.privKey)));
      const { signature, hashType } = bitcoin.script.signature.decode(signatureDer);
      assert.equal(hashType, bitcoin.Transaction.SIGHASH_ALL);
      const signHash = tx.hashForSignature(index, prevScript(input.privKey), hashType);
      assert.ok(secp256k1.verify(signature, signHash, publicKey, { prehash: false }));
      // ...and not against the other input's key.
      const other = inputs[1 - index].privKey;
      const otherHash = tx.hashForSignature(index, prevScript(other), hashType);
      assert.ok(!secp256k1.verify(signature, otherHash, publicKey, { prehash: false }));
    });
  });

  it("pays P2SH destinations and refuses dust or nothing", () => {
    const p2sh = "A6hSrTDre3bMCLzqaf3edKgLK8FMvdRu19";
    const input = { txid: txid(1), vout: 0, amount: 3n * DINGO, privKey: PRIV_KEY_A };
    const tx = bitcoin.Transaction.fromHex(
      dingocoin.createSignedSweepTransaction([input], p2sh, DINGO).tx
    );
    assert.equal(tx.outs[0].script.toString("hex"), `a914${hash160(p2sh)}87`);
    assert.throws(
      () => dingocoin.createSignedSweepTransaction([input], DESTINATION, 3n * DINGO - DINGO + 1n),
      /dust threshold/
    );
    assert.throws(() => dingocoin.createSignedSweepTransaction([], DESTINATION, DINGO), /Nothing to sweep/);
    assert.throws(() => dingocoin.createSignedSweepTransaction([input], "nope", DINGO), /Unknown address type/);
  });
});

describe("findElectrumCoins", () => {
  const rootKey = dingocoin.electrumRootKey(
    "cycle rocket west magnet parrot shuffle foot correct salt library feed song"
  );
  const addressAt = (chain, index) =>
    dingocoin.toAddress(dingocoin.electrumPrivateKey(rootKey, chain, index));

  // Fake provider: history for the given addresses, one coin on some of them.
  const fakeProvider = ({ used, coins }) => {
    const historyLookups = [];
    return {
      historyLookups,
      getHistory: async (address) => {
        historyLookups.push(address);
        return used.has(address) ? [{ txid: txid(99), height: 10 }] : [];
      },
      getSpendableUtxos: async (address) => coins[address] ?? [],
    };
  };

  it("scans both chains to the gap limit and returns each coin with its key", async () => {
    // Receiving: 0 and 3 are used, then 21 unused, then 25. Electrum (gap 20)
    // would stop before 25, but the scan fetches 20 addresses at a time and
    // keeps every used one it sees. After 25, batch 40-59 is all unused, so
    // the scan stops and never sees 70.
    // Change: 0 was used and emptied (history, no coins); 19 holds a coin.
    const used = new Set([
      addressAt(RECEIVING, 0),
      addressAt(RECEIVING, 3),
      addressAt(RECEIVING, 25),
      addressAt(RECEIVING, 70),
      addressAt(CHANGE, 0),
      addressAt(CHANGE, 19),
    ]);
    const coins = {
      [addressAt(RECEIVING, 3)]: [{ txid: txid(1), vout: 0, amount: "1000000000000", height: 5 }],
      [addressAt(RECEIVING, 25)]: [{ txid: txid(2), vout: 1, amount: "250000000", height: 0 }],
      [addressAt(RECEIVING, 70)]: [{ txid: txid(4), vout: 0, amount: "100000000", height: 7 }],
      [addressAt(CHANGE, 19)]: [{ txid: txid(3), vout: 0, amount: "9007199254740993", height: 7 }],
    };
    const provider = fakeProvider({ used, coins });
    const found = await findElectrumCoins({ rootKey, provider });

    assert.equal(found.usedAddresses, 5);
    // Receiving 0-59 and change 0-39 (19 used, then 20-39 unused).
    assert.equal(provider.historyLookups.length, 60 + 40);
    assert.ok(!provider.historyLookups.includes(addressAt(RECEIVING, 60)));
    assert.ok(found.coins.every((coin) => dingocoin.toAddress(coin.privKey) === coin.address));
    assert.deepEqual(
      found.coins.map((coin) => [coin.txid, coin.vout, coin.amount, coin.height, coin.address]),
      [
        [txid(1), 0, 1000000000000n, 5, addressAt(RECEIVING, 3)],
        [txid(2), 1, 250000000n, 0, addressAt(RECEIVING, 25)],
        [txid(3), 0, 9007199254740993n, 7, addressAt(CHANGE, 19)],
      ]
    );
  });

  it("finds nothing for an unused seed after one batch per chain", async () => {
    const provider = fakeProvider({ used: new Set(), coins: {} });
    const found = await findElectrumCoins({ rootKey, provider });
    assert.deepEqual(found, { usedAddresses: 0, coins: [] });
    assert.equal(provider.historyLookups.length, 40);
  });

  it("gives up on a wallet whose every address is used", async () => {
    const provider = {
      getHistory: async () => [{ txid: txid(1), height: 1 }],
      getSpendableUtxos: async () => [],
    };
    await assert.rejects(
      findElectrumCoins({ rootKey, provider, maxAddressesPerChain: 100 }),
      /too many addresses/
    );
  });

  it("counts an address whose history is too large to list as used", async () => {
    // What ElectrumX answers for a busy address, such as a pool payout address.
    const busy = addressAt(RECEIVING, 7);
    const provider = {
      getHistory: async (address) => {
        if (address === busy) {
          throw new ElectrumError({ code: 1, message: "history too large" });
        }
        return [];
      },
      getSpendableUtxos: async (address) =>
        address === busy ? [{ txid: txid(5), vout: 0, amount: "300000000", height: 9 }] : [],
    };
    const found = await findElectrumCoins({ rootKey, provider });
    assert.equal(found.usedAddresses, 1);
    assert.deepEqual(found.coins.map((coin) => coin.address), [busy]);
  });

  it("passes other server errors and network errors through", async () => {
    const refusing = {
      getHistory: async () => {
        throw new ElectrumError({ code: -32600, message: "response too large" });
      },
      getSpendableUtxos: async () => [],
    };
    await assert.rejects(findElectrumCoins({ rootKey, provider: refusing }), ElectrumError);

    const provider = {
      getHistory: async () => {
        throw new Error("Could not connect to the Dingocoin network");
      },
      getSpendableUtxos: async () => [],
    };
    await assert.rejects(findElectrumCoins({ rootKey, provider }), /Could not connect/);
  });
});
