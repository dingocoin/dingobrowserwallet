// Known-answer tests for source/dingocoin.js. The expected values were produced by
// the webpack 4 build on master, so they pin key derivation, account encryption,
// and transaction signing across toolchain and dependency upgrades.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const dingocoin = require("../source/dingocoin.js");

const hex = (b) => Buffer.from(b).toString("hex");

const PRIV_KEY = Buffer.from(
  "1473653f3a3b00f1700ac9397f8faf1abba13bc60ccfa623b2f5db34c59b2766",
  "hex"
);
const ADDRESS = "DKohUQ8wAGkH5dxkaEJh8obHgzgW5PBaUW";
const WIF = "QPJP3ei7W2mPUAVTyXCty9pAhhJEtn4KCnAt3LmEvNrbhn8aNx1j";
const P2PKH_ADDRESS = "DKQGjKcAKVJMjp7Xn1iCWKrdMAJuZyd6zn";
const P2SH_ADDRESS = "A6hSrTDre3bMCLzqaf3edKgLK8FMvdRu19";
const PASSWORD = "correct horse battery staple";

const VINS = [
  {
    txid: "709b55bd3da0f5a838125bd0ee20c5bfdd7caba173912d4281cae816b79a201b",
    vout: 0,
    amount: 500000000000n,
  },
  {
    txid: "27ca64c092a959c7edc525ed45e845b1de6a7590d173fd2fad9133c8a779a1e3",
    vout: 3,
    amount: 250000000000n,
  },
];

describe("keys and addresses", () => {
  it("derives the public key, address and WIF", () => {
    assert.equal(
      hex(dingocoin.toPublicKey(PRIV_KEY)),
      "0246bcc311a21e00768f9fcdcdf21e26ba4db2510a7b6be87bcb3af7957e7a6a61"
    );
    assert.equal(dingocoin.toAddress(PRIV_KEY), ADDRESS);
    assert.equal(dingocoin.toWif(PRIV_KEY), WIF);
    assert.ok(dingocoin.fromWif(WIF).equals(PRIV_KEY));
  });

  it("validates addresses and WIFs", () => {
    assert.ok(dingocoin.isAddress(ADDRESS));
    assert.ok(dingocoin.isAddress(P2SH_ADDRESS));
    assert.ok(!dingocoin.isAddress(ADDRESS.slice(0, -1) + "V"));
    assert.ok(dingocoin.isWif(WIF));
    assert.ok(!dingocoin.isWif(WIF.slice(0, -1) + "k"));
  });
});

describe("account encryption", () => {
  it("decrypts an account encrypted by the released extension", () => {
    const encrypted = {
      salt: "63479ad69a090b258277ec8fba6f99419a2ffb248981510657c944ccd1148e97",
      iv: "0ab306823035661bb8dba21cc2535231",
      ciphertext:
        "b41baae2666ad46f551ef35adf6fd0a9c187aa8161bbf2a1017f90b5bd6a97b2",
    };
    assert.ok(dingocoin.decrypt(encrypted, PASSWORD).equals(PRIV_KEY));
  });

  it("round-trips encrypt and decrypt", () => {
    const encrypted = dingocoin.encrypt(PRIV_KEY, PASSWORD);
    assert.ok(dingocoin.decrypt(encrypted, PASSWORD).equals(PRIV_KEY));
  });
});

describe("signing", () => {
  it("produces deterministic signatures", () => {
    const digest = dingocoin.sha256(Buffer.from("hello dingo"));
    const signature = dingocoin.sign(digest, PRIV_KEY);
    assert.equal(
      hex(signature),
      "086b9f37f0ebc50406ee27a5bc4e4b05d741c0ab751f318886b3fa332bfa24fd0e0e1edbbb6c1e2297f1c25b04baeeac00787ea311b55336ad730681c793f372"
    );
    assert.ok(
      dingocoin.verify(digest, signature, dingocoin.toPublicKey(PRIV_KEY))
    );
  });

  // Expected signatures come from libsecp256k1 (tiny-secp256k1), not from the code under test.
  it("matches libsecp256k1 when the nonce or digest has a leading zero byte", () => {
    const vectors = [
      {
        // RFC 6979 nonce k = 0x0024696f...
        digest: dingocoin.sha256(Buffer.from("nonce-leading-zero-141")),
        signature:
          "50a36684033c904b3d9d1314781f58124bc5167eee5bbf54f080e15c2b1ead5b5607859e06a06c06405ee53db16d5f3b9f1088185e6a0807668338102a492d24",
      },
      {
        digest: dingocoin.sha256(Buffer.from("digest-leading-zero-9")),
        signature:
          "1e637ca3f517f99a8dfc4559a4aaa6acd76521a12d01f70bef83c79388158a4b29dba4c414c7a690d6b31d45f035249faae3b31bb4bdd5cdd2dfc7e524577460",
      },
    ];
    assert.equal(vectors[1].digest[0], 0);
    for (const { digest, signature } of vectors) {
      assert.equal(hex(dingocoin.sign(digest, PRIV_KEY)), signature);
    }
  });

  it("only signs and verifies 32-byte digests", () => {
    const publicKey = dingocoin.toPublicKey(PRIV_KEY);
    const signature = dingocoin.sign(Buffer.alloc(32, 1), PRIV_KEY);
    for (const data of [Buffer.alloc(31, 1), Buffer.alloc(33, 1), "00".repeat(32)]) {
      assert.throws(() => dingocoin.sign(data, PRIV_KEY), /32-byte digest/);
      assert.throws(() => dingocoin.verify(data, signature, publicKey), /32-byte digest/);
    }
  });

  it("rejects tampered and high-S signatures", () => {
    const N = BigInt(
      "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"
    );
    const digest = dingocoin.sha256(Buffer.from("hello dingo"));
    const publicKey = dingocoin.toPublicKey(PRIV_KEY);
    const signature = Buffer.from(dingocoin.sign(digest, PRIV_KEY));

    const tampered = Buffer.from(signature);
    tampered[10] ^= 1;
    assert.equal(dingocoin.verify(digest, tampered, publicKey), false);

    const s = BigInt("0x" + hex(signature.subarray(32)));
    const highS = Buffer.concat([
      signature.subarray(0, 32),
      Buffer.from((N - s).toString(16).padStart(64, "0"), "hex"),
    ]);
    assert.equal(dingocoin.verify(digest, highS, publicKey), false);
  });

  it("builds and signs a transaction with P2PKH, P2SH, change and OP_RETURN outputs", () => {
    const result = dingocoin.createSignedRawTransaction(
      VINS,
      [
        { address: P2PKH_ADDRESS, amount: 300000000000n },
        { address: P2SH_ADDRESS, amount: 100000000000n },
      ],
      Buffer.from("dingo op_return payload"),
      100000000n,
      ADDRESS,
      PRIV_KEY
    );
    assert.equal(
      result.tx,
      "01000000021b209ab716e8ca81422d9173a1ab7cddbfc520eed05b1238a8f5a03dbd559b70000000006a4730440220128b7e77601e62d8341eb1b880d0d7bd60043c0093a59c2170f6700055688659022027379e04e490ef169528e97d9837bf3c70b578de44e2e4c0e23c50b3520823c901210246bcc311a21e00768f9fcdcdf21e26ba4db2510a7b6be87bcb3af7957e7a6a61ffffffffe3a179a7c83391ad2ffd73d190756adeb145e845ed25c5edc759a992c064ca27030000006b4830450221008ca82b01ab01bcc25ea186ce4313ca8027d74a1818a81c399dc5eb37d81ef7c9022070462098b97b829b1c4cf40e1c2d9e92e86c86b37bec4d7eb17dec1dfc7b96a401210246bcc311a21e00768f9fcdcdf21e26ba4db2510a7b6be87bcb3af7957e7a6a61ffffffff0400b864d9450000001976a9149c7081d82b646f29118a3de1991a895c8aefb7ac88ac00e876481700000017a9149c7081d82b646f29118a3de1991a895c8aefb7ac87004baa77510000001976a914a0deba7fdc345fd5ee1e551b26abc4487ad6185a88ac0000000000000000196a1764696e676f206f705f72657475726e207061796c6f616400000000"
    );
    assert.equal(result.inputAmount, 750000000000n);
    assert.equal(result.outputAmount, 400000000000n);
    assert.equal(result.balanceAmount, 349900000000n);
  });

  it("rejects outputs below the dust threshold", () => {
    assert.throws(
      () =>
        dingocoin.createSignedRawTransaction(
          VINS,
          [{ address: P2PKH_ADDRESS, amount: dingocoin.DUST_THRESHOLD - 1n }],
          null,
          100000000n,
          ADDRESS,
          PRIV_KEY
        ),
      /dust threshold/
    );
  });
});

describe("amount conversion", () => {
  it("converts between DINGO strings and satoshis", () => {
    assert.equal(dingocoin.toSatoshi("1234.56789012"), "123456789012");
    assert.equal(dingocoin.fromSatoshi("123456789012"), "1234.56789012");
  });
});
