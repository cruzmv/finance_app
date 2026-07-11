import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, finalize, map, of, shareReplay, tap } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthService } from './auth.service';

export type BalanceSnapshot = Record<string, number>;

export interface BalanceRow {
  id: number;
  datetime: string;
  description: string;
  ledger_account_id: number;
  ledger_account: string;
  moviment_account_id: number;
  moviment_account: string;
  status_id: number;
  status: string;
  value: string;
  balances: BalanceSnapshot;
  credit_status: string | null;
  credit_bill: boolean | null;
  account_type: 0 | 1 | null;
  planning?: number | null;
}

interface BalanceResponse {
  data: BalanceRow[];
}

interface MovimentPayload {
  datetime: string;
  description: string;
  ledger_account: number;
  moviment_account: number;
  status: number;
  value: number;
}

export interface CreditBillSyncMissingBill {
  account_id: number;
  account_description: string;
  cycle_key: string;
  due_datetime: string;
  value: number;
  movement_count: number;
}

export interface CreditBillSyncResponse {
  data?: {
    missingBills?: CreditBillSyncMissingBill[];
    createdBills?: Partial<BalanceRow>[];
    updatedBills?: Partial<BalanceRow>[];
    markedBills?: Partial<BalanceRow>[];
  };
}

export interface PlanningPayload {
  start_datetime: string;
  end_date: string;
  day_of_month: number;
  description: string;
  ledger_account: number;
  moviment_account: number;
  value: number;
}

export interface PlanningSeries {
  planning: number;
  start_datetime: string;
  end_date: string;
  day_of_month: number;
  description: string;
  ledger_account_id: number;
  ledger_account: string;
  moviment_account_id: number;
  moviment_account: string;
  status_id: number;
  status: string;
  value: string;
  occurrence_count: number;
}

export interface ContractOnboardingSetup {
  completed?: boolean;
  completedAt?: string;
  skipped?: boolean;
  skippedAt?: string;
  answers?: unknown;
  planningIds?: number[];
  version?: number;
}

interface ContractOnboardingResponse {
  data: {
    onboardingSetup: ContractOnboardingSetup | null;
  };
}

interface ContractOnboardingSaveResponse {
  data: {
    onboardingSetup: ContractOnboardingSetup;
  };
}

interface MovimentSaveResponse {
  data?: {
    moviment?: Partial<BalanceRow>;
  };
}

interface CreditStatusToggleResponse {
  data?: {
    moviment?: {
      id?: number;
      credit_status?: string | null;
    };
  };
}

export interface MovimentAccountSettings {
  id: number;
  description: string;
  icon: string | null;
  contract: number | null;
  start_date: string | null;
  start_value: string | number | null;
  closing_day: number | null;
  pay_day: number | null;
  debit_account: number | null;
  account_type: 0 | 1;
}

export interface LedgerAccountSettings {
  id: number;
  description: string;
  icon: string | null;
  contract: number | null;
}

export interface StatusSettings {
  id: number;
  description: string;
  icon: string | null;
  contract: number | null;
}

export interface FinanceSettingsData {
  accounts: MovimentAccountSettings[];
  ledgerAccounts: LedgerAccountSettings[];
  statuses: StatusSettings[];
}

export type MovimentAccountPayload = Omit<MovimentAccountSettings, 'id' | 'contract'>;
export type LedgerAccountPayload = Omit<LedgerAccountSettings, 'id' | 'contract'>;
export type StatusPayload = Omit<StatusSettings, 'id' | 'contract'>;

@Injectable({ providedIn: 'root' })
export class FinanceDataService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly apiBaseUrl = environment.apiBaseUrl;
  private readonly endpoint = `${this.apiBaseUrl}/get_balance`;
  private balanceCache: BalanceRow[] | null = null;
  private balanceCacheToken = '';
  private balanceRequest$: Observable<BalanceRow[]> | null = null;
  private balanceRevision = 0;

  get balancesRevision(): number {
    return this.balanceRevision;
  }

  getBalances(forceRefresh = false): Observable<BalanceRow[]> {
    const activeToken = this.auth.token;

    if (this.balanceCacheToken !== activeToken) {
      this.invalidateBalances();
    }

    if (!forceRefresh && this.balanceCache) {
      return of(this.balanceCache);
    }

    if (!forceRefresh && this.balanceRequest$) {
      return this.balanceRequest$;
    }

    this.balanceRequest$ = this.http.get<BalanceResponse>(this.endpoint).pipe(
      map(({ data }) => this.sortRows(data ?? [])),
      tap((rows) => {
        this.balanceCache = rows;
        this.balanceCacheToken = activeToken;
      }),
      finalize(() => (this.balanceRequest$ = null)),
      shareReplay(1),
    );

    return this.balanceRequest$;
  }

  saveMoviment(
    mode: 'add' | 'edit',
    payload: MovimentPayload,
    originalMoviment: BalanceRow | null,
  ): Observable<MovimentSaveResponse> {
    const request$ = mode === 'edit'
      ? this.http.post<MovimentSaveResponse>(`${this.apiBaseUrl}/edit_moviment`, {
          id: originalMoviment?.id,
          ...payload,
        })
      : this.http.post<MovimentSaveResponse>(`${this.apiBaseUrl}/add_moviment`, payload);

    return request$.pipe(
      tap(() => this.markBalancesChanged()),
    );
  }

  updateMovimentStatus(row: BalanceRow, statusId: number): Observable<MovimentSaveResponse> {
    return this.saveMoviment('edit', {
      datetime: row.datetime,
      description: row.description,
      ledger_account: row.ledger_account_id,
      moviment_account: row.moviment_account_id,
      status: statusId,
      value: Number(row.value) || 0,
    }, row);
  }

  deleteMoviment(id: number): Observable<unknown> {
    return this.http.post(`${this.apiBaseUrl}/delete_moviment`, { id }).pipe(
      tap(() => this.markBalancesChanged()),
    );
  }

  getPlanningSeries(): Observable<PlanningSeries[]> {
    return this.http
      .get<{ data: PlanningSeries[] }>(`${this.apiBaseUrl}/get_plannings`)
      .pipe(map(({ data }) => data ?? []));
  }

  savePlanning(
    mode: 'add' | 'edit',
    payload: PlanningPayload,
    planning?: number,
  ): Observable<unknown> {
    const endpoint = mode === 'edit' ? 'edit_planning' : 'add_planning';
    const requestPayload = mode === 'edit' ? { planning, ...payload } : payload;

    return this.http.post(`${this.apiBaseUrl}/${endpoint}`, requestPayload).pipe(
      tap(() => this.markBalancesChanged()),
    );
  }

  deletePlanning(planning: number): Observable<unknown> {
    return this.http.post(`${this.apiBaseUrl}/delete_planning`, { planning }).pipe(
      tap(() => this.markBalancesChanged()),
    );
  }

  toggleMovimentCreditStatus(id: number, confirmed: boolean): Observable<CreditStatusToggleResponse> {
    return this.http
      .post<CreditStatusToggleResponse>(`${this.apiBaseUrl}/toggle_moviment_credit_status`, {
        id,
        confirmed,
      })
      .pipe(
        tap((response) => {
          if (!this.balanceCache) {
            return;
          }

          const creditStatus = response.data?.moviment?.credit_status ?? null;
          this.balanceCache = this.balanceCache.map((row) => {
            return row.id === id ? { ...row, credit_status: creditStatus } : row;
          });
        }),
      );
  }

  syncCreditBills(createMissing: boolean): Observable<CreditBillSyncResponse> {
    return this.http
      .post<CreditBillSyncResponse>(`${this.apiBaseUrl}/sync_credit_bills`, {
        create_missing: createMissing,
      })
      .pipe(tap(() => this.markBalancesChanged()));
  }

  getFinanceSettings(): Observable<FinanceSettingsData> {
    return this.http
      .get<{ data: FinanceSettingsData }>(`${this.apiBaseUrl}/get_finance_settings`)
      .pipe(map(({ data }) => data));
  }

  getContractOnboardingSetup(): Observable<ContractOnboardingSetup | null> {
    return this.http
      .get<ContractOnboardingResponse>(`${this.apiBaseUrl}/auth/contract/onboarding`)
      .pipe(map(({ data }) => data?.onboardingSetup ?? null));
  }

  saveContractOnboardingSetup(setup: ContractOnboardingSetup): Observable<ContractOnboardingSetup> {
    return this.http
      .post<ContractOnboardingSaveResponse>(`${this.apiBaseUrl}/auth/contract/onboarding`, {
        onboardingSetup: setup,
      })
      .pipe(map(({ data }) => data.onboardingSetup));
  }

  saveMovimentAccount(
    mode: 'add' | 'edit',
    payload: MovimentAccountPayload,
    id?: number,
  ): Observable<unknown> {
    const request$ = mode === 'edit'
      ? this.http.post(`${this.apiBaseUrl}/edit_moviment_account`, { id, ...payload })
      : this.http.post(`${this.apiBaseUrl}/add_moviment_account`, payload);

    return request$.pipe(tap(() => this.invalidateBalances()));
  }

  deleteMovimentAccount(id: number): Observable<unknown> {
    return this.http.post(`${this.apiBaseUrl}/delete_moviment_account`, { id }).pipe(
      tap(() => this.invalidateBalances()),
    );
  }

  saveLedgerAccount(
    mode: 'add' | 'edit',
    payload: LedgerAccountPayload,
    id?: number,
  ): Observable<unknown> {
    const request$ = mode === 'edit'
      ? this.http.post(`${this.apiBaseUrl}/edit_ledger_account`, { id, ...payload })
      : this.http.post(`${this.apiBaseUrl}/add_ledger_account`, payload);

    return request$.pipe(tap(() => this.invalidateBalances()));
  }

  deleteLedgerAccount(id: number): Observable<unknown> {
    return this.http.post(`${this.apiBaseUrl}/delete_ledger_account`, { id }).pipe(
      tap(() => this.invalidateBalances()),
    );
  }

  saveStatus(
    mode: 'add' | 'edit',
    payload: StatusPayload,
    id?: number,
  ): Observable<unknown> {
    const request$ = mode === 'edit'
      ? this.http.post(`${this.apiBaseUrl}/edit_status`, { id, ...payload })
      : this.http.post(`${this.apiBaseUrl}/add_status`, payload);

    return request$.pipe(tap(() => this.invalidateBalances()));
  }

  deleteStatus(id: number): Observable<unknown> {
    return this.http.post(`${this.apiBaseUrl}/delete_status`, { id }).pipe(
      tap(() => this.invalidateBalances()),
    );
  }

  private invalidateBalances(): void {
    this.balanceCache = null;
    this.balanceCacheToken = '';
    this.balanceRequest$ = null;
  }

  private markBalancesChanged(): void {
    this.invalidateBalances();
    this.balanceRevision += 1;
  }

  private sortRows(rows: BalanceRow[]): BalanceRow[] {
    return [...rows].sort((left, right) => {
      const leftTime = new Date(left.datetime).getTime();
      const rightTime = new Date(right.datetime).getTime();
      return leftTime - rightTime;
    });
  }
}
