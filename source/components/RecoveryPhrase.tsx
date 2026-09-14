import "./RecoveryPhrase.scss";

// Numbered grid of recovery phrase words.
export const PhraseGrid: React.FC<{ words: string[] }> = ({ words }) => (
  <ol className="phrase-grid">
    {words.map((word, i) => (
      // Words can repeat, so the position is the only stable key.
      // eslint-disable-next-line @eslint-react/no-array-index-key
      <li key={i}>
        <span className="phrase-number">{i + 1}.</span>
        <span className="phrase-word">{word}</span>
      </li>
    ))}
  </ol>
);

// How to back up a recovery phrase. Shown when it is created and when revealed.
export const BackupInstructions: React.FC = () => (
  <ul className="backup-instructions">
    <li>
      Write the words down <b>on paper, in order</b>, and check each one.
    </li>
    <li>
      Keep it somewhere safe and private. A second copy in another place
      protects against loss, fire or water damage.
    </li>
    <li>
      <b>Don&apos;t store it digitally</b>: no screenshots, photos, email,
      messages or cloud notes.
    </li>
    <li>
      <b>Never share it or type it into a website.</b> Anyone with these words
      can take your Dingocoins. Nobody from Dingocoin will ever ask for it.
    </li>
    <li>
      It is the only way to restore your wallet if this browser is lost or you
      forget your password. Your password cannot recover it.
    </li>
  </ul>
);

// Input attributes for fields that hold recovery phrase words: keep the words
// out of browser spellcheck services, autofill and autocorrect.
export const secretInputProps = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
};
