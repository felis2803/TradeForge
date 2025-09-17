import type { Account, AccountsService } from '@tradeforge/core';

export interface AccountDepositOptions {
  base?: string;
  quote?: string;
}

export interface ScenarioSymbolInfo {
  id?: string;
  base?: string;
  quote?: string;
}

export interface ScenarioAccountsContext {
  accounts: Pick<AccountsService, 'createAccount' | 'deposit'>;
  symbol?: ScenarioSymbolInfo;
}

function normalizeAccountId(account: Account): string {
  const raw = (account?.id ?? '').toString();
  return raw || 'a0';
}

function splitCurrency(value: string): { currency?: string; amount: string } {
  const trimmed = value.trim();
  const separators = [':', '=', ' '];
  for (const sep of separators) {
    const idx = trimmed.indexOf(sep);
    if (idx > 0) {
      const left = trimmed.slice(0, idx).trim();
      const right = trimmed.slice(idx + 1).trim();
      if (left && right) {
        return { currency: left, amount: right };
      }
    }
  }
  return { amount: trimmed };
}

export function fromStr(value: string): bigint {
  const normalized = value.trim().replaceAll('_', '');
  if (!normalized) {
    throw new Error('amount string must not be empty');
  }
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error('amount must be an integer string');
  }
  return BigInt(normalized);
}

export function toStrBigint(value: bigint): string {
  return value.toString(10);
}

function resolveCurrency(
  spec: string,
  fallback: string,
): { currency: string; amount: bigint } {
  const { currency, amount } = splitCurrency(spec);
  const resolvedCurrency = (currency ?? fallback).toUpperCase();
  return { currency: resolvedCurrency, amount: fromStr(amount) };
}

export async function createAccountWithDeposit(
  ctx: ScenarioAccountsContext,
  opts: AccountDepositOptions = {},
): Promise<{ accountId: string; account: Account }> {
  const { accounts } = ctx;
  if (!accounts) {
    throw new Error('accounts service is required');
  }
  const account = await Promise.resolve(accounts.createAccount());
  const accountId = normalizeAccountId(account);
  const baseCurrency = ctx.symbol?.base ?? 'BASE';
  const quoteCurrency = ctx.symbol?.quote ?? 'QUOTE';

  if (opts.base) {
    const { currency, amount } = resolveCurrency(opts.base, baseCurrency);
    await Promise.resolve(accounts.deposit(account.id, currency, amount));
  }
  if (opts.quote) {
    const { currency, amount } = resolveCurrency(opts.quote, quoteCurrency);
    await Promise.resolve(accounts.deposit(account.id, currency, amount));
  }

  return { accountId, account };
}
