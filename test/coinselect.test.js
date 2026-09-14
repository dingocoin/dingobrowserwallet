const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bitcoin = require("bitcoinjs-lib");
const dingocoin = require("../source/dingocoin.js");

const DINGO = 100000000n;
const PRIV_KEY = Buffer.from(
  "1473653f3a3b00f1700ac9397f8faf1abba13bc60ccfa623b2f5db34c59b2766",
  "hex"
);
const OWNER = dingocoin.toAddress(PRIV_KEY);
const RECIPIENT = "DKQGjKcAKVJMjp7Xn1iCWKrdMAJuZyd6zn";
const P2SH_RECIPIENT = "A6hSrTDre3bMCLzqaf3edKgLK8FMvdRu19";

// Deterministic fake UTXOs.
const utxo = (i, dingo) => ({
  txid: crypto.createHash("sha256").update(`utxo ${i}`).digest("hex"),
  vout: i % 3,
  amount: BigInt(dingo * 1e8),
});

// Builds and signs the selected transaction, and checks it against the rules the
// Dingocoin network enforces: under 100,000 bytes, enough fee for its real size,
// and no output below 1 DINGO.
const buildAndCheck = ({ utxos, outputs, data = null, required = [] }) => {
  const selection = dingocoin.selectCoins({ utxos, outputs, data, required });
  const signed = dingocoin.createSignedRawTransaction(
    selection.inputs, outputs, data, selection.fee, OWNER, PRIV_KEY
  );
  const bytes = signed.tx.length / 2;
  assert.ok(bytes < 100000, `transaction is ${bytes} bytes`);
  assert.ok(selection.fee >= dingocoin.feeForBytes(bytes), `fee ${selection.fee} for ${bytes} bytes`);
  const tx = bitcoin.Transaction.fromHex(signed.tx);
  for (const out of tx.outs) {
    if (out.script[0] !== 0x6a) {
      assert.ok(BigInt(out.value) >= dingocoin.DUST_THRESHOLD, `dust output ${out.value}`);
    }
  }
  assert.ok(signed.balanceAmount >= 0n);
  return { selection, signed, tx, bytes };
};

describe("coin selection", () => {
  it("uses the network's dust limit of 1 DINGO", () => {
    assert.equal(dingocoin.DUST_THRESHOLD, DINGO);
    assert.throws(
      () => dingocoin.selectCoins({ utxos: [utxo(1, 10)], outputs: [{ address: RECIPIENT, amount: DINGO - 1n }] }),
      (err) => err instanceof dingocoin.CoinSelectionError && err.reason === "dust"
    );
  });

  it("spends the largest coins first and returns change", () => {
    const utxos = [utxo(1, 5), utxo(2, 500), utxo(3, 50), utxo(4, 1000)];
    const { selection, tx } = buildAndCheck({ utxos, outputs: [{ address: RECIPIENT, amount: 1200n * DINGO }] });
    assert.deepEqual(selection.inputs.map((i) => i.amount), [1000n * DINGO, 500n * DINGO]);
    assert.equal(selection.fee, DINGO);
    assert.equal(tx.outs.length, 2);
    assert.equal(BigInt(tx.outs[1].value), 299n * DINGO);
  });

  it("gives change below 1 DINGO to the fee instead of creating dust", () => {
    const utxos = [utxo(1, 100)];
    const { selection, tx } = buildAndCheck({ utxos, outputs: [{ address: RECIPIENT, amount: 98n * DINGO + 50000000n }] });
    assert.equal(tx.outs.length, 1, "no change output");
    assert.equal(selection.fee, DINGO + 50000000n);
  });

  it("covers P2SH recipients, OP_RETURN data and required inputs", () => {
    const utxos = [utxo(1, 20), utxo(2, 30), utxo(3, 40)];
    const required = [{ txid: utxos[0].txid, vout: utxos[0].vout, amount: 0n }];
    const { selection, tx } = buildAndCheck({
      utxos,
      outputs: [{ address: P2SH_RECIPIENT, amount: 60n * DINGO }],
      data: Buffer.alloc(80, 7),
      required,
    });
    assert.equal(selection.inputs[0], required[0], "required input first");
    assert.equal(
      selection.inputs.filter((i) => i.txid === utxos[0].txid && i.vout === utxos[0].vout).length,
      1,
      "a required outpoint is not selected twice"
    );
    assert.ok(tx.outs.some((o) => o.script[0] === 0x6a));
  });

  it("reports insufficient balance", () => {
    assert.throws(
      () => dingocoin.selectCoins({ utxos: [utxo(1, 10), utxo(2, 10)], outputs: [{ address: RECIPIENT, amount: 20n * DINGO }] }),
      (err) => err.reason === "insufficient"
    );
  });

  it("lets a wallet with thousands of coins send with a small transaction", () => {
    const utxos = Array.from({ length: 5000 }, (_, i) => utxo(i, 10000));
    const { selection, bytes } = buildAndCheck({ utxos, outputs: [{ address: RECIPIENT, amount: 1000000n * DINGO }] });
    assert.equal(selection.inputs.length, 101);
    assert.ok(bytes < 16000);
  });

  it("refuses amounts that need more than one standard transaction, and says how much fits", () => {
    const utxos = Array.from({ length: 5000 }, (_, i) => utxo(i, 10000));
    let maxAmount;
    assert.throws(
      () => dingocoin.selectCoins({ utxos, outputs: [{ address: RECIPIENT, amount: 10000000n * DINGO }] }),
      (err) => {
        assert.equal(err.reason, "too-large");
        maxAmount = err.maxAmount;
        return true;
      }
    );
    assert.equal(maxAmount, 6639900n * DINGO);
    const { bytes } = buildAndCheck({ utxos, outputs: [{ address: RECIPIENT, amount: maxAmount }] });
    assert.ok(bytes > 95000 && bytes < 100000, `max-size transaction is ${bytes} bytes`);
  });

  it("never underestimates the fee or size across random wallets", () => {
    for (let round = 0; round < 25; round++) {
      const count = 1 + crypto.randomInt(400);
      const utxos = Array.from({ length: count }, () => ({
        txid: crypto.randomBytes(32).toString("hex"),
        vout: crypto.randomInt(5),
        amount: 1n * DINGO + BigInt(crypto.randomInt(1e9)) * BigInt(1 + crypto.randomInt(1000)),
      }));
      const total = utxos.reduce((sum, u) => sum + u.amount, 0n);
      const amount = DINGO + (total * BigInt(crypto.randomInt(95))) / 100n;
      const data = crypto.randomInt(2) ? Buffer.alloc(crypto.randomInt(81), 1) : null;
      try {
        buildAndCheck({ utxos, outputs: [{ address: crypto.randomInt(2) ? RECIPIENT : P2SH_RECIPIENT, amount }], data });
      } catch (err) {
        if (!(err instanceof dingocoin.CoinSelectionError)) throw err;
      }
    }
  });
});
