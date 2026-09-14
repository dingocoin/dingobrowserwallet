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
} from "@fortawesome/free-solid-svg-icons";
import dingocoin from "../dingocoin";
import keyring from "../accounts";
import provider from "../provider";
import {
  BackupInstructions,
  PhraseGrid,
} from "../components/RecoveryPhrase";

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

const Popup: React.FC = () => {
  const [accounts, setAccounts] = React.useState(null);
  const [activeAccount, setActiveAccount] = React.useState(null);
  const [activeUtxos, setActiveUtxos] = React.useState(null);
  const [activeTransit, setActiveTransit] = React.useState(null);
  const [menuShow, setMenuShow] = React.useState(false);
  // Encrypted recovery phrase, or null if the wallet has none yet.
  const [wallet, setWallet] = React.useState(null);

  // Recovery phrase setup runs in a full tab: the popup closes when it loses focus.
  const openSetup = async (mode: "create" | "restore") => {
    await browser.tabs.create({
      url: browser.runtime.getURL(`setup.html?mode=${mode}`),
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
  const [signSendResult, setSignSendResult] = React.useState(null);
  const [signTx, setSignTx] = React.useState(null);
  React.useEffect(() => {
    if (signShow === true) {
      setSignAddress("");
      setSignAmount("");
      setSignData("");
      setSignPassword("");
      setSignFee(null);
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

    // Fetch latest UTXOs.
    const vins = (await provider.getUtxos(activeAccount.address)).map(
      (x: any) => {
        return { txid: x.txid, vout: x.vout, amount: BigInt(x.amount) };
      }
    );
    const vouts = [
      {
        address: signAddress,
        amount: BigInt(dingocoin.toSatoshi(signAmount)),
      },
    ];
    const data = signData.length === 0 ? null : Buffer.from(signData, "utf8");

    let signedTx = null;
    let fee = dingocoin.FEE_RATE;
    while (true) {
      const test = dingocoin.createSignedRawTransaction(
        vins,
        vouts,
        data,
        fee,
        activeAccount.address,
        privKey
      );
      const requiredFee =
        BigInt(Math.ceil((test.tx.length / 2 + 100) / 1000)) *
        dingocoin.FEE_RATE; // 100 bytes allowance for errors.
      if (fee >= requiredFee) {
        signedTx = test;
        break;
      }
      fee += dingocoin.FEE_RATE;
    }

    if (signedTx.balanceAmount < 0n) {
      setSignAmountError("Insufficient balance.");
    } else {
      setSignFee(fee);
      setSignTx(signedTx);
    }
  };
  const doSend = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();

    const result = await provider.sendRawTransaction(signTx.tx);
    setSignSendResult(result);
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
    setActiveUtxos(null);
    setActiveTransit(null);
    setActiveAccount(x);
  };

  const refresh = async () => {
    if (activeAccount !== null) {
      setActiveUtxos(await provider.getUtxos(activeAccount.address));
      setActiveTransit(
        (await provider.getMempool(activeAccount.address)).change
      );
    } else {
      setActiveUtxos(null);
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
    <div id="popup">
      <Navbar className="navbar" bg="dark" expand="lg" sticky="top">
        <Container fluid>
          <Navbar.Brand href="#home" className="navbar-brand">
            <img alt="" src={DingocoinLogo} />
          </Navbar.Brand>
          <span>DINGOCOIN</span>
          <Button onClick={() => setMenuShow(true)}>
            <FontAwesomeIcon className="icon" icon={faBars} />
          </Button>
        </Container>
      </Navbar>

      {activeAccount === null && accounts !== null && accounts.length === 0 && (
        <div className="welcome">
          <Container className="text-center">
            <h3>Welcome</h3>
            <p>Set up your Dingocoin wallet.</p>
            <Button onClick={() => openSetup("create")}>Create new wallet</Button>
            <Button variant="outline-primary" onClick={() => openSetup("restore")}>
              Restore from recovery phrase
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
                  {activeUtxos === null
                    ? "-"
                    : satoshiToLocaleString(
                        activeUtxos
                          .reduce(
                            (a: any, b: any) => a + BigInt(b.amount),
                            BigInt(0)
                          )
                          .toString()
                      )}
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
                href={`https://explorer.dingocoin.org/address/${activeAccount.address}`}
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
            accounts.map((x: any, i: any) => {
              const name =
                (x.label === "" ? x.address : `${x.label} (${x.address})`) +
                (wallet !== null && !keyring.isRecoveryPhraseAccount(x)
                  ? " · imported"
                  : "");
              return (
                <Button
                  className="menu-item account"
                  onClick={() => switchAccount(x)}
                  key={i}
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
          <hr />
          <Button className="menu-item" onClick={createAccountClicked}>
            <FontAwesomeIcon className="icon" icon={faPlus} />
            <span>Create account</span>
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
              <span>Show recovery phrase</span>
            </Button>
          )}
          {wallet === null && (
            <Button className="menu-item" onClick={() => openSetup("restore")}>
              <FontAwesomeIcon className="icon" icon={faUndoAlt} />
              <span>Restore from recovery phrase</span>
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
              The new account comes from your recovery phrase.
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
              Imported keys are not part of your recovery phrase. Keep your own
              backup of this private key.
            </Alert>
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
                placeholder="New password (min. 8 char.)"
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
                  placeholder="Password"
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
                recovery phrase, so <b>Create account</b> adds it back with the
                same address.
              </p>
            )}
          {activeAccount !== null &&
            !keyring.isRecoveryPhraseAccount(activeAccount) && (
              <Alert variant="danger" className="modal-note">
                This private key is <b>not</b> part of your recovery phrase.
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
                  placeholder="Password"
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
                  {satoshiToLocaleString(signTx.balanceAmount)}
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
            Recovery phrase
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
                {revealBusy ? "Unlocking…" : "Show recovery phrase"}
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

      <div className="section-footer">
        <span>© The Dingocoin Project 2021 - 2022</span>
      </div>
    </div>
  );
};

export default Popup;
