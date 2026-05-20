import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, finalize, map, of, shareReplay, tap } from 'rxjs';
import { environment } from '../environments/environment';

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

interface MovimentSaveResponse {
  data?: {
    moviment?: Partial<BalanceRow>;
    balance?: BalanceRow[];
    balances?: BalanceRow[];
  };
}

@Injectable({ providedIn: 'root' })
export class FinanceDataService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl;
  private readonly endpoint = `${this.apiBaseUrl}/get_balance`;
  private balanceCache: BalanceRow[] | null = null;
  private balanceRequest$: Observable<BalanceRow[]> | null = null;

  getBalances(forceRefresh = false): Observable<BalanceRow[]> {
    if (!forceRefresh && this.balanceCache) {
      return of(this.balanceCache);
    }

    if (!forceRefresh && this.balanceRequest$) {
      return this.balanceRequest$;
    }

    this.balanceRequest$ = this.http.get<BalanceResponse>(this.endpoint).pipe(
      map(({ data }) => this.sortRows(data ?? [])),
      tap((rows) => (this.balanceCache = rows)),
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
      tap((response) => this.applySaveResponse(response, payload, originalMoviment)),
    );
  }

  deleteMoviment(id: number): Observable<unknown> {
    return this.http.post(`${this.apiBaseUrl}/delete_moviment`, { id }).pipe(
      tap(() => {
        if (!this.balanceCache) {
          return;
        }

        this.balanceCache = this.balanceCache.filter((row) => row.id !== id);
      }),
    );
  }

  private applySaveResponse(
    response: MovimentSaveResponse,
    payload: MovimentPayload,
    originalMoviment: BalanceRow | null,
  ): void {
    const returnedRows = response.data?.balance ?? response.data?.balances;

    if (Array.isArray(returnedRows)) {
      this.balanceCache = this.sortRows(returnedRows);
      return;
    }

    if (!this.balanceCache) {
      return;
    }

    const returnedMoviment = response.data?.moviment;
    const movementId = Number(returnedMoviment?.id ?? originalMoviment?.id);

    if (!Number.isInteger(movementId) || movementId <= 0) {
      return;
    }

    const existingRow = this.balanceCache.find((row) => row.id === movementId) ?? originalMoviment;
    const patchedRow = this.buildPatchedRow(movementId, payload, returnedMoviment, existingRow);
    const withoutExisting = this.balanceCache.filter((row) => row.id !== movementId);
    this.balanceCache = this.sortRows([...withoutExisting, patchedRow]);
  }

  private buildPatchedRow(
    id: number,
    payload: MovimentPayload,
    returnedMoviment: Partial<BalanceRow> | undefined,
    existingRow: BalanceRow | null,
  ): BalanceRow {
    const optionNames = this.getOptionNames();

    return {
      id,
      datetime: returnedMoviment?.datetime ?? payload.datetime,
      description: returnedMoviment?.description ?? payload.description,
      ledger_account_id: Number(returnedMoviment?.ledger_account_id ?? payload.ledger_account),
      ledger_account:
        returnedMoviment?.ledger_account ??
        optionNames.ledgerAccounts.get(payload.ledger_account) ??
        existingRow?.ledger_account ??
        'Ledger account',
      moviment_account_id: Number(returnedMoviment?.moviment_account_id ?? payload.moviment_account),
      moviment_account:
        returnedMoviment?.moviment_account ??
        optionNames.movimentAccounts.get(payload.moviment_account) ??
        existingRow?.moviment_account ??
        'Movement account',
      status_id: Number(returnedMoviment?.status_id ?? payload.status),
      status:
        returnedMoviment?.status ??
        optionNames.statuses.get(payload.status) ??
        existingRow?.status ??
        'Status',
      value: String(returnedMoviment?.value ?? payload.value),
      balances: returnedMoviment?.balances ?? existingRow?.balances ?? {},
    };
  }

  private getOptionNames(): {
    ledgerAccounts: Map<number, string>;
    movimentAccounts: Map<number, string>;
    statuses: Map<number, string>;
  } {
    const ledgerAccounts = new Map<number, string>();
    const movimentAccounts = new Map<number, string>();
    const statuses = new Map<number, string>();

    (this.balanceCache ?? []).forEach((row) => {
      ledgerAccounts.set(row.ledger_account_id, row.ledger_account);
      movimentAccounts.set(row.moviment_account_id, row.moviment_account);
      statuses.set(row.status_id, row.status);
    });

    return { ledgerAccounts, movimentAccounts, statuses };
  }

  private sortRows(rows: BalanceRow[]): BalanceRow[] {
    return [...rows].sort((left, right) => {
      const leftTime = new Date(left.datetime).getTime();
      const rightTime = new Date(right.datetime).getTime();
      return leftTime - rightTime;
    });
  }
}
