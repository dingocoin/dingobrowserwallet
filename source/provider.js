// Wallet data and broadcasting through Dingocoin Electrum servers.
const dingocoin = require("./dingocoin");
const { ElectrumClient, ElectrumError } = require("./electrum");

const createProvider = (getClient) => {
  const request = (method, params) => getClient().request(method, params);

  // Spendable outputs: confirmed and unconfirmed, excluding outputs already spent
  // by unconfirmed transactions. Amounts are satoshi strings.
  const getUtxos = async (address) => {
    const utxos = await request("blockchain.scripthash.listunspent", [
      dingocoin.electrumScriptHash(address),
    ]);
    return utxos.map((utxo) => ({
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      amount: BigInt(utxo.value).toString(),
      height: utxo.height,
    }));
  };

  // Outputs that can be spent in the next block: getUtxos without coinbase
  // outputs younger than COINBASE_MATURITY blocks, which the network rejects
  // ("premature spend of coinbase"). Only recent outputs are checked: an output
  // is a coinbase if it is the first transaction of its block.
  const getSpendableUtxos = async (address) => {
    const [utxos, tip] = await Promise.all([
      getUtxos(address),
      request("blockchain.headers.subscribe", []),
    ]);
    const spendHeight = tip.height + 1;
    const recentHeights = new Set(
      utxos
        .filter(
          (utxo) =>
            utxo.height > 0 &&
            spendHeight - utxo.height < dingocoin.COINBASE_MATURITY
        )
        .map((utxo) => utxo.height)
    );
    const coinbaseTxids = new Set(
      await Promise.all(
        [...recentHeights].map((height) =>
          request("blockchain.transaction.id_from_pos", [height, 0])
        )
      )
    );
    return utxos.filter((utxo) => !coinbaseTxids.has(utxo.txid));
  };

  // confirmed: balance in blocks. unconfirmed: net change from mempool
  // transactions (negative while an outgoing transaction is pending).
  const getBalance = async (address) => {
    const balance = await request("blockchain.scripthash.get_balance", [
      dingocoin.electrumScriptHash(address),
    ]);
    return {
      confirmed: BigInt(balance.confirmed).toString(),
      unconfirmed: BigInt(balance.unconfirmed).toString(),
    };
  };

  // Resolves to { txid }, or { code, message } if the network rejects the
  // transaction. Rejects if no server can be reached.
  const sendRawTransaction = async (hex) => {
    try {
      return {
        txid: await request("blockchain.transaction.broadcast", [hex]),
      };
    } catch (err) {
      if (err instanceof ElectrumError) {
        return { code: err.code, message: err.message };
      }
      throw err;
    }
  };

  return { getUtxos, getSpendableUtxos, getBalance, sendRawTransaction };
};

let client = null;

module.exports = {
  createProvider,
  ...createProvider(() => {
    if (client === null) {
      client = new ElectrumClient();
    }
    return client;
  }),
};
