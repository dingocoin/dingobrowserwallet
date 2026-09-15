import DingocoinLogo from "../assets/img/dingocoin.png";
import * as React from "react";
import { Button, Container, Form, Navbar } from "react-bootstrap";
import browser from "webextension-polyfill";
import "./styles.scss";
import dingocoin from "../dingocoin";
import keyring from "../accounts";

const SignData: React.FC = () => {
  const [id, setId] = React.useState(null);
  const [origin, setOrigin] = React.useState(null);
  const [data, setData] = React.useState(null);

  const [account, setAccount] = React.useState(undefined);
  const [wallet, setWallet] = React.useState(undefined);
  React.useEffect(() => {
    (async () => {
      const active = await browser.storage.sync.get(["activeAccount", "wallet"]);
      setWallet(active.wallet);
      if ("activeAccount" in active) {
        setAccount(active.activeAccount);
      } else {
        setAccount(null);
      }

      const q = new URLSearchParams(window.location.search);
      setId(parseInt(q.get("id")));
      setOrigin(q.get("origin"));
      setData(Buffer.from(q.get("data"), "hex"));
    })();
  }, []);

  const [signPassword, setSignPassword] = React.useState("");
  const [signPasswordError, setSignPasswordError] = React.useState(null);
  React.useEffect(() => {
    if (signPassword.length === 0) {
      setSignPasswordError("Password required.");
    } else {
      setSignPasswordError(null);
    }
  }, [signPassword]);

  const [approving, setApproving] = React.useState(false);
  const onApprove = async (e: any) => {
    e.preventDefault();
    e.stopPropagation();

    setApproving(true);
    const privKey = await keyring.unlockAccount(account, signPassword, wallet);
    setApproving(false);
    if (privKey === null) {
      setSignPasswordError("Incorrect password.");
      return;
    }

    const signed = dingocoin.sign(data, privKey);
    onEnd(null, Buffer.from(signed).toString("hex"));
  };

  const onEnd = (err: any, res: any) => {
    const bc_bg_popup = new BroadcastChannel("dingo_bg_popup_" + id);
    if (err === undefined || err === null) {
      bc_bg_popup.postMessage({ result: res });
    } else {
      bc_bg_popup.postMessage({ error: err });
    }
    window.close();
  };

  return (
    <div>
      <Navbar className="navbar" bg="dark" expand="lg" sticky="top">
        <Container fluid>
          <Navbar.Brand href="#home" className="navbar-brand">
            <img alt="" src={DingocoinLogo} />
          </Navbar.Brand>
          <span>DINGOCOIN</span>
          {/*Lmao f this shit I give up someone please hire a web designer*/}
          <img
            style={{ visibility: "hidden", width: "2rem" }}
            alt=""
            src={DingocoinLogo}
          />
        </Container>
      </Navbar>
      <Container id="signdata" className="justify-content-md-center">
        <h1>Sign Data</h1>
        {account !== undefined && account === null && (
          <div>
            <p>
              <span style={{ lineBreak: "anywhere" }}>
                <b>{origin}</b>
              </span>
              <br />
              wants to sign
              <br />
              <b>{data !== null && data.length} bytes</b> of data.
            </p>
            <p>To continue, select an active account in your wallet.</p>
            <Button
              className="mx-2"
              variant="outline-dark"
              onClick={() => onEnd("No active account", null)}
            >
              Close
            </Button>
          </div>
        )}
        {account !== undefined && account !== null && (
          <div>
            <p>
              <span style={{ lineBreak: "anywhere" }}>
                <b>{origin}</b>
              </span>
              <br />
              wants to sign
              <br />
              <b>{data !== null && data.length} bytes</b> of data.
            </p>
            <p>
              Sign with account
              {account.label !== null && (
                <span style={{ lineBreak: "anywhere" }}>
                  : <b>{account.label}</b>
                </span>
              )}
              <br />
              <span style={{ lineBreak: "anywhere", fontSize: "0.75rem" }}>
                <b>{account.address}</b>
              </span>
              ?
            </p>
            <Form noValidate onSubmit={onApprove}>
              <Form.Group className="mb-3">
                <Form.Control
                  placeholder="Password"
                  className="mt-2 mb-2"
                  type="password"
                  value={signPassword}
                  onChange={(e) => setSignPassword(e.target.value)}
                  isInvalid={signPasswordError !== null}
                  autoFocus
                />
                {signPasswordError && (
                  <Form.Label className="input-error">
                    {signPasswordError}
                  </Form.Label>
                )}
              </Form.Group>
              <Button
                className="mx-2"
                variant="primary"
                type="submit"
                disabled={signPasswordError !== null || approving}
              >
                Approve
              </Button>
              <Button
                className="mx-2"
                variant="outline-dark"
                onClick={() => onEnd("User rejected request", null)}
              >
                Reject
              </Button>
            </Form>
          </div>
        )}
      </Container>
    </div>
  );
};

export default SignData;
