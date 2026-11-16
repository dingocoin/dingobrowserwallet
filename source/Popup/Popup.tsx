import * as React from "react";
import browser from "webextension-polyfill";
import {
  Navbar,
  Container,
  Button,
  Offcanvas,
  Modal,
  Form,
  Row,
  Col,
  Dropdown,
  OverlayTrigger,
  Tooltip,
  Alert,
} from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBars,
  faPlus,
  faLevelDownAlt,
  faEdit,
  faEllipsisV,
  faExternalLinkAlt,
  faTrashAlt,
  faAngleRight,
  faPaperPlane,
  faKey,
  faUndoAlt,
  faExpandAlt,
  faCompressArrowsAlt,
  faBroom,
} from "@fortawesome/free-solid-svg-icons";
import dingocoin from "../dingocoin";
import keyring from "../accounts";
import provider from "../provider";
import sweep from "../sweep";
import { ElectrumError } from "../electrum";
import {
  BackupInstructions,
  PhraseGrid,
} from "../components/RecoveryPhrase";
import {
  accountKindLabel,
  groupAccounts,
  passwordPlaceholder,
} from "../components/accountKind";

import "./styles.scss";
import DingocoinLogo from "../assets/img/dingocoin.png";

const satoshiToLocaleString = (x: any) => {
  const isNegative = BigInt(x) < 0n;
  if (isNegative) {
    x = -x;
  }
  const integer = (BigInt(x) / 100000000n).toString();
  const decimal = (BigInt(x) % 100000000n).toString().padStart(8, "0");
  return (
    (isNegative ? "-" : "") +
    `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimal}`
  );
};

// The same page runs in the toolbar popup and, via "Open in a tab", as popup.html?view=full.
const FULL_PAGE = new URLSearchParams(window.location.search).get("view") === "full";
// popup.html?view=full&sweep=electrum opens the Electrum sweep once the account loads.
const SWEEP_ON_LOAD =
  FULL_PAGE && new URLSearchParams(window.location.search).get("sweep") === "electrum";

const Popup: React.FC = () => {
  const [accounts, setAccounts] = React.useState(null);
  const [activeAccount, setActiveAccount] = React.useState(null);
  const [activeBalance, setActiveBalance] = React.useState(null);
  const [activeTransit, setActiveTransit] = React.useState(null);
  const [menuShow, setMenuShow] = React.useState(false);
  // Encrypted recovery phrase, or null if the wallet has none yet.
  const [wallet, setWallet] = React.useState(null);

  // Recovery phrase setup runs in a full tab: the popup closes when it loses focus.
  const openSetup = async (mode: "create" | "restore") => {
    const url = browser.runtime.getURL(`setup.html?mode=${mode}`);
    if (FULL_PAGE) {
      window.location.assign(url);
      return;
    }
    await browser.tabs.create({ url });
    window.close();
  };

  const openFullPage = async () => {
    await browser.tabs.create({
      url: browser.runtime.getURL("popup.html?view=full"),
    });
    window.close();
  };

  const [createAccountShow, setCreateAccountShow] = React.useState(false);
  const createAccountPasswordRef = React.useRef(null);
  const [createAccountLabel, setCreateAccountLabel] = React.useState("");
  const [createAccountPassword, setCreateAccountPassword] = React.useState("");
  const [createAccountPasswordError, setCreateAccountPasswordError] =
    React.useState(null);
  const [createAccountBusy, setCreateAccountBusy] = React.useState(false);
  React.useEffect(() => {
    if (createAccountShow === true) {
      setCreateAccountLabel("");
      setCreateAccountPassword("");
      setCreateAccountPasswordError(null);
    }
  }, [createAccountShow]);
  const createAccountClicked = () => {
    setMenuShow(false);
    if (wallet === null) {
      openSetup("create");
    } else {
      setCreateAccountShow(true);
    }
  };
  const doCreate = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();

    setCreateAccountBusy(true);
    const account = await keyring.createHdAccount(
      wallet,
      createAccountPassword,
      accounts,
      createAccountLabel
    );
    setCreateAccountBusy(false);
    if (account === null) {
      setCreateAccountPasswordError("Incorrect password.");
      createAccountPasswordRef.current?.focus();
      return;
    }

    const updated = [...accounts, account];
    await browser.storage.sync.set({ accounts: updated });
    setAccounts(updated);
    setCreateAccountShow(false);
    await switchAccount(account);
  };

  const revealPasswordRef = React.useRef(null);
  const [revealShow, setRevealShow] = React.useState(false);
  const [revealPassword, setRevealPassword] = React.useState("");
  const [revealPasswordError, setRevealPasswordError] = React.useState(null);
  const [revealBusy, setRevealBusy] = React.useState(false);
  const [revealWords, setRevealWords] = React.useState(null);
  // Clear the phrase from memory whenever the dialog opens or closes.
  const setRevealOpen = (open: boolean) => {
    setRevealPassword("");
    setRevealPasswordError(null);
    setRevealWords(null);
    setRevealShow(open);
  };
  const doReveal = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();

    setRevealBusy(true);
    const mnemonic = await keyring.revealMnemonic(wallet, revealPassword);
    setRevealBusy(false);
    if (mnemonic === null) {
      setRevealPasswordError("Incorrect password.");
      revealPasswordRef.current?.focus();
    } else {
      setRevealPassword("");
      setRevealWords(mnemonic.split(" "));
    }
  };

  const [importAccountShow, setImportAccountShow] = React.useState(false);
  const importAccountWifRef = React.createRef();
  const [importAccountLabel, setImportAccountLabel] = React.useState("");
  const [importAccountWif, setImportAccountWif] = React.useState("");
  const [importAccountWifError, setImportAccountWifError] =
    React.useState(null);
  React.useEffect(() => {
    if (importAccountWif.length === 0) {
      setImportAccountWifError("Private key cannot be empty.");
    } else if (!dingocoin.isWif(importAccountWif)) {
      setImportAccountWifError("Invalid private key.");
    } else if (
      accounts.some(
        (x: any) =>
          x.address === dingocoin.toAddress(dingocoin.fromWif(importAccountWif))
      )
    ) {
      setImportAccountWifError("Private key already exists.");
    } else {
      setImportAccountWifError(null);
    }
  }, [importAccountWif]);
  const [importAccountPassword, setImportAccountPassword] = React.useState("");
  const [importAccountConfirmPassword, setImportAccountConfirmPassword] =
    React.useState("");
  const [importAccountPasswordError, setImportAccountPasswordError] =
    React.useState(null);
  React.useEffect(() => {
    if (importAccountPassword.length < 8) {
      setImportAccountPasswordError("Password too short.");
    } else if (importAccountPassword !== importAccountConfirmPassword) {
      setImportAccountPasswordError("Password inputs do not match.");
    } else {
      setImportAccountPasswordError(null);
    }
  }, [importAccountPassword, importAccountConfirmPassword]);
  React.useEffect(() => {
    if (importAccountShow === true) {
      setImportAccountLabel("");
      setImportAccountWif("");
      setImportAccountPassword("");
      setImportAccountConfirmPassword("");
    }
  }, [importAccountShow]);
  const [importAccountBusy, setImportAccountBusy] = React.useState(false);
  const doImport = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();

    setImportAccountBusy(true);
    const account = await keyring.createKeyAccount(
      dingocoin.fromWif(importAccountWif),
      importAccountPassword,
      importAccountLabel
    );
    setImportAccountBusy(false);

    const updated = [...accounts, account];
    await browser.storage.sync.set({ accounts: updated });
    setAccounts(updated);
    setImportAccountShow(false);

    if (activeAccount === null) {
      await switchAccount(account);
    }
  };

  const [addressTooltipText, setAddressTooltipText] =
    React.useState("Copy address");
  const addressClicked = async () => {
    navigator.clipboard.writeText(activeAccount.address);
    setAddressTooltipText("Copied!");
    setTimeout(() => setAddressTooltipText("Copy address"), 1000);
  };

  const renameInputRef = React.createRef();
  const [renameText, setRenameText] = React.useState("");
  const [renameShow, setRenameShow] = React.useState(false);
  React.useEffect(() => {
    if (activeAccount !== null) {
      setRenameText(activeAccount.label);
    }
  }, [renameShow]);
  const doRename = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    activeAccount.label = renameText;
    await browser.storage.sync.set({ accounts: accounts });
    setAccounts(accounts);
    setActiveAccount(activeAccount);
    setRenameShow(false);
  };

  const exportPasswordRef = React.useRef(null);
  const [exportShow, setExportShow] = React.useState(false);
  const [exportPassword, setExportPassword] = React.useState("");
  const [exportPasswordError, setExportPasswordError] = React.useState(null);
  const [exportWif, setExportWif] = React.useState(null);
  React.useEffect(() => {
    if (exportShow === true) {
      setExportPassword("");
      setExportWif(null);
    }
  }, [exportShow]);
  const doExport = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    const privKey = await keyring.unlockAccount(
      activeAccount,
      exportPassword,
      wallet
    );
    if (privKey === null) {
      setExportPasswordError("Incorrect password.");
      exportPasswordRef.current?.focus();
    } else {
      setExportPasswordError(null);
      setExportWif(dingocoin.toWif(privKey));
    }
  };

  const [deleteShow, setDeleteShow] = React.useState(false);
  const doDelete = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    const index = accounts.indexOf(activeAccount);
    if (index > -1) {
      accounts.splice(index, 1);
      await browser.storage.sync.set({ accounts: accounts });
      await browser.storage.sync.remove("activeAccount");
      setAccounts(accounts);
      setActiveAccount(null);
    }
    setDeleteShow(false);
  };

  const signInputRef = React.createRef();
  const [signShow, setSignShow] = React.useState(false);
  const [signAddress, setSignAddress] = React.useState("");
  const [signAddressError, setSignAddressError] = React.useState(null);
  React.useEffect(() => {
    if (signAddress.length === 0) {
      setSignAddressError("Recipient cannot be empty.");
    } else if (!dingocoin.isAddress(signAddress)) {
      setSignAddressError("Invalid Dingocoin address.");
    } else {
      setSignAddressError(null);
    }
  }, [signAddress]);
  const [signAmount, setSignAmount] = React.useState("");
  const [signAmountError, setSignAmountError] = React.useState(null);
  React.useEffect(() => {
    if (signAmount === "") {
      setSignAmountError("Amount cannot be empty.");
    } else if (
      BigInt(dingocoin.toSatoshi(signAmount.toString())) <
      dingocoin.DUST_THRESHOLD
    ) {
      setSignAmountError(
        "Min amount = " +
          satoshiToLocaleString(dingocoin.DUST_THRESHOLD.toString())
      );
    } else if (
      BigInt(dingocoin.toSatoshi(signAmount.toString())) >
      dingocoin.UTXO_MAX_AMOUNT
    ) {
      setSignAmountError(
        "Max amount = " +
          satoshiToLocaleString(dingocoin.UTXO_MAX_AMOUNT.toString())
      );
    } else {
      setSignAmountError(null);
    }
  }, [signAmount]);
  const [signData, setSignData] = React.useState("");
  const [signDataError, setSignDataError] = React.useState(null);
  React.useEffect(() => {
    if (signData === "") {
      setSignDataError(null);
    } else if (Buffer.from(signData, "utf8").length > 80) {
      setSignDataError("Max length = 80 bytes");
    } else {
      setSignDataError(false);
    }
  }, [signData]);
  const [signPassword, setSignPassword] = React.useState("");
  const [signPasswordError, setSignPasswordError] = React.useState(null);
  React.useEffect(() => {
    if (signPassword.length === 0) {
      setSignPasswordError("Password required.");
    } else {
      setSignPasswordError(null);
    }
  }, [signPassword]);
  const [signFee, setSignFee] = React.useState(null);
  const [signRemaining, setSignRemaining] = React.useState(null);
  const [signSendResult, setSignSendResult] = React.useState(null);
  const [signTx, setSignTx] = React.useState(null);
  React.useEffect(() => {
    if (signShow === true) {
      setSignAddress("");
      setSignAmount("");
      setSignData("");
      setSignPassword("");
      setSignFee(null);
      setSignRemaining(null);
      setSignTx(null);
      setSignSendResult(null);
    }
  }, [signShow]);
  const doSign = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();

    const privKey = await keyring.unlockAccount(
      activeAccount,
      signPassword,
      wallet
    );
    if (privKey === null) {
      setSignPasswordError("Incorrect password.");
      return;
    }

    // Fetch the latest spendable UTXOs.
    let utxos;
    try {
      utxos = await provider.getSpendableUtxos(activeAccount.address);
    } catch {
      setSignAmountError("Could not reach the Dingocoin network. Try again.");
      return;
    }
    const spendable = utxos.map((x: any) => {
      return { txid: x.txid, vout: x.vout, amount: BigInt(x.amount) };
    });
    const vouts = [
      {
        address: signAddress,
        amount: BigInt(dingocoin.toSatoshi(signAmount)),
      },
    ];
    const data = signData.length === 0 ? null : Buffer.from(signData, "utf8");

    let selection;
    try {
      selection = dingocoin.selectCoins({ utxos: spendable, outputs: vouts, data });
    } catch (err: any) {
      if (err.reason === "too-large") {
        setSignAmountError(
          `Too many coins for one transaction. Max = ${satoshiToLocaleString(err.maxAmount)}`
        );
      } else if (err instanceof dingocoin.CoinSelectionError) {
        setSignAmountError(err.message);
      } else {
        throw err;
      }
      return;
    }

    const signedTx = dingocoin.createSignedRawTransaction(
      selection.inputs,
      vouts,
      data,
      selection.fee,
      activeAccount.address,
      privKey
    );
    const total = spendable.reduce((sum: bigint, x: any) => sum + x.amount, 0n);
    setSignFee(selection.fee);
    setSignRemaining(total - signedTx.outputAmount - selection.fee);
    setSignTx(signedTx);
  };
  // Consolidation: merge the smallest coins into one, in a send to this address.
  const consolidatePasswordRef = React.useRef(null);
  const [consolidateShow, setConsolidateShow] = React.useState(false);
  const [consolidatePlan, setConsolidatePlan] = React.useState(null);
  const [consolidateError, setConsolidateError] = React.useState(null);
  const [consolidatePassword, setConsolidatePassword] = React.useState("");
  const [consolidatePasswordError, setConsolidatePasswordError] =
    React.useState(null);
  const [consolidateBusy, setConsolidateBusy] = React.useState(false);
  const [consolidateResult, setConsolidateResult] = React.useState(null);
  const openConsolidate = async () => {
    setSignShow(false);
    setConsolidatePlan(null);
    setConsolidateError(null);
    setConsolidatePassword("");
    setConsolidatePasswordError(null);
    setConsolidateResult(null);
    setConsolidateShow(true);
    try {
      const utxos = await provider.getSpendableUtxos(activeAccount.address);
      setConsolidatePlan(
        dingocoin.selectConsolidation({
          utxos: utxos.map((x: any) => ({
            txid: x.txid,
            vout: x.vout,
            amount: BigInt(x.amount),
            height: x.height,
          })),
        })
      );
    } catch (err: any) {
      setConsolidateError(
        err instanceof dingocoin.CoinSelectionError
          ? err.message
          : "Could not reach the Dingocoin network. Try again."
      );
    }
  };
  const doConsolidate = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();

    setConsolidateBusy(true);
    try {
      const privKey = await keyring.unlockAccount(
        activeAccount,
        consolidatePassword,
        wallet
      );
      if (privKey === null) {
        setConsolidatePasswordError("Incorrect password.");
        consolidatePasswordRef.current?.focus();
        return;
      }
      const signedTx = dingocoin.createSignedRawTransaction(
        consolidatePlan.inputs,
        [{ address: activeAccount.address, amount: consolidatePlan.amount }],
        null,
        consolidatePlan.fee,
        activeAccount.address,
        privKey
      );
      try {
        setConsolidateResult(await provider.sendRawTransaction(signedTx.tx));
      } catch (err: any) {
        setConsolidateResult({ code: "network", message: err.message });
      }
      await refresh();
    } finally {
      setConsolidateBusy(false);
    }
  };

  // Electrum sweep: send every coin of an Electrum wallet (Electrum's own seed
  // format, not BIP39) to this address. The seed and its keys stay in memory
  // only until the dialog closes.
  const sweepPhraseRef = React.useRef(null);
  const sweepOpenedOnLoadRef = React.useRef(false);
  // Bumped when the dialog closes, so a scan still running for the old dialog
  // can't put its keys or results into the next one.
  const sweepSessionRef = React.useRef(0);
  // Coins already swept in this dialog. The server may not have seen that
  // transaction yet when "Sweep again" scans, and would list them again.
  const sweepSpentRef = React.useRef(new Set<string>());
  const [sweepShow, setSweepShow] = React.useState(false);
  const [sweepPhrase, setSweepPhrase] = React.useState("");
  const [sweepPassphrase, setSweepPassphrase] = React.useState("");
  const [sweepPhraseError, setSweepPhraseError] = React.useState(null);
  const [sweepScanning, setSweepScanning] = React.useState(false);
  const [sweepFound, setSweepFound] = React.useState(null); // { usedAddresses, coins }
  const [sweepPlan, setSweepPlan] = React.useState(null);
  const [sweepError, setSweepError] = React.useState(null);
  const [sweepBusy, setSweepBusy] = React.useState(false);
  const [sweepResult, setSweepResult] = React.useState(null);
  const resetSweepScan = () => {
    setSweepFound(null);
    setSweepPlan(null);
    setSweepError(null);
    setSweepResult(null);
  };
  const closeSweep = () => {
    if (sweepBusy) {
      return; // a broadcast is in flight; its result must be shown
    }
    sweepSessionRef.current++;
    sweepSpentRef.current = new Set();
    setSweepShow(false);
    setSweepPhrase("");
    setSweepPassphrase("");
    setSweepPhraseError(null);
    setSweepScanning(false);
    resetSweepScan();
  };
  const openSweep = async () => {
    // Pasting a seed means switching windows, which closes the toolbar popup.
    if (!FULL_PAGE) {
      await browser.tabs.create({
        url: browser.runtime.getURL("popup.html?view=full&sweep=electrum"),
      });
      window.close();
      return;
    }
    setSignShow(false);
    closeSweep();
    setSweepShow(true);
  };
  React.useEffect(() => {
    if (SWEEP_ON_LOAD && activeAccount !== null && !sweepOpenedOnLoadRef.current) {
      sweepOpenedOnLoadRef.current = true;
      window.history.replaceState(null, "", "popup.html?view=full");
      openSweep();
    }
  }, [activeAccount]);

  // Why a phrase can't be swept, or null if it is a standard Electrum seed.
  const sweepPhraseProblem = (phrase: string) => {
    switch (dingocoin.electrumSeedType(phrase)) {
      case "standard":
        return null;
      case "segwit":
        return "This is an Electrum SegWit seed. Only standard Electrum seeds can be swept.";
      case "2fa":
      case "2fa_segwit":
        return "This is an Electrum two-factor seed. Only standard Electrum seeds can be swept.";
      default:
        return dingocoin.mnemonicError(phrase) === null
          ? "This is a BIP39 seed phrase, not an Electrum seed. To use it here, restore it from the wallet menu."
          : "This is not an Electrum seed. Check the spelling and order of the words.";
    }
  };

  const findSweepCoins = async (e?: any) => {
    e?.preventDefault();
    e?.stopPropagation();

    const problem = sweepPhraseProblem(sweepPhrase);
    if (problem !== null) {
      setSweepPhraseError(problem);
      sweepPhraseRef.current?.focus();
      return;
    }
    const session = sweepSessionRef.current;
    resetSweepScan();
    setSweepScanning(true);
    let found;
    let plan = null;
    let error = null;
    try {
      found = await sweep.findElectrumCoins({
        rootKey: dingocoin.electrumRootKey(sweepPhrase, sweepPassphrase),
        provider,
      });
      found.coins = found.coins.filter(
        (coin: any) => !sweepSpentRef.current.has(`${coin.txid}:${coin.vout}`)
      );
      if (found.usedAddresses > 0) {
        try {
          plan = dingocoin.selectSweep({ utxos: found.coins });
        } catch (err: any) {
          if (!(err instanceof dingocoin.CoinSelectionError)) {
            throw err;
          }
          error = err.message;
        }
      }
    } catch (err: any) {
      found = null;
      if (err instanceof ElectrumError) {
        // E.g. an address with more coins than the server will list at once.
        error = `The Dingocoin server refused the request: ${err.message}`;
      } else if (err.message.startsWith("This wallet has too many")) {
        error = err.message;
      } else if (/Could not connect|timed out|closed/.test(err.message)) {
        error = "Could not reach the Dingocoin network. Try again.";
      } else {
        error = `Could not finish looking for coins: ${err.message}`;
      }
    }
    if (session !== sweepSessionRef.current) {
      return; // the dialog was closed meanwhile
    }
    setSweepFound(found);
    setSweepPlan(plan);
    setSweepError(error);
    setSweepScanning(false);
  };

  const doSweep = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();

    setSweepBusy(true);
    try {
      // This tab may have been open a while: make sure the destination is
      // still the active account and hasn't been deleted in another window.
      const stored = await browser.storage.sync.get(["activeAccount", "accounts"]);
      const stillActive =
        stored.activeAccount?.address === activeAccount.address &&
        (stored.accounts || []).some((x: any) => x.address === activeAccount.address);
      if (!stillActive) {
        setSweepResult({
          code: "account",
          message:
            "The active account changed in another window. Reload this tab and sweep again.",
        });
        return;
      }
      let signedTx;
      try {
        signedTx = dingocoin.createSignedSweepTransaction(
          sweepPlan.inputs,
          activeAccount.address,
          sweepPlan.fee
        );
      } catch (err: any) {
        setSweepResult({ code: "signing", message: err.message });
        return;
      }
      try {
        const result = await provider.sendRawTransaction(signedTx.tx);
        if (typeof result.txid !== "undefined") {
          for (const input of sweepPlan.inputs) {
            sweepSpentRef.current.add(`${input.txid}:${input.vout}`);
          }
        }
        setSweepResult(result);
      } catch (err: any) {
        setSweepResult({ code: "network", message: err.message });
      }
      await refresh();
    } finally {
      setSweepBusy(false);
    }
  };

  const doSend = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      setSignSendResult(await provider.sendRawTransaction(signTx.tx));
    } catch (err: any) {
      setSignSendResult({ code: "network", message: err.message });
    }
    await refresh();
  };

  React.useEffect(() => {
    if (accounts === null) {
      (async () => {
        const result = await browser.storage.sync.get(["accounts", "wallet"]);
        if ("wallet" in result) {
          setWallet(result.wallet);
        }
        if ("accounts" in result) {
          setAccounts(result.accounts);
          const active = await browser.storage.sync.get("activeAccount");
          if ("activeAccount" in active) {
            // Retrieve correct reference.
            const matching = result.accounts.find(
              (x: any) => x.address === active.activeAccount.address
            );
            if (typeof matching !== "undefined") {
              await switchAccount(matching);
            } else {
              await browser.storage.sync.remove("activeAccount");
            }
          }
        } else {
          setAccounts([]);
        }
      })();
    }
  }, [accounts]);

  const switchAccount = async (x: any) => {
    await browser.storage.sync.set({ activeAccount: x });
    setActiveBalance(null);
    setActiveTransit(null);
    setActiveAccount(x);
  };

  const refresh = async () => {
    if (activeAccount !== null) {
      try {
        const balance = await provider.getBalance(activeAccount.address);
        setActiveBalance(balance.confirmed);
        setActiveTransit(balance.unconfirmed);
      } catch {
        setActiveBalance(null);
        setActiveTransit(null);
      }
    } else {
      setActiveBalance(null);
      setActiveTransit(null);
    }
  };

  const [refreshLoop, setRefreshLoop] = React.useState(null);
  React.useEffect(() => {
    refresh();
    if (refreshLoop !== null) {
      clearInterval(refreshLoop);
    }
    setRefreshLoop(setInterval(refresh, 3000));
  }, [activeAccount]);

  return (
    <div id="popup" className={FULL_PAGE ? "full-page" : undefined}>
      <Navbar className="navbar" bg="dark" expand="lg" sticky="top">
        <Container fluid>
          <Navbar.Brand href="#home" className="navbar-brand">
            <img alt="" src={DingocoinLogo} />
          </Navbar.Brand>
          <span>DINGOCOIN</span>
          <div className="navbar-actions">
            {!FULL_PAGE && (
              <Button
                onClick={openFullPage}
                title="Open in a tab"
                aria-label="Open in a tab"
              >
                <FontAwesomeIcon className="icon" icon={faExpandAlt} />
              </Button>
            )}
            <Button onClick={() => setMenuShow(true)} aria-label="Menu">
              <FontAwesomeIcon className="icon" icon={faBars} />
            </Button>
          </div>
        </Container>
      </Navbar>

      {activeAccount === null && accounts !== null && accounts.length === 0 && (
        <div className="welcome">
          <Container className="text-center">
            <h3>Welcome</h3>
            <p>Set up your Dingocoin wallet.</p>
            <Button onClick={() => openSetup("create")}>Create new wallet</Button>
            <Button variant="outline-primary" onClick={() => openSetup("restore")}>
              Restore from seed phrase
            </Button>
            <Button variant="link" onClick={() => setImportAccountShow(true)}>
              Import a private key
            </Button>
          </Container>
        </div>
      )}

      {activeAccount === null && accounts !== null && accounts.length > 0 && (
        <div className="starter vertical-center">
          <Container className="text-center">
            <Row>
              <h3>No active account</h3>
              <p>Select or create one in the menu.</p>
            </Row>
          </Container>
        </div>
      )}

      {activeAccount !== null && (
        <Container className="content">
          <Row className="justify-content-center align-items-center mt-4">
            <Col xs={2}></Col>
            <Col xs={8}>
              {activeAccount.label !== "" && (
                <div className="label-text">{activeAccount.label}</div>
              )}
              <OverlayTrigger
                placement="bottom"
                overlay={<Tooltip>{addressTooltipText}</Tooltip>}
              >
                <div className="address-text" onClick={addressClicked}>
                  <b>{activeAccount.address}</b>
                </div>
              </OverlayTrigger>
              <div className="account-kind">
                {accountKindLabel(activeAccount)}
              </div>
            </Col>
            <Col xs={2}>
              <Dropdown className="account-options">
                <Dropdown.Toggle variant="light">
                  <FontAwesomeIcon className="icon" icon={faEllipsisV} />
                </Dropdown.Toggle>
                <Dropdown.Menu>
                  <Dropdown.Item onClick={() => setRenameShow(true)}>
                    <FontAwesomeIcon className="icon" icon={faEdit} />
                    Relabel
                  </Dropdown.Item>
                  <Dropdown.Item onClick={() => setExportShow(true)}>
                    <FontAwesomeIcon
                      className="icon"
                      icon={faExternalLinkAlt}
                    />
                    Export
                  </Dropdown.Item>
                  <Dropdown.Item onClick={openConsolidate}>
                    <FontAwesomeIcon
                      className="icon"
                      icon={faCompressArrowsAlt}
                    />
                    Consolidate coins
                  </Dropdown.Item>
                  <Dropdown.Item onClick={openSweep}>
                    <FontAwesomeIcon className="icon" icon={faBroom} />
                    Sweep Electrum wallet
                  </Dropdown.Item>
                  <Dropdown.Item
                    style={{ color: "red" }}
                    onClick={() => setDeleteShow(true)}
                  >
                    <FontAwesomeIcon className="icon" icon={faTrashAlt} />
                    Delete
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            </Col>
          </Row>
          <hr />
          <Row className="justify-content-center">
            <div className="balance mt-2">
              <span>Balance</span>
              <br />
              <span>
                <b>
                  {activeBalance === null
                    ? "-"
                    : satoshiToLocaleString(activeBalance)}
                </b>
              </span>
            </div>
            <div className="balance mt-2">
              <span>Pending</span>
              <br />
              <span>
                <b>
                  {activeTransit === null
                    ? "-"
                    : (BigInt(activeTransit) > 0n ? "+" : "") +
                      satoshiToLocaleString(activeTransit)}
                </b>
              </span>
            </div>
          </Row>
          <Row xs={2} md={2} lg={2} className="actions">
            <Col>
              <Button className="mt-4" onClick={() => setSignShow(true)}>
                Send
                <FontAwesomeIcon className="icon" icon={faPaperPlane} />
              </Button>
            </Col>
            <Col>
              <a
                href={`https://explorer.dingocoin.com/address/${activeAccount.address}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button className="mt-4">
                  Logs
                  <FontAwesomeIcon className="icon" icon={faExternalLinkAlt} />
                </Button>
              </a>
            </Col>
          </Row>
        </Container>
      )}

      <Offcanvas
        className="menu"
        show={menuShow}
        onHide={() => setMenuShow(false)}
        placement="end"
      >
        <Offcanvas.Body>
          {accounts !== null &&
            groupAccounts(accounts).map((group) => (
              <React.Fragment key={group.title}>
                <div className="menu-heading">{group.title}</div>
                {group.accounts.map((x: any) => {
                  const name =
                    x.label === "" ? x.address : `${x.label} (${x.address})`;
                  return (
                    <Button
                      className="menu-item account"
                      onClick={() => switchAccount(x)}
                      key={x.address}
                    >
                      {x !== activeAccount && <span>{name}</span>}
                      {x === activeAccount && (
                        <span>
                          <FontAwesomeIcon className="icon" icon={faAngleRight} />
                          <b>{name}</b>
                        </span>
                      )}
                    </Button>
                  );
                })}
              </React.Fragment>
            ))}
          <hr />
          <Button className="menu-item" onClick={createAccountClicked}>
            <FontAwesomeIcon className="icon" icon={faPlus} />
            <span>
              {wallet === null ? "Create seed phrase" : "Create account"}
            </span>
          </Button>
          <Button
            className="menu-item"
            onClick={() => {
              setMenuShow(false);
              setImportAccountShow(true);
            }}
          >
            <FontAwesomeIcon className="icon" icon={faLevelDownAlt} />
            <span>Import private key</span>
          </Button>
          {wallet !== null && (
            <Button
              className="menu-item"
              onClick={() => {
                setMenuShow(false);
                setRevealOpen(true);
              }}
            >
              <FontAwesomeIcon className="icon" icon={faKey} />
              <span>Show seed phrase</span>
            </Button>
          )}
          {wallet === null && (
            <Button className="menu-item" onClick={() => openSetup("restore")}>
              <FontAwesomeIcon className="icon" icon={faUndoAlt} />
              <span>Restore from seed phrase</span>
            </Button>
          )}
        </Offcanvas.Body>
      </Offcanvas>

      <Modal
        size="lg"
        aria-labelledby="contained-modal-title-vcenter"
        centered
        show={createAccountShow}
        onHide={() => setCreateAccountShow(false)}
        onEntered={() => createAccountPasswordRef.current?.focus()}
      >
        <Modal.Header closeButton>
          <Modal.Title id="contained-modal-title-vcenter">
            Create account
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={doCreate} noValidate>
            <p className="modal-note">
              The new account is the next address from your seed phrase.
              Unlock it with the wallet password you chose when you set up the
              seed phrase.
            </p>
            <Form.Group className="mb-3">
              <Form.Control
                placeholder="Label (optional)"
                value={createAccountLabel}
                onChange={(e) => setCreateAccountLabel(e.target.value)}
              />
              <Form.Control
                type="password"
                placeholder="Wallet password"
                className="mt-2"
                value={createAccountPassword}
                onChange={(e) => {
                  setCreateAccountPassword(e.target.value);
                  setCreateAccountPasswordError(null);
                }}
                ref={createAccountPasswordRef}
                isInvalid={createAccountPasswordError !== null}
              />
              {createAccountPasswordError && (
                <Form.Label className="input-error">
                  {createAccountPasswordError}
                </Form.Label>
              )}
            </Form.Group>
            <Button
              variant="primary"
              style={{ width: "100%" }}
              disabled={createAccountPassword.length === 0 || createAccountBusy}
              type="submit"
            >
              {createAccountBusy ? "Creating…" : "Create account"}
            </Button>
          </Form>
        </Modal.Body>
      </Modal>

      <Modal
        size="lg"
        aria-labelledby="contained-modal-title-vcenter"
        centered
        show={importAccountShow}
        onHide={() => setImportAccountShow(false)}
        onEntered={() => (importAccountWifRef.current as any).focus()}
      >
        <Modal.Header closeButton>
          <Modal.Title id="contained-modal-title-vcenter">
            Import private key
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={doImport} noValidate>
            <Alert variant="warning" className="modal-note">
              Imported keys are not part of your seed phrase. Keep your own
              backup of this private key.
            </Alert>
            <p className="modal-note">
              The key gets its own password, separate from your wallet
              password.
            </p>
            <Form.Group className="mb-3">
              <Form.Control
                placeholder="Label (optional)"
                value={importAccountLabel}
                onChange={(e) => setImportAccountLabel(e.target.value)}
              />
              <Form.Control
                as="textarea"
                className="mt-2"
                value={importAccountWif}
                onChange={(e) => setImportAccountWif(e.target.value)}
                placeholder="Private key (Wallet Import Format)"
                ref={importAccountWifRef as any}
                rows={3}
                isValid={importAccountWifError === null}
                isInvalid={importAccountWifError !== null}
              />
              {importAccountWifError && (
                <Form.Label className="input-error">
                  {importAccountWifError}
                </Form.Label>
              )}
              <Form.Control
                type="password"
                placeholder="New key password (min. 8 char.)"
                className="mt-2"
                value={importAccountPassword}
                onChange={(e) => setImportAccountPassword(e.target.value)}
                isValid={importAccountPasswordError === null}
                isInvalid={importAccountPasswordError !== null}
              />
              <Form.Control
                type="password"
                placeholder="Confirm new password"
                className="mt-2"
                value={importAccountConfirmPassword}
                onChange={(e) =>
                  setImportAccountConfirmPassword(e.target.value)
                }
                isValid={importAccountPasswordError === null}
                isInvalid={importAccountPasswordError !== null}
              />
              {importAccountPasswordError && (
                <Form.Label className="input-error">
                  {importAccountPasswordError}
                </Form.Label>
              )}
            </Form.Group>
            <Button
              type="submit"
              variant="primary"
              style={{ width: "100%" }}
              disabled={
                importAccountWifError !== null ||
                importAccountPasswordError !== null ||
                importAccountBusy
              }
            >
              {importAccountBusy ? "Importing…" : "Import private key"}
            </Button>
          </Form>
        </Modal.Body>
      </Modal>

      <Modal
        size="lg"
        aria-labelledby="contained-modal-title-vcenter"
        centered
        show={renameShow}
        onHide={() => setRenameShow(false)}
        onEntered={() => (renameInputRef.current as any).focus()}
      >
        <Modal.Header closeButton>
          <Modal.Title id="contained-modal-title-vcenter">
            Relabel account
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={doRename} noValidate>
            <Form.Group className="mb-3">
              <Form.Control
                placeholder="Account label"
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                ref={renameInputRef as any}
              />
            </Form.Group>
            <Button variant="primary" style={{ width: "100%" }} type="submit">
              Save
            </Button>
          </Form>
        </Modal.Body>
      </Modal>

      <Modal
        size="lg"
        aria-labelledby="contained-modal-title-vcenter"
        centered
        show={exportShow}
        onHide={() => setExportShow(false)}
        onEntered={() => exportPasswordRef.current?.focus()}
      >
        <Modal.Header closeButton>
          <Modal.Title id="contained-modal-title-vcenter">
            Export private key
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {exportWif === null && (
            <Form onSubmit={doExport} noValidate>
              <Form.Group className="mb-3">
                <Form.Control
                  type="password"
                  placeholder={passwordPlaceholder(activeAccount)}
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                  ref={exportPasswordRef}
                  isInvalid={exportPasswordError !== null}
                />
                {exportPasswordError && (
                  <Form.Label className="input-error">
                    {exportPasswordError}
                  </Form.Label>
                )}
              </Form.Group>
              <Button variant="primary" style={{ width: "100%" }} type="submit">
                Export
              </Button>
            </Form>
          )}
          {exportWif !== null && (
            <Form>
              <Form.Group className="mb-3">
                <Form.Label>Private key (Wallet Import Format)</Form.Label>
                <Form.Control
                  readOnly
                  as="textarea"
                  value={exportWif}
                  rows={3}
                />
              </Form.Group>
              <Button
                variant="primary"
                style={{ width: "100%" }}
                onClick={() => setExportShow(false)}
              >
                Close
              </Button>
            </Form>
          )}
        </Modal.Body>
      </Modal>

      <Modal
        size="lg"
        aria-labelledby="contained-modal-title-vcenter"
        centered
        show={deleteShow}
        onHide={() => setDeleteShow(false)}
      >
        <Modal.Header closeButton>
          <Modal.Title id="contained-modal-title-vcenter">
            {activeAccount !== null && keyring.isRecoveryPhraseAccount(activeAccount)
              ? "Remove account"
              : "Delete account"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {activeAccount !== null &&
            keyring.isRecoveryPhraseAccount(activeAccount) && (
              <p className="modal-note">
                This removes the account from the list. It comes from your
                seed phrase, so <b>Create account</b> adds it back with the
                same address.
              </p>
            )}
          {activeAccount !== null &&
            !keyring.isRecoveryPhraseAccount(activeAccount) && (
              <Alert variant="danger" className="modal-note">
                This private key is <b>not</b> part of your seed phrase.
                Export it and keep a backup first, or any Dingocoins in this
                account will be lost.
              </Alert>
            )}
          <Form noValidate>
            <Container>
              <Row>
                <Col>
                  <Button
                    variant="danger"
                    style={{ width: "100%" }}
                    onClick={doDelete}
                  >
                    Confirm
                  </Button>
                </Col>
                <Col>
                  <Button
                    variant="primary"
                    style={{ width: "100%" }}
                    onClick={() => setDeleteShow(false)}
                  >
                    Cancel
                  </Button>
                </Col>
              </Row>
            </Container>
          </Form>
        </Modal.Body>
      </Modal>

      <Modal
        size="lg"
        aria-labelledby="contained-modal-title-vcenter"
        centered
        show={signShow}
        onHide={() => setSignShow(false)}
        onEntered={() => (signInputRef.current as any).focus()}
      >
        <Modal.Header closeButton>
          <Modal.Title id="contained-modal-title-vcenter">
            {signTx === null
              ? "Send Dingocoins"
              : signSendResult === null
              ? "Confirm transaction"
              : "Transaction result"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {signTx === null && (
            <Form noValidate onSubmit={doSign}>
              <Form.Group className="mb-3">
                <Form.Control
                  placeholder="Recipient address"
                  value={signAddress}
                  onChange={(e) => setSignAddress(e.target.value)}
                  ref={signInputRef as any}
                  type="text"
                  isValid={signAddressError === null}
                  isInvalid={signAddressError !== null}
                />
                {signAddressError && (
                  <Form.Label className="input-error">
                    {signAddressError}
                  </Form.Label>
                )}
                <Form.Control
                  placeholder="Amount to send"
                  className="mt-2"
                  value={signAmount}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (
                      v.match(/^[0-9]*$/) ||
                      v.match(/^[0-9]+\.?[0-9]{0,8}$/)
                    ) {
                      setSignAmount(e.target.value);
                    } else {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  type="text"
                  isValid={signAmountError === null}
                  isInvalid={signAmountError !== null}
                />
                {signAmountError && (
                  <Form.Label className="input-error">
                    {signAmountError}
                  </Form.Label>
                )}
                {signAmountError?.startsWith("Too many coins") && (
                  <Button
                    variant="outline-primary"
                    size="sm"
                    className="d-block mt-1"
                    onClick={openConsolidate}
                  >
                    Consolidate coins
                  </Button>
                )}
                <Form.Control
                  placeholder="OP_RETURN text (optional)"
                  className="mt-2"
                  value={signData}
                  onChange={(e) => setSignData(e.target.value)}
                  type="text"
                  isValid={signDataError === false}
                  isInvalid={signDataError !== null && signDataError !== false}
                />
                {signDataError && (
                  <Form.Label className="input-error">
                    {signDataError}
                  </Form.Label>
                )}
                <Form.Control
                  placeholder={passwordPlaceholder(activeAccount)}
                  className="mt-2"
                  type="password"
                  value={signPassword}
                  onChange={(e) => setSignPassword(e.target.value)}
                  isInvalid={signPasswordError !== null}
                />
                {signPasswordError && (
                  <Form.Label className="input-error">
                    {signPasswordError}
                  </Form.Label>
                )}
              </Form.Group>
              <Button
                variant="primary"
                style={{ width: "100%" }}
                type="submit"
                disabled={
                  signAddressError !== null ||
                  signAmountError !== null ||
                  (signDataError !== null && signDataError !== false) ||
                  signPasswordError !== null
                }
              >
                Sign
              </Button>
            </Form>
          )}
          {signTx !== null && signSendResult === null && (
            <Form onSubmit={doSend}>
              <Form.Group className="mb-3">
                <Form.Label>
                  <b>Amount: </b>
                  {satoshiToLocaleString(signTx.outputAmount)}
                </Form.Label>
                <br />
                <Form.Label>
                  <b>Fee: </b>
                  {satoshiToLocaleString(signFee)}
                </Form.Label>
                <br />
                <Form.Label>
                  <b>Balance: </b>
                  {satoshiToLocaleString(signRemaining)}
                </Form.Label>
              </Form.Group>
              <Button variant="primary" style={{ width: "100%" }} type="submit">
                Confirm and Send
              </Button>
            </Form>
          )}
          {signSendResult !== null &&
            typeof signSendResult.code !== "undefined" && (
              <Form>
                <Form.Group className="mb-3">
                  <Form.Label>
                    Error sending transaction:
                    <br />
                    <b>
                      <span style={{ color: "red" }}>
                        ({signSendResult.code}) {signSendResult.message}
                      </span>
                    </b>
                  </Form.Label>
                </Form.Group>
                <Button
                  variant="primary"
                  style={{ width: "100%" }}
                  onClick={() => setSignShow(false)}
                >
                  Close
                </Button>
              </Form>
            )}
          {signSendResult !== null &&
            typeof signSendResult!.txid !== "undefined" && (
              <Form>
                <Form.Group className="mb-3">
                  <Form.Label>Successfully sent transaction. TXID:</Form.Label>
                  <Form.Control
                    readOnly
                    as="textarea"
                    value={signSendResult!.txid}
                    rows={3}
                  />
                  <a
                    href={`https://explorer.dingocoin.com/tx/${signSendResult!.txid}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on explorer
                  </a>
                </Form.Group>
                <Button
                  variant="primary"
                  style={{ width: "100%" }}
                  onClick={() => setSignShow(false)}
                >
                  Close
                </Button>
              </Form>
            )}
        </Modal.Body>
      </Modal>

      <Modal
        size="lg"
        aria-labelledby="contained-modal-title-vcenter"
        centered
        show={revealShow}
        onHide={() => setRevealOpen(false)}
        onEntered={() => revealPasswordRef.current?.focus()}
      >
        <Modal.Header closeButton>
          <Modal.Title id="contained-modal-title-vcenter">
            Seed phrase
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {revealWords === null && (
            <Form onSubmit={doReveal} noValidate>
              <p className="modal-note">
                Make sure nobody can see your screen.
              </p>
              <Form.Group className="mb-3">
                <Form.Control
                  type="password"
                  placeholder="Wallet password"
                  value={revealPassword}
                  onChange={(e) => {
                    setRevealPassword(e.target.value);
                    setRevealPasswordError(null);
                  }}
                  ref={revealPasswordRef}
                  isInvalid={revealPasswordError !== null}
                />
                {revealPasswordError && (
                  <Form.Label className="input-error">
                    {revealPasswordError}
                  </Form.Label>
                )}
              </Form.Group>
              <Button
                variant="primary"
                style={{ width: "100%" }}
                type="submit"
                disabled={revealPassword.length === 0 || revealBusy}
              >
                {revealBusy ? "Unlocking…" : "Show seed phrase"}
              </Button>
            </Form>
          )}
          {revealWords !== null && (
            <div className="reveal">
              <PhraseGrid words={revealWords} />
              <BackupInstructions />
              <Button
                variant="primary"
                style={{ width: "100%" }}
                onClick={() => setRevealOpen(false)}
              >
                Done
              </Button>
            </div>
          )}
        </Modal.Body>
      </Modal>

      <Modal
        size="lg"
        aria-labelledby="contained-modal-title-vcenter"
        centered
        show={consolidateShow}
        onHide={() => setConsolidateShow(false)}
      >
        <Modal.Header closeButton>
          <Modal.Title id="contained-modal-title-vcenter">
            Consolidate coins
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {consolidatePlan === null && consolidateError === null && (
            <p className="modal-note">Checking your coins…</p>
          )}
          {consolidateError !== null && (
            <Form>
              <p className="modal-note">{consolidateError}</p>
              <Button
                variant="primary"
                style={{ width: "100%" }}
                onClick={() => setConsolidateShow(false)}
              >
                Close
              </Button>
            </Form>
          )}
          {consolidatePlan !== null && consolidateResult === null && (
            <Form noValidate onSubmit={doConsolidate}>
              <p className="modal-note">
                Every send lists the coins it spends, and one transaction can
                hold at most {dingocoin.MAX_CONSOLIDATION_INPUTS} coins.
                Consolidating sends your smallest coins back to this address as
                one coin, so later sends are smaller, cheaper and can move more
                at once.
              </p>
              <Form.Group className="mb-3">
                <Form.Label>
                  <b>Coins merged: </b>
                  {consolidatePlan.inputs.length} of {consolidatePlan.eligible}
                </Form.Label>
                <br />
                <Form.Label>
                  <b>Fee: </b>
                  {satoshiToLocaleString(consolidatePlan.fee)}
                </Form.Label>
                <br />
                <Form.Label>
                  <b>New coin: </b>
                  {satoshiToLocaleString(consolidatePlan.amount)}
                </Form.Label>
                {consolidatePlan.eligible > consolidatePlan.inputs.length && (
                  <p className="modal-note">
                    {consolidatePlan.eligible - consolidatePlan.inputs.length}{" "}
                    coins will be left. You can consolidate again right after
                    this to merge more.
                  </p>
                )}
                <Form.Control
                  type="password"
                  placeholder={passwordPlaceholder(activeAccount)}
                  className="mt-2"
                  value={consolidatePassword}
                  onChange={(e) => {
                    setConsolidatePassword(e.target.value);
                    setConsolidatePasswordError(null);
                  }}
                  ref={consolidatePasswordRef}
                  isInvalid={consolidatePasswordError !== null}
                  autoFocus
                />
                {consolidatePasswordError && (
                  <Form.Label className="input-error">
                    {consolidatePasswordError}
                  </Form.Label>
                )}
              </Form.Group>
              <Button
                variant="primary"
                style={{ width: "100%" }}
                type="submit"
                disabled={consolidatePassword.length === 0 || consolidateBusy}
              >
                {consolidateBusy ? "Consolidating…" : "Consolidate"}
              </Button>
            </Form>
          )}
          {consolidateResult !== null && (
            <Form>
              <Form.Group className="mb-3">
                {typeof consolidateResult.txid !== "undefined" ? (
                  <>
                    <Form.Label>Consolidation sent. TXID:</Form.Label>
                    <Form.Control
                      readOnly
                      as="textarea"
                      value={consolidateResult.txid}
                      rows={3}
                    />
                    <a
                      href={`https://explorer.dingocoin.com/tx/${consolidateResult.txid}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on explorer
                    </a>
                  </>
                ) : (
                  <Form.Label>
                    Error sending transaction:
                    <br />
                    <b>
                      <span style={{ color: "red" }}>
                        ({consolidateResult.code}) {consolidateResult.message}
                      </span>
                    </b>
                  </Form.Label>
                )}
              </Form.Group>
              <Button
                variant="primary"
                style={{ width: "100%" }}
                onClick={() => setConsolidateShow(false)}
              >
                Close
              </Button>
            </Form>
          )}
        </Modal.Body>
      </Modal>

      <Modal
        size="lg"
        aria-labelledby="contained-modal-title-vcenter"
        centered
        show={sweepShow}
        onHide={closeSweep}
        onEntered={() => sweepPhraseRef.current?.focus()}
        backdrop={sweepBusy ? "static" : true}
        keyboard={!sweepBusy}
      >
        <Modal.Header closeButton={!sweepBusy}>
          <Modal.Title id="contained-modal-title-vcenter">
            Sweep Electrum wallet
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {sweepFound === null && sweepError === null && !sweepScanning && (
            <Form noValidate onSubmit={findSweepCoins}>
              <p className="modal-note">
                Moves every coin from an Electrum wallet to this account, in one
                transaction. Enter the Electrum wallet&apos;s seed. It is not
                saved, and the Electrum wallet keeps working, but it will be
                empty.
              </p>
              <Form.Group className="mb-3">
                <Form.Control
                  as="textarea"
                  value={sweepPhrase}
                  onChange={(e) => {
                    setSweepPhrase(e.target.value);
                    setSweepPhraseError(null);
                  }}
                  placeholder="Electrum seed"
                  ref={sweepPhraseRef as any}
                  rows={3}
                  isInvalid={sweepPhraseError !== null}
                  autoComplete="off"
                  spellCheck={false}
                />
                {sweepPhraseError && (
                  <Form.Label className="input-error">
                    {sweepPhraseError}
                  </Form.Label>
                )}
                <Form.Control
                  type="password"
                  className="mt-2"
                  value={sweepPassphrase}
                  onChange={(e) => setSweepPassphrase(e.target.value)}
                  placeholder="Seed extension (only if you set one)"
                  autoComplete="off"
                />
              </Form.Group>
              <Button
                variant="primary"
                style={{ width: "100%" }}
                type="submit"
                disabled={sweepPhrase.trim().length === 0}
              >
                Find coins
              </Button>
            </Form>
          )}
          {sweepScanning && (
            <p className="modal-note">Looking for coins in this wallet…</p>
          )}
          {!sweepScanning && sweepError !== null && sweepPlan === null && (
            <Form>
              <p className="modal-note">
                {sweepFound !== null &&
                  `Found ${sweepFound.usedAddresses} used addresses. `}
                {sweepError}
              </p>
              <Button
                variant="primary"
                style={{ width: "100%" }}
                onClick={resetSweepScan}
              >
                Back
              </Button>
            </Form>
          )}
          {!sweepScanning &&
            sweepFound !== null &&
            sweepFound.usedAddresses === 0 && (
              <Form>
                <p className="modal-note">
                  No transactions were found for this seed. Check the words, and
                  the seed extension if the wallet has one.
                </p>
                <Button
                  variant="primary"
                  style={{ width: "100%" }}
                  onClick={resetSweepScan}
                >
                  Back
                </Button>
              </Form>
            )}
          {!sweepScanning && sweepPlan !== null && sweepResult === null && (
            <Form noValidate onSubmit={doSweep}>
              <Form.Group className="mb-3">
                <Form.Label>
                  <b>Found: </b>
                  {satoshiToLocaleString(sweepPlan.total)} in{" "}
                  {sweepPlan.eligible} coins on {sweepFound.usedAddresses}{" "}
                  addresses
                </Form.Label>
                <br />
                <Form.Label>
                  <b>Fee: </b>
                  {satoshiToLocaleString(sweepPlan.fee)}
                </Form.Label>
                <br />
                <Form.Label>
                  <b>You receive: </b>
                  {satoshiToLocaleString(sweepPlan.amount)}
                </Form.Label>
                <br />
                <Form.Label>
                  <b>To: </b>
                  {activeAccount.address}
                </Form.Label>
                {sweepPlan.tooSmall > 0 && (
                  <p className="modal-note">
                    {sweepPlan.tooSmall} coins are worth less than the fee to
                    spend them and are left behind.
                  </p>
                )}
                {sweepPlan.eligible > sweepPlan.inputs.length && (
                  <p className="modal-note">
                    One transaction can hold{" "}
                    {dingocoin.MAX_CONSOLIDATION_INPUTS} coins, so this sweeps
                    the largest {sweepPlan.inputs.length}. Sweep again right
                    after to move the other{" "}
                    {sweepPlan.eligible - sweepPlan.inputs.length}.
                  </p>
                )}
              </Form.Group>
              <Button
                variant="primary"
                style={{ width: "100%" }}
                type="submit"
                disabled={sweepBusy}
              >
                {sweepBusy ? "Sweeping…" : "Sweep"}
              </Button>
            </Form>
          )}
          {!sweepScanning && sweepResult !== null && (
            <Form>
              <Form.Group className="mb-3">
                {typeof sweepResult.txid !== "undefined" ? (
                  <>
                    <Form.Label>Sweep sent. TXID:</Form.Label>
                    <Form.Control
                      readOnly
                      as="textarea"
                      value={sweepResult.txid}
                      rows={3}
                    />
                    <a
                      href={`https://explorer.dingocoin.com/tx/${sweepResult.txid}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on explorer
                    </a>
                  </>
                ) : (
                  <Form.Label>
                    Error sending transaction:
                    <br />
                    <b>
                      <span style={{ color: "red" }}>
                        ({sweepResult.code}) {sweepResult.message}
                      </span>
                    </b>
                  </Form.Label>
                )}
              </Form.Group>
              {typeof sweepResult.txid !== "undefined" &&
                sweepPlan !== null &&
                sweepPlan.eligible > sweepPlan.inputs.length && (
                  <Button
                    variant="outline-primary"
                    style={{ width: "100%" }}
                    className="mb-2"
                    onClick={() => findSweepCoins()}
                  >
                    Sweep again
                  </Button>
                )}
              <Button
                variant="primary"
                style={{ width: "100%" }}
                onClick={closeSweep}
              >
                Close
              </Button>
            </Form>
          )}
        </Modal.Body>
      </Modal>

      <div className="section-footer">
        <span>© The Dingocoin Project 2021 - 2026</span>
      </div>
    </div>
  );
};

export default Popup;
