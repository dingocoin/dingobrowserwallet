import keyring from "../accounts";

// User-facing names for the three account record types (see accounts.js).
// Recovery-phrase accounts unlock with the wallet password; legacy and
// imported keys each have their own password.

export const accountKindLabel = (account: any) => {
  switch (keyring.accountType(account)) {
    case "hd":
      return "Recovery phrase";
    case "key":
      return "Imported key";
    default:
      return "Legacy account";
  }
};

// The popup builds its modals while no account is active, so allow null.
export const passwordPlaceholder = (account: any) => {
  if (!account) {
    return "Password";
  }
  return keyring.isRecoveryPhraseAccount(account)
    ? "Wallet password"
    : "Account password";
};

// Menu sections, in stored order within each. Empty sections are left out.
export const groupAccounts = (accounts: any[]) =>
  [
    {
      title: "Recovery phrase",
      accounts: accounts.filter(keyring.isRecoveryPhraseAccount),
    },
    {
      title: "Legacy & imported keys",
      accounts: accounts.filter((x) => !keyring.isRecoveryPhraseAccount(x)),
    },
  ].filter((group) => group.accounts.length > 0);
