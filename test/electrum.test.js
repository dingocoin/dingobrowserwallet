const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bs58 = require("bs58");
const dingocoin = require("../source/dingocoin.js");
const {
  DINGOCOIN_GENESIS_HASH,
  ElectrumClient,
  ElectrumError,
  SERVERS,
  parseJson,
} = require("../source/electrum.js");
const { createProvider } = require("../source/provider.js");

const base58check = (version, hash160Hex) => {
  const payload = Buffer.concat([Buffer.from([version]), Buffer.from(hash160Hex, "hex")]);
  const sha = (x) => crypto.createHash("sha256").update(x).digest();
  return bs58.encode(Buffer.concat([payload, sha(sha(payload)).subarray(0, 4)]));
};

// Fake WebSocket backed by a per-URL handler: (method, params, socket) => result,
// or throw { code, message } for a JSON-RPC error. Unknown URLs fail to connect.
const fakeNetwork = (servers) => {
  const log = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      log.push(`connect ${url}`);
      setTimeout(() => {
        if (!(url in servers)) {
          this.readyState = 3;
          this.onclose?.({});
          return;
        }
        this.readyState = 1;
        this.onopen?.({});
      }, 0);
    }
    send(text) {
      const { id, method, params } = JSON.parse(text);
      log.push(`${this.url} ${method}`);
      const handler = servers[this.url];
      setTimeout(() => {
        if (this.readyState !== 1) return;
        let reply;
        try {
          const result = handler(method, params, this);
          if (result === undefined) return; // never answer
          reply = typeof result === "string" && result.startsWith("RAW:")
            ? result.slice(4).replace("$ID", id)
            : JSON.stringify({ jsonrpc: "2.0", id, result });
        } catch (error) {
          reply = JSON.stringify({ jsonrpc: "2.0", id, error });
        }
        this.onmessage?.({ data: reply });
      }, 0);
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      setTimeout(() => this.onclose?.({}), 0);
    }
  }
  return { FakeWebSocket, log };
};

const dingocoinServer = (handlers = {}) => (method, params, socket) => {
  if (method === "server.version") return ["ElectrumX 1.19.0", "1.4"];
  if (method === "server.features") return { genesis_hash: DINGOCOIN_GENESIS_HASH };
  return handlers[method](params, socket);
};

describe("electrum script hashes", () => {
  it("matches the Electrum protocol documentation example", () => {
    // Docs: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa (hash160 62e907b1...) -> 8b01df4e...
    // The script, and so the script hash, is the same for a Dingocoin P2PKH address.
    const address = base58check(0x1e, "62e907b15cbf27d5425399ebf6f0fb50ebb88f18");
    assert.equal(
      dingocoin.electrumScriptHash(address),
      "8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161"
    );
  });

  it("hashes P2SH output scripts and rejects invalid addresses", () => {
    const hash160 = "62e907b15cbf27d5425399ebf6f0fb50ebb88f18";
    const expected = Buffer.from(
      crypto.createHash("sha256").update(Buffer.from(`a914${hash160}87`, "hex")).digest()
    ).reverse().toString("hex");
    assert.equal(dingocoin.electrumScriptHash(base58check(0x16, hash160)), expected);
    assert.throws(() => dingocoin.electrumScriptHash("not an address"), /Invalid address/);
  });
});

describe("parseJson", () => {
  it("keeps integers beyond 2^53 exact and leaves everything else alone", () => {
    const parsed = parseJson(
      '{"confirmed":39565562019000651,"unconfirmed":-9007199254740993,"small":42,' +
        '"text":"99999999999999999999 \\" 12345678901234567890","float":1.5e3,' +
        '"list":[9007199254740991,9007199254740992]}'
    );
    assert.deepEqual(parsed, {
      confirmed: "39565562019000651",
      unconfirmed: "-9007199254740993",
      small: 42,
      text: '99999999999999999999 " 12345678901234567890',
      float: 1500,
      list: [9007199254740991, "9007199254740992"],
    });
  });
});

describe("ElectrumClient", () => {
  it("lists the Dingocoin WebSocket servers from 1209k.com", () => {
    assert.deepEqual(SERVERS, [
      "wss://seed1.dingocoin.com:3341",
      "wss://seed3.dingocoin.com:3341",
      "wss://elecx2.kmsoftware.org:3341",
    ]);
  });

  it("performs the handshake, then answers requests by id", async () => {
    const { FakeWebSocket, log } = fakeNetwork({
      "wss://a": dingocoinServer({ "server.ping": () => null, echo: (params) => params[0] }),
    });
    const client = new ElectrumClient({ servers: ["wss://a"], WebSocketImpl: FakeWebSocket });
    const [a, b] = await Promise.all([client.request("echo", ["one"]), client.request("echo", ["two"])]);
    assert.deepEqual([a, b], ["one", "two"]);
    assert.deepEqual(log.slice(0, 3), ["connect wss://a", "wss://a server.version", "wss://a server.features"]);
    assert.equal(log.filter((l) => l.startsWith("connect")).length, 1, "one shared connection");
  });

  it("fails over past unreachable and wrong-chain servers", async () => {
    const { FakeWebSocket, log } = fakeNetwork({
      "wss://other-chain": (method) =>
        method === "server.features" ? { genesis_hash: "00".repeat(32) } : ["ElectrumX", "1.4"],
      "wss://good": dingocoinServer({ echo: () => "ok" }),
    });
    const client = new ElectrumClient({
      servers: ["wss://down", "wss://other-chain", "wss://good"],
      WebSocketImpl: FakeWebSocket,
      startIndex: 0,
    });
    assert.equal(await client.request("echo", []), "ok");
    assert.deepEqual(log.filter((l) => l.startsWith("connect")), [
      "connect wss://down",
      "connect wss://other-chain",
      "connect wss://good",
    ]);
  });

  it("reports every server when none can be used", async () => {
    const { FakeWebSocket } = fakeNetwork({});
    const client = new ElectrumClient({ servers: ["wss://x", "wss://y"], WebSocketImpl: FakeWebSocket });
    await assert.rejects(client.request("echo", []), (err) => {
      assert.match(err.message, /Could not connect to the Dingocoin network/);
      assert.match(err.message, /wss:\/\/x/);
      assert.match(err.message, /wss:\/\/y/);
      return true;
    });
  });

  it("turns JSON-RPC errors into ElectrumError and times out silent requests", async () => {
    const { FakeWebSocket } = fakeNetwork({
      "wss://a": dingocoinServer({
        fail: () => {
          throw { code: 1, message: "the transaction was rejected by network rules." };
        },
        silent: () => undefined,
      }),
    });
    const client = new ElectrumClient({ servers: ["wss://a"], WebSocketImpl: FakeWebSocket, requestTimeoutMs: 50 });
    await assert.rejects(client.request("fail", []), (err) => err instanceof ElectrumError && err.code === 1);
    await assert.rejects(client.request("silent", []), /silent timed out/);
  });

  it("rejects pending requests when the connection drops, then reconnects to the next server", async () => {
    const { FakeWebSocket, log } = fakeNetwork({
      "wss://a": dingocoinServer({ drop: (params, socket) => socket.close() }),
      "wss://b": dingocoinServer({ echo: () => "from b" }),
    });
    const client = new ElectrumClient({ servers: ["wss://a", "wss://b"], WebSocketImpl: FakeWebSocket, startIndex: 0 });
    await assert.rejects(client.request("drop", []), /closed/);
    assert.equal(await client.request("echo", []), "from b");
    assert.deepEqual(log.filter((l) => l.startsWith("connect")), ["connect wss://a", "connect wss://b"]);
  });
});

describe("provider", () => {
  const address = base58check(0x1e, "62e907b15cbf27d5425399ebf6f0fb50ebb88f18");
  const scripthash = "8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161";

  it("maps unspent outputs and balances to exact satoshi strings", async () => {
    const { FakeWebSocket } = fakeNetwork({
      "wss://a": dingocoinServer({
        "blockchain.scripthash.listunspent": ([hash]) => {
          assert.equal(hash, scripthash);
          return `RAW:{"jsonrpc":"2.0","id":$ID,"result":[{"tx_hash":"${"ab".repeat(32)}","tx_pos":1,"height":0,"value":39565562019000651}]}`;
        },
        "blockchain.scripthash.get_balance": ([hash]) => {
          assert.equal(hash, scripthash);
          return `RAW:{"jsonrpc":"2.0","id":$ID,"result":{"confirmed":39565562019000651,"unconfirmed":-150000000}}`;
        },
      }),
    });
    const client = new ElectrumClient({ servers: ["wss://a"], WebSocketImpl: FakeWebSocket });
    const provider = createProvider(() => client);
    assert.deepEqual(await provider.getUtxos(address), [
      { txid: "ab".repeat(32), vout: 1, amount: "39565562019000651", height: 0 },
    ]);
    assert.deepEqual(await provider.getBalance(address), {
      confirmed: "39565562019000651",
      unconfirmed: "-150000000",
    });
  });

  it("leaves out coinbase outputs that are not yet mature", async () => {
    const txid = (label) => crypto.createHash("sha256").update(label).digest("hex");
    const tip = 1000;
    const utxos = [
      { tx_hash: txid("coinbase 900"), tx_pos: 0, height: 900, value: 100 }, // 101 blocks: immature
      { tx_hash: txid("coinbase 761"), tx_pos: 0, height: 761, value: 1 }, // 1001 - 761 = 240: mature
      { tx_hash: txid("coinbase 762"), tx_pos: 0, height: 762, value: 2 }, // 239 blocks: immature
      { tx_hash: txid("payment 990"), tx_pos: 1, height: 990, value: 3 }, // recent, not a coinbase
      { tx_hash: txid("coinbase 500"), tx_pos: 0, height: 500, value: 4 }, // old: not looked up
      { tx_hash: txid("mempool"), tx_pos: 0, height: 0, value: 5 }, // unconfirmed
    ];
    const lookedUp = [];
    const { FakeWebSocket } = fakeNetwork({
      "wss://a": dingocoinServer({
        "blockchain.scripthash.listunspent": () => utxos,
        "blockchain.headers.subscribe": () => ({ height: tip, hex: "00" }),
        "blockchain.transaction.id_from_pos": ([height, pos]) => {
          assert.equal(pos, 0);
          lookedUp.push(height);
          return txid(`coinbase ${height}`);
        },
      }),
    });
    const client = new ElectrumClient({ servers: ["wss://a"], WebSocketImpl: FakeWebSocket });
    const spendable = await createProvider(() => client).getSpendableUtxos(address);
    assert.deepEqual(spendable.map((u) => u.amount), ["1", "3", "4", "5"]);
    assert.deepEqual(lookedUp.sort(), [762, 900, 990].sort());
  });

  it("returns the txid, or the network's rejection, when broadcasting", async () => {
    const { FakeWebSocket } = fakeNetwork({
      "wss://a": dingocoinServer({
        "blockchain.transaction.broadcast": ([hex]) => {
          if (hex === "bad") {
            throw { code: 1, message: "the transaction was rejected by network rules.\n\nTX decode failed" };
          }
          return "cd".repeat(32);
        },
      }),
    });
    const client = new ElectrumClient({ servers: ["wss://a"], WebSocketImpl: FakeWebSocket });
    const provider = createProvider(() => client);
    assert.deepEqual(await provider.sendRawTransaction("good"), { txid: "cd".repeat(32) });
    assert.deepEqual(await provider.sendRawTransaction("bad"), {
      code: 1,
      message: "the transaction was rejected by network rules.\n\nTX decode failed",
    });

    const offline = createProvider(() => new ElectrumClient({ servers: ["wss://down"], WebSocketImpl: FakeWebSocket }));
    await assert.rejects(offline.sendRawTransaction("good"), /Could not connect/);
  });
});
