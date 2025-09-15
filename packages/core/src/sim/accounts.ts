import { ExchangeState } from './state.js';
import {
  type Account,
  type AccountId,
  type Balances,
  type Currency,
  NotFoundError,
  ValidationError,
} from './types.js';

function cloneBalance(balance: Balances): Balances {
  return { free: balance.free, locked: balance.locked };
}

export class AccountsService {
  constructor(private readonly state: ExchangeState) {}

  createAccount(apiKey?: string): Account {
    const id = this.state.nextAccountId();
    const account: Account = {
      id,
      apiKey: apiKey ?? `api-${id}`,
      balances: new Map(),
    };
    this.state.accounts.set(id, account);
    return account;
  }

  getAccount(id: AccountId): Account | undefined {
    return this.state.accounts.get(id);
  }

  requireAccount(id: AccountId): Account {
    const account = this.getAccount(id);
    if (!account) {
      throw new NotFoundError(`Account ${String(id)} not found`);
    }
    return account;
  }

  private getBalanceRef(account: Account, currency: Currency): Balances {
    let balance = account.balances.get(currency);
    if (!balance) {
      balance = { free: 0n, locked: 0n };
      account.balances.set(currency, balance);
    }
    return balance;
  }

  getBalance(accountId: AccountId, currency: Currency): Balances {
    const account = this.requireAccount(accountId);
    return cloneBalance(this.getBalanceRef(account, currency));
  }

  getBalancesSnapshot(accountId: AccountId): Record<Currency, Balances> {
    const account = this.requireAccount(accountId);
    const snapshot: Record<Currency, Balances> = {};
    for (const [currency, balance] of account.balances.entries()) {
      snapshot[currency] = cloneBalance(balance);
    }
    return snapshot;
  }

  deposit(accountId: AccountId, currency: Currency, amount: bigint): Balances {
    if (amount < 0n) {
      throw new ValidationError('amount must be non-negative');
    }
    const account = this.requireAccount(accountId);
    const balance = this.getBalanceRef(account, currency);
    balance.free += amount;
    return cloneBalance(balance);
  }

  withdraw(): never {
    throw new ValidationError('withdraw is not supported yet');
  }

  lock(accountId: AccountId, currency: Currency, amount: bigint): boolean {
    if (amount < 0n) {
      throw new ValidationError('amount must be non-negative');
    }
    if (amount === 0n) {
      return true;
    }
    const account = this.requireAccount(accountId);
    const balance = this.getBalanceRef(account, currency);
    if (balance.free < amount) {
      return false;
    }
    balance.free -= amount;
    balance.locked += amount;
    return true;
  }

  unlock(accountId: AccountId, currency: Currency, amount: bigint): void {
    if (amount < 0n) {
      throw new ValidationError('amount must be non-negative');
    }
    if (amount === 0n) {
      return;
    }
    const account = this.requireAccount(accountId);
    const balance = this.getBalanceRef(account, currency);
    if (balance.locked < amount) {
      throw new ValidationError('unlock amount exceeds locked balance');
    }
    balance.locked -= amount;
    balance.free += amount;
  }
}
