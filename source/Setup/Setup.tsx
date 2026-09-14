import DingocoinLogo from "../assets/img/dingocoin.png";
import * as React from "react";
import { Alert, Button, Container, Form, Navbar } from "react-bootstrap";
import browser from "webextension-polyfill";
import "./styles.scss";
import dingocoin from "../dingocoin";
import accounts from "../accounts";
import {
  BackupInstructions,
  PhraseGrid,
  secretInputProps,
} from "../components/RecoveryPhrase";

type Step =
  | "loading"
  | "exists"
  | "choose"
  | "create-intro"
  | "create-password"
  | "create-show"
  | "create-verify"
  | "restore-phrase"
  | "restore-password"
  | "saving"
  | "done";

const VERIFY_WORD_COUNT = 3;

// Distinct random word positions (0-based, ascending) to confirm the backup.
const pickVerifyPositions = (wordCount: number) => {
  const positions = new Set<number>();
  while (positions.size < VERIFY_WORD_COUNT) {
    const [r] = crypto.getRandomValues(new Uint32Array(1));
    positions.add(r % wordCount);
  }
  return [...positions].sort((a, b) => a - b);
};

const passwordError = (password: string, confirm: string) => {
  if (password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (password !== confirm) {
    return "Passwords do not match.";
  }
  return null;
};

const Setup: React.FC = () => {
  const [step, setStep] = React.useState<Step>("loading");
  const [saveError, setSaveError] = React.useState(null);
  const [hasImportedAccounts, setHasImportedAccounts] = React.useState(false);

  const [mnemonic, setMnemonic] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPasswordError, setShowPasswordError] = React.useState(false);

  const [revealed, setRevealed] = React.useState(false);
  const [verifyPositions, setVerifyPositions] = React.useState<number[]>([]);
  const [verifyInputs, setVerifyInputs] = React.useState<string[]>([]);
  const [verifyError, setVerifyError] = React.useState(null);

  const [restoreInput, setRestoreInput] = React.useState("");
  const [restoreError, setRestoreError] = React.useState(null);

  React.useEffect(() => {
    (async () => {
      const stored = await browser.storage.sync.get("wallet");
      if ("wallet" in stored) {
        setStep("exists");
        return;
      }
      const mode = new URLSearchParams(window.location.search).get("mode");
      setStep(
        mode === "create"
          ? "create-intro"
          : mode === "restore"
          ? "restore-phrase"
          : "choose"
      );
    })();
  }, []);

  const resetSecrets = () => {
    setMnemonic("");
    setPassword("");
    setConfirmPassword("");
    setRestoreInput("");
    setVerifyInputs([]);
  };

  const startCreate = () => {
    resetSecrets();
    setRevealed(false);
    setStep("create-intro");
  };

  const startRestore = () => {
    resetSecrets();
    setRestoreError(null);
    setStep("restore-phrase");
  };

  const submitPassword = (e: any, next: () => void) => {
    e.preventDefault();
    if (passwordError(password, confirmPassword) !== null) {
      setShowPasswordError(true);
      return;
    }
    setShowPasswordError(false);
    next();
  };

  const showNewPhrase = () => {
    if (mnemonic === "") {
      const words = dingocoin.generateMnemonic();
      setMnemonic(words);
      setVerifyPositions(pickVerifyPositions(words.split(" ").length));
    }
    setStep("create-show");
  };

  const submitVerify = async (e: any) => {
    e.preventDefault();
    const words = mnemonic.split(" ");
    const wrong = verifyPositions.find(
      (position, i) =>
        (verifyInputs[i] || "").trim().toLowerCase() !== words[position]
    );
    if (wrong !== undefined) {
      setVerifyError(
        `Word #${wrong + 1} doesn't match. Check your written copy, or go back to see the phrase again.`
      );
      return;
    }
    setVerifyError(null);
    await save(mnemonic);
  };

  const submitRestorePhrase = (e: any) => {
    e.preventDefault();
    const error = dingocoin.mnemonicError(restoreInput);
    setRestoreError(error);
    if (error === null) {
      setStep("restore-password");
    }
  };

  const save = async (phrase: string) => {
    setStep("saving");
    setSaveError(null);
    try {
      const normalized = dingocoin.normalizeMnemonic(phrase);
      const stored = await browser.storage.sync.get(["wallet", "accounts"]);
      if ("wallet" in stored) {
        // Another tab finished setup first; never overwrite a recovery phrase.
        resetSecrets();
        setStep("exists");
        return;
      }
      const existing: any[] = stored.accounts || [];
      const wallet = await accounts.createWallet(normalized, password);
      const first = accounts.firstHdAccount(normalized);
      const duplicate = existing.find((x) => x.address === first.address);
      await browser.storage.sync.set({
        wallet,
        accounts: duplicate ? existing : [...existing, first],
        activeAccount: duplicate || first,
      });
      setHasImportedAccounts(
        existing.some((x) => !accounts.isRecoveryPhraseAccount(x))
      );
      resetSecrets();
      setStep("done");
    } catch (err: any) {
      setSaveError(`Could not save your wallet: ${err.message}`);
      setStep(mnemonic !== "" ? "create-verify" : "restore-password");
    }
  };

  const passwordForm = (onSubmit: (e: any) => void, submitLabel: string) => (
    <Form noValidate onSubmit={onSubmit}>
      <p>
        This password unlocks your wallet in this browser. You&apos;ll need it
        to send Dingocoins, add accounts and view your recovery phrase.
      </p>
      <Form.Control
        type="password"
        placeholder="New password (min. 8 characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
      />
      <Form.Control
        type="password"
        className="mt-2"
        placeholder="Confirm password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      {showPasswordError && passwordError(password, confirmPassword) && (
        <Form.Label className="input-error">
          {passwordError(password, confirmPassword)}
        </Form.Label>
      )}
      <div className="actions">
        <Button type="submit">{submitLabel}</Button>
      </div>
    </Form>
  );

  return (
    <div>
      <Navbar className="navbar" bg="dark" expand="lg" sticky="top">
        <Container fluid>
          <Navbar.Brand className="navbar-brand">
            <img alt="" src={DingocoinLogo} />
          </Navbar.Brand>
          <span>DINGOCOIN</span>
          <img
            style={{ visibility: "hidden", width: "2rem" }}
            alt=""
            src={DingocoinLogo}
          />
        </Container>
      </Navbar>

      <Container id="setup">
        {saveError && <Alert variant="danger">{saveError}</Alert>}

        {step === "loading" && <p>Loading…</p>}

        {step === "exists" && (
          <div>
            <h1>Recovery phrase already set up</h1>
            <p>
              This wallet already has a recovery phrase. To see it, open the
              Dingocoin Wallet from the browser toolbar and choose{" "}
              <b>Show recovery phrase</b> in the menu.
            </p>
            <div className="actions">
              <Button onClick={() => window.close()}>Close</Button>
            </div>
          </div>
        )}

        {step === "choose" && (
          <div>
            <h1>Set up your wallet</h1>
            <div className="actions stacked">
              <Button onClick={startCreate}>Create a new wallet</Button>
              <Button variant="outline-dark" onClick={startRestore}>
                Restore from a recovery phrase
              </Button>
            </div>
          </div>
        )}

        {step === "create-intro" && (
          <div>
            <h1>Your recovery phrase</h1>
            <p>
              Your wallet is created from a <b>12-word recovery phrase</b>.
              Every account you create in this wallet comes from it.
            </p>
            <p>
              The recovery phrase is the only way to restore your wallet and
              funds if you lose this computer, remove the extension or forget
              your password. Anyone who has it can take your Dingocoins.
            </p>
            <p>
              Before you continue, get a pen and paper to write it down.
            </p>
            <div className="actions">
              <Button onClick={() => setStep("create-password")}>
                I&apos;m ready
              </Button>
            </div>
          </div>
        )}

        {step === "create-password" && (
          <div>
            <h1>Choose a password</h1>
            {passwordForm((e) => submitPassword(e, showNewPhrase), "Continue")}
          </div>
        )}

        {step === "create-show" && (
          <div>
            <h1>Write down your recovery phrase</h1>
            <div
              className={`phrase-box${revealed ? "" : " concealed"}`}
              onClick={() => setRevealed(true)}
            >
              <PhraseGrid words={mnemonic.split(" ")} />
              {!revealed && (
                <div className="phrase-cover">
                  Make sure nobody can see your screen, then click to reveal.
                </div>
              )}
            </div>
            <BackupInstructions />
            <div className="actions">
              <Button
                disabled={!revealed}
                onClick={() => {
                  setVerifyInputs([]);
                  setVerifyError(null);
                  setStep("create-verify");
                }}
              >
                I&apos;ve written it down
              </Button>
            </div>
          </div>
        )}

        {step === "create-verify" && (
          <div>
            <h1>Confirm your recovery phrase</h1>
            <p>Enter these words from your written copy.</p>
            <Form noValidate onSubmit={submitVerify}>
              {verifyPositions.map((position, i) => (
                <Form.Group className="verify-word" key={position}>
                  <Form.Label>Word #{position + 1}</Form.Label>
                  <Form.Control
                    {...secretInputProps}
                    value={verifyInputs[i] || ""}
                    autoFocus={i === 0}
                    onChange={(e) => {
                      const next = [...verifyInputs];
                      next[i] = e.target.value;
                      setVerifyInputs(next);
                    }}
                  />
                </Form.Group>
              ))}
              {verifyError && (
                <Form.Label className="input-error">{verifyError}</Form.Label>
              )}
              <div className="actions">
                <Button
                  variant="outline-dark"
                  onClick={() => setStep("create-show")}
                >
                  Back
                </Button>
                <Button type="submit">Create wallet</Button>
              </div>
            </Form>
          </div>
        )}

        {step === "restore-phrase" && (
          <div>
            <h1>Restore from a recovery phrase</h1>
            <p>
              Enter your 12 to 24-word recovery phrase, with a space between
              each word.
            </p>
            <Form noValidate onSubmit={submitRestorePhrase}>
              <Form.Control
                {...secretInputProps}
                as="textarea"
                rows={4}
                placeholder="Recovery phrase"
                value={restoreInput}
                onChange={(e) => setRestoreInput(e.target.value)}
                isInvalid={restoreError !== null}
                autoFocus
              />
              {restoreError && (
                <Form.Label className="input-error">{restoreError}</Form.Label>
              )}
              <p className="note">
                This restores <b>Account 1</b>. If you used more accounts with
                this phrase, add them afterwards with <b>Create account</b> in
                the wallet menu. They come back in the same order.
              </p>
              <div className="actions">
                <Button type="submit">Continue</Button>
              </div>
            </Form>
          </div>
        )}

        {step === "restore-password" && (
          <div>
            <h1>Choose a password</h1>
            {passwordForm(
              (e) => submitPassword(e, () => save(restoreInput)),
              "Restore wallet"
            )}
          </div>
        )}

        {step === "saving" && <p>Encrypting and saving your wallet…</p>}

        {step === "done" && (
          <div>
            <h1>Your wallet is ready</h1>
            <p>
              Open the Dingocoin Wallet from your browser toolbar to see your
              account.
            </p>
            {hasImportedAccounts && (
              <Alert variant="warning" className="note">
                Accounts you added from a private key are still in your wallet,
                but they are <b>not</b> part of this recovery phrase. Keep a
                backup of each of their private keys (<b>Export</b> in the
                account menu).
              </Alert>
            )}
            <div className="actions">
              <Button onClick={() => window.close()}>Close this tab</Button>
            </div>
          </div>
        )}
      </Container>
    </div>
  );
};

export default Setup;
