/**
 * Banking Integration — Account Aggregator
 *
 * Fetches and normalises account, balance, and transaction data from
 * multiple Open Banking connectors into a single unified model.
 * Designed to work alongside BankingIntegrationAdapter and
 * OpenBankingConnector already present in this package.
 *
 * Usage:
 *
 *   import { BankingAccountAggregator } from "@workspace/core/banking/account-aggregator";
 *
 *   const aggregator = new BankingAccountAggregator();
 *   aggregator.addConnector("revolut",  revolutConnector);
 *   aggregator.addConnector("monzo",    monzoConnector);
 *
 *   const portfolio = await aggregator.fetchPortfolio("user-123");
 *   console.log(portfolio.totalBalanceUsdCents);
 */

// ---------------------------------------------------------------------------
// Unified account model
// ---------------------------------------------------------------------------

export type AccountType =
  | "current"
  | "savings"
  | "credit"
  | "investment"
  | "crypto"
  | "unknown";

export type AccountCurrency = string; // ISO 4217, e.g. "USD", "GBP", "EUR"

export type UnifiedAccount = {
  /** Globally unique ID — "{connectorId}:{rawAccountId}" */
  accountId:      string;
  connectorId:    string;
  displayName:    string;
  type:           AccountType;
  currency:       AccountCurrency;
  /** Balance in smallest unit of the currency (cents, pence, etc.) */
  balanceMinor:   number;
  /** Balance converted to USD cents using the rate provided by the connector */
  balanceUsdCents: number;
  iban?:          string;
  sortCode?:      string;
  lastSyncedAt:   string;
};

export type UnifiedTransaction = {
  txId:           string;
  accountId:      string;
  connectorId:    string;
  amountMinor:    number;
  amountUsdCents: number;
  currency:       AccountCurrency;
  direction:      "credit" | "debit";
  description:    string;
  category?:      string;
  merchantName?:  string;
  bookedAt:       string;
  valueAt:        string;
  pending:        boolean;
};

export type AccountPortfolio = {
  userId:              string;
  fetchedAt:           string;
  accounts:            UnifiedAccount[];
  recentTransactions:  UnifiedTransaction[];
  totalBalanceUsdCents: number;
  connectorsSynced:    string[];
  connectorErrors:     Array<{ connectorId: string; error: string }>;
};

// ---------------------------------------------------------------------------
// Connector interface
// ---------------------------------------------------------------------------

export interface BankingConnector {
  readonly connectorId: string;
  readonly label:       string;

  /** Fetch all accounts for a user */
  fetchAccounts(userId: string): Promise<RawAccount[]>;
  /** Fetch recent transactions for one account */
  fetchTransactions(userId: string, rawAccountId: string, limit: number): Promise<RawTransaction[]>;
  /** Current FX rate for the connector's base currency to USD */
  fxRateToUsd(currency: string): Promise<number>;
}

// Raw types returned by connectors before normalisation
export type RawAccount = {
  id:           string;
  name:         string;
  type:         string;
  currency:     string;
  balanceMinor: number;
  iban?:        string;
  sortCode?:    string;
};

export type RawTransaction = {
  id:           string;
  amountMinor:  number;
  currency:     string;
  description:  string;
  category?:    string;
  merchant?:    string;
  bookedAt:     string;
  valueAt?:     string;
  pending?:     boolean;
};

// ---------------------------------------------------------------------------
// Type normalisation
// ---------------------------------------------------------------------------

function normaliseType(raw: string): AccountType {
  const map: Record<string, AccountType> = {
    current:    "current",  checking: "current",
    savings:    "savings",
    credit:     "credit",   creditcard: "credit",
    investment: "investment", isa: "investment",
    crypto:     "crypto",
  };
  return map[raw.toLowerCase().replace(/[\s_-]/g, "")] ?? "unknown";
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export class BankingAccountAggregator {
  private connectors = new Map<string, BankingConnector>();

  addConnector(connectorId: string, connector: BankingConnector): this {
    this.connectors.set(connectorId, connector);
    return this;
  }

  removeConnector(connectorId: string): this {
    this.connectors.delete(connectorId);
    return this;
  }

  // ── Portfolio fetch ───────────────────────────────────────────────────────

  async fetchPortfolio(
    userId: string,
    opts: { txLimit?: number } = {}
  ): Promise<AccountPortfolio> {
    const txLimit         = opts.txLimit ?? 50;
    const accounts:       UnifiedAccount[]     = [];
    const transactions:   UnifiedTransaction[] = [];
    const connectorsSynced: string[]           = [];
    const connectorErrors: Array<{ connectorId: string; error: string }> = [];

    await Promise.all(
      [...this.connectors.values()].map(async connector => {
        try {
          const rawAccounts = await connector.fetchAccounts(userId);

          for (const raw of rawAccounts) {
            const fxRate   = await connector.fxRateToUsd(raw.currency);
            const usdCents = Math.round(raw.balanceMinor * fxRate);

            const unified: UnifiedAccount = {
              accountId:       `${connector.connectorId}:${raw.id}`,
              connectorId:     connector.connectorId,
              displayName:     raw.name,
              type:            normaliseType(raw.type),
              currency:        raw.currency,
              balanceMinor:    raw.balanceMinor,
              balanceUsdCents: usdCents,
              iban:            raw.iban,
              sortCode:        raw.sortCode,
              lastSyncedAt:    new Date().toISOString(),
            };
            accounts.push(unified);

            // Fetch transactions for each account
            const rawTxs = await connector.fetchTransactions(userId, raw.id, txLimit);
            for (const tx of rawTxs) {
              const txFx  = await connector.fxRateToUsd(tx.currency);
              transactions.push({
                txId:           `${connector.connectorId}:${tx.id}`,
                accountId:      unified.accountId,
                connectorId:    connector.connectorId,
                amountMinor:    Math.abs(tx.amountMinor),
                amountUsdCents: Math.round(Math.abs(tx.amountMinor) * txFx),
                currency:       tx.currency,
                direction:      tx.amountMinor >= 0 ? "credit" : "debit",
                description:    tx.description,
                category:       tx.category,
                merchantName:   tx.merchant,
                bookedAt:       tx.bookedAt,
                valueAt:        tx.valueAt ?? tx.bookedAt,
                pending:        tx.pending ?? false,
              });
            }
          }

          connectorsSynced.push(connector.connectorId);
        } catch (err) {
          connectorErrors.push({
            connectorId: connector.connectorId,
            error:       err instanceof Error ? err.message : String(err),
          });
        }
      })
    );

    const totalBalanceUsdCents = accounts.reduce((s, a) => s + a.balanceUsdCents, 0);

    // Sort transactions newest-first, cap at txLimit across all connectors
    const recentTransactions = transactions
      .sort((a, b) => b.bookedAt.localeCompare(a.bookedAt))
      .slice(0, txLimit);

    return {
      userId,
      fetchedAt:            new Date().toISOString(),
      accounts,
      recentTransactions,
      totalBalanceUsdCents,
      connectorsSynced,
      connectorErrors,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  summary(portfolio: AccountPortfolio): string {
    const total   = `$${(portfolio.totalBalanceUsdCents / 100).toFixed(2)}`;
    const accs    = portfolio.accounts.length;
    const txs     = portfolio.recentTransactions.length;
    const synced  = portfolio.connectorsSynced.join(", ");
    const errors  = portfolio.connectorErrors.length;
    return (
      `BankingAccountAggregator — user: ${portfolio.userId}\n` +
      `  Total balance : ${total}  across ${accs} account(s)\n` +
      `  Transactions  : ${txs} recent\n` +
      `  Connectors    : ${synced}${errors ? `  (${errors} error(s))` : ""}`
    );
  }
}
