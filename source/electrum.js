// Minimal Electrum protocol client over WebSocket for Dingocoin ElectrumX servers.
// Protocol: https://electrumx.readthedocs.io/en/latest/protocol.html

// Dingocoin servers listed on https://1209k.com/bitcoin-eye/ele.php?chain=dingo.
// Browser extensions cannot open raw TCP/TLS sockets, so only their WebSocket
// (wss) port is usable. The client starts at a random server and fails over.
const SERVERS = [
  "wss://seed1.dingocoin.com:3341",
  "wss://seed3.dingocoin.com:3341",
  "wss://elecx2.kmsoftware.org:3341",
];

const PROTOCOL_VERSION = "1.4";

// Servers for any other chain are refused.
const DINGOCOIN_GENESIS_HASH =
  "1a91e3dace36e2be3bf030a65679fe821aa1d6ef92e7c9902eb318182c355691";

const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

// JSON.parse, except integers beyond Number.MAX_SAFE_INTEGER are kept exact as
// strings. Electrum sends satoshi amounts as JSON numbers, and balances above
// ~90 million DINGO would otherwise be silently rounded.
const parseJson = (text) => {
  let out = "";
  let copied = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        i += text[i] === "\\" ? 2 : 1;
      }
    } else if (c === "-" || (c >= "0" && c <= "9")) {
      NUMBER.lastIndex = i;
      const [literal] = NUMBER.exec(text);
      const end = i + literal.length;
      if (/^-?\d+$/.test(literal) && !Number.isSafeInteger(Number(literal))) {
        out += `${text.slice(copied, i)}"${literal}"`;
        copied = end;
      }
      i = end - 1;
    }
  }
  return JSON.parse(out + text.slice(copied));
};

// A JSON-RPC error returned by the server, e.g. a rejected transaction.
class ElectrumError extends Error {
  constructor({ code, message }) {
    super(message);
    this.name = "ElectrumError";
    this.code = code;
  }
}

class ElectrumClient {
  constructor({
    servers = SERVERS,
    WebSocketImpl = globalThis.WebSocket,
    clientName = "Dingocoin Wallet",
    connectTimeoutMs = 8000,
    requestTimeoutMs = 20000,
    startIndex = Math.floor(Math.random() * servers.length),
  } = {}) {
    this.servers = servers;
    this.WebSocketImpl = WebSocketImpl;
    this.clientName = clientName;
    this.connectTimeoutMs = connectTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.index = startIndex % servers.length;
    this.connection = null; // promise of the current connection
    this.active = null; // the established connection, once ready
  }

  // Sends a request, connecting (or reconnecting) first if needed.
  async request(method, params = []) {
    const connection = await this.connect();
    return connection.call(method, params);
  }

  connect() {
    if (this.connection === null) {
      this.connection = this.connectToAnyServer().catch((err) => {
        this.connection = null;
        throw err;
      });
    }
    return this.connection;
  }

  close() {
    const connection = this.connection;
    this.connection = null;
    this.active = null;
    if (connection !== null) {
      connection.then((c) => c.close()).catch(() => {});
    }
  }

  async connectToAnyServer() {
    const errors = [];
    for (let attempt = 0; attempt < this.servers.length; attempt++) {
      const index = (this.index + attempt) % this.servers.length;
      try {
        const connection = await this.open(this.servers[index]);
        this.index = index;
        this.active = connection;
        return connection;
      } catch (err) {
        errors.push(`${this.servers[index]}: ${err.message}`);
      }
    }
    throw new Error(
      `Could not connect to the Dingocoin network (${errors.join("; ")})`
    );
  }

  open(url) {
    return new Promise((resolve, reject) => {
      const ws = new this.WebSocketImpl(url);
      const pending = new Map();
      let nextId = 0;
      let ready = false;

      const call = (method, params) =>
        new Promise((res, rej) => {
          if (ws.readyState !== 1) {
            rej(new Error(`Connection to ${url} is closed`));
            return;
          }
          const id = ++nextId;
          const timer = setTimeout(() => {
            pending.delete(id);
            rej(new Error(`${method} timed out`));
          }, this.requestTimeoutMs);
          pending.set(id, { res, rej, timer });
          ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        });
      const connection = { url, call, close: () => ws.close() };

      const connectTimer = setTimeout(() => {
        reject(new Error("connection timed out"));
        ws.close();
      }, this.connectTimeoutMs);

      ws.onmessage = (event) => {
        // ElectrumX sends one JSON message per frame; tolerate newline-delimited batches.
        for (const line of String(event.data).split("\n")) {
          if (line.trim() === "") {
            continue;
          }
          const message = parseJson(line);
          const request = pending.get(message.id);
          if (request === undefined) {
            continue; // subscription notification
          }
          pending.delete(message.id);
          clearTimeout(request.timer);
          if (message.error) {
            request.rej(new ElectrumError(message.error));
          } else {
            request.res(message.result);
          }
        }
      };

      ws.onclose = () => {
        clearTimeout(connectTimer);
        const err = new Error(`Connection to ${url} closed`);
        for (const request of pending.values()) {
          clearTimeout(request.timer);
          request.rej(err);
        }
        pending.clear();
        if (!ready) {
          reject(err);
        } else if (this.active === connection) {
          // Reconnect on the next request, starting with the next server.
          this.active = null;
          this.connection = null;
          this.index = (this.index + 1) % this.servers.length;
        }
      };

      ws.onopen = async () => {
        try {
          await call("server.version", [this.clientName, PROTOCOL_VERSION]);
          const features = await call("server.features", []);
          if (features.genesis_hash !== DINGOCOIN_GENESIS_HASH) {
            throw new Error("server is not on the Dingocoin network");
          }
          clearTimeout(connectTimer);
          ready = true;
          resolve(connection);
        } catch (err) {
          clearTimeout(connectTimer);
          reject(err);
          ws.close();
        }
      };
    });
  }
}

module.exports = {
  SERVERS,
  DINGOCOIN_GENESIS_HASH,
  parseJson,
  ElectrumError,
  ElectrumClient,
};
