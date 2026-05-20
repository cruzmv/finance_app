import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBackOutline, cameraOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { finalize } from 'rxjs';
import { environment } from '../../environments/environment';
import { BalanceRow, FinanceDataService } from '../finance-data.service';

interface MovimentOption {
  id: number;
  name: string;
}

interface MovimentPayload {
  contract: number;
  user: number;
  datetime: string;
  description: string;
  ledger_account: number;
  moviment_account: number;
  status: number;
  value: number;
}

interface MovimentNavigationState {
  mode?: 'add' | 'edit';
  moviment?: BalanceRow | null;
  ledgerAccounts?: MovimentOption[] | string[];
  movimentAccounts?: MovimentOption[] | string[];
  statuses?: MovimentOption[] | string[];
}

interface ReceiptAnalysisResponse {
  data: {
    guesses: {
      valor: number | null;
      descricao: string;
      plano_conta: string;
    };
  };
}

interface MovimentSaveResponse {
  data?: {
    moviment?: {
      id?: number;
      datetime?: string;
    };
  };
}

@Component({
  selector: 'app-new-page',
  templateUrl: './new-page.component.html',
  styleUrls: ['./new-page.component.scss'],
  imports: [CommonModule, IonContent, IonIcon, ReactiveFormsModule],
})
export class NewPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly financeData = inject(FinanceDataService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly apiBaseUrl = environment.apiBaseUrl;
  private readonly selectedMovimentStorageKey = 'selectedMoviment';
  private readonly financeFocusStorageKey = 'financeFocusTarget';
  private readonly contractId = 1;
  private readonly userId = 1;
  private readonly fallbackStatusOptions: MovimentOption[] = [];
  @ViewChild('receiptInput') private receiptInput?: ElementRef<HTMLInputElement>;

  protected readonly movimentForm = this.fb.nonNullable.group({
    datetime: ['', Validators.required],
    statusId: [0, [Validators.required, Validators.min(1)]],
    movimentAccountId: [0, [Validators.required, Validators.min(1)]],
    ledgerAccountId: [0, [Validators.required, Validators.min(1)]],
    description: ['', Validators.required],
    value: this.fb.control<number | null>(null, Validators.required),
  });

  protected isEditMode = false;
  protected isLoading = false;
  protected isSaving = false;
  protected isAnalyzingReceipt = false;
  protected errorMessage = '';
  protected receiptMessage = '';
  protected receiptImagePreview = '';
  protected statusOptions: MovimentOption[] = [...this.fallbackStatusOptions];
  protected ledgerAccounts: MovimentOption[] = [];
  protected movimentAccounts: MovimentOption[] = [];
  protected valueSign: -1 | 1 = -1;

  private originalMoviment: BalanceRow | null = null;

  constructor() {
    addIcons({ arrowBackOutline, cameraOutline, checkmarkCircleOutline });
  }

  ngOnInit() {
    this.hydratePageState();
    this.loadMovimentOptions();
  }

  ionViewWillEnter() {
    this.hydratePageState();

    if (this.hasMissingOptions()) {
      this.loadMovimentOptions();
    }
  }

  private hydratePageState(): void {
    const navigationState = this.getMovimentNavigationState();
    const navigationStatuses = this.normalizeOptions(navigationState.statuses ?? []);
    const navigationLedgerAccounts = this.normalizeOptions(navigationState.ledgerAccounts ?? []);
    const navigationMovimentAccounts = this.normalizeOptions(navigationState.movimentAccounts ?? []);
    this.isEditMode = navigationState.mode === 'edit';
    this.originalMoviment = navigationState.moviment ?? null;
    this.statusOptions = this.mergeOptions(
      this.mergeOptions(this.fallbackStatusOptions, this.statusOptions),
      navigationStatuses,
    );
    this.ledgerAccounts = this.mergeOptions(
      this.ledgerAccounts,
      navigationLedgerAccounts,
    );
    this.movimentAccounts = this.mergeOptions(
      this.movimentAccounts,
      navigationMovimentAccounts,
    );

    if (this.originalMoviment) {
      this.fillFormFromMoviment(this.originalMoviment);
    } else {
      this.movimentForm.reset({
        datetime: '',
        statusId: this.statusOptions[0]?.id ?? 0,
        movimentAccountId: 0,
        ledgerAccountId: 0,
        description: '',
        value: null,
      });
      this.valueSign = -1;
      this.movimentForm.patchValue({
        datetime: this.toDatetimeLocalValue(new Date().toISOString()),
      });
      sessionStorage.removeItem(this.selectedMovimentStorageKey);
    }

    this.applyDefaultOptions();
  }

  protected get pageTitle(): string {
    return this.isEditMode ? 'Edit movement' : 'New movement';
  }

  protected get statusList(): MovimentOption[] {
    return this.statusOptions;
  }

  protected selectStatus(status: MovimentOption): void {
    this.movimentForm.controls.statusId.setValue(status.id);
  }

  protected selectMovimentAccount(account: MovimentOption): void {
    this.movimentForm.controls.movimentAccountId.setValue(account.id);
  }

  protected selectLedgerAccount(account: MovimentOption): void {
    this.movimentForm.controls.ledgerAccountId.setValue(account.id);
  }

  protected setValueSign(sign: -1 | 1): void {
    this.valueSign = sign;
  }

  protected openReceiptCapture(): void {
    this.receiptInput?.nativeElement.click();
  }

  protected onReceiptSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    void this.analyzeReceipt(file);
    input.value = '';
  }

  protected saveMoviment(): void {
    this.movimentForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.movimentForm.invalid) {
      this.errorMessage = 'Please fill all movement fields.';
      return;
    }

    const payload = this.buildPayload();
    this.isSaving = true;
    this.financeData
      .saveMoviment(this.isEditMode ? 'edit' : 'add', payload, this.originalMoviment)
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: (response: MovimentSaveResponse) => {
          this.storeFinanceFocusTarget(response);
          void this.router.navigate(['/example/finance']);
        },
        error: () => {
          this.errorMessage = this.isEditMode
            ? 'Unable to edit movement.'
            : 'Unable to add movement.';
        },
      });
  }

  protected cancel(): void {
    sessionStorage.removeItem(this.selectedMovimentStorageKey);
    void this.router.navigate(['/example/finance']);
  }

  private storeFinanceFocusTarget(response: MovimentSaveResponse): void {
    const movement = response.data?.moviment;
    const movementId = Number(movement?.id);
    const datetime = movement?.datetime ?? this.movimentForm.controls.datetime.value;
    const dayKey = this.getDateKey(datetime);

    sessionStorage.setItem(this.financeFocusStorageKey, JSON.stringify({
      movementId: Number.isInteger(movementId) && movementId > 0 ? movementId : undefined,
      dayKey,
      monthKey: dayKey.slice(0, 7),
    }));
  }

  private async analyzeReceipt(file: File): Promise<void> {
    this.isAnalyzingReceipt = true;
    this.receiptMessage = 'Reading receipt...';

    try {
      const imageBase64 = await this.fileToDataUrl(file);
      this.receiptImagePreview = imageBase64;

      this.http
        .post<ReceiptAnalysisResponse>(`${this.apiBaseUrl}/analyze_moviment_receipt`, {
          imageBase64,
          ledgerAccounts: this.ledgerAccounts.map((account) => account.name),
        })
        .pipe(finalize(() => (this.isAnalyzingReceipt = false)))
        .subscribe({
          next: ({ data }) => {
            this.applyReceiptGuesses(data.guesses);
            this.receiptMessage = 'Receipt analyzed. Please review the guessed fields before saving.';
          },
          error: (error: any) => {
            this.receiptMessage = 'Unable to analyze this receipt.';
          },
        });
    } catch {
      this.isAnalyzingReceipt = false;
      this.receiptMessage = 'Unable to read this image.';
    }
  }

  private applyReceiptGuesses(guesses: ReceiptAnalysisResponse['data']['guesses']): void {
    if (guesses.valor !== null) {
      this.valueSign = guesses.valor < 0 ? -1 : 1;
      this.movimentForm.controls.value.setValue(Math.abs(guesses.valor));
    }

    if (guesses.descricao) {
      this.movimentForm.controls.description.setValue(guesses.descricao);
    }

    if (guesses.plano_conta) {
      const guessedLedger = this.ledgerAccounts.find(
        (account) => account.name.toLowerCase() === guesses.plano_conta.toLowerCase(),
      );

      if (guessedLedger) {
        this.selectLedgerAccount(guessedLedger);
      }
    }
  }

  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  private getMovimentNavigationState(): MovimentNavigationState {
    const routeMode = this.route.snapshot.queryParamMap.get('mode');
    const historyState = window.history.state as MovimentNavigationState;

    if (routeMode === 'edit') {
      return historyState.moviment
        ? historyState
        : this.getStoredMovimentNavigationState();
    }

    return { mode: 'add' };
  }

  private getStoredMovimentNavigationState(): MovimentNavigationState {
    const storedState = sessionStorage.getItem(this.selectedMovimentStorageKey);

    if (!storedState) {
      return { mode: 'add' };
    }

    try {
      return JSON.parse(storedState) as MovimentNavigationState;
    } catch {
      sessionStorage.removeItem(this.selectedMovimentStorageKey);
      return { mode: 'add' };
    }
  }

  private loadMovimentOptions(): void {
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;

    this.financeData
      .getBalances()
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (data) => {
          const selectedStatusName = this.statusOptions.find(
            (status) => status.id === this.movimentForm.controls.statusId.value,
          )?.name;

          this.ledgerAccounts = this.mergeOptions(
            this.ledgerAccounts,
            data.map((row) => this.toOption(row.ledger_account_id, row.ledger_account)),
          );
          this.movimentAccounts = this.mergeOptions(
            this.movimentAccounts,
            data.map((row) => this.toOption(row.moviment_account_id, row.moviment_account)),
          );
          this.statusOptions = this.mergeOptions(
            this.statusOptions,
            data.map((row) => this.toOption(row.status_id, row.status)),
          );
          this.syncSelectedStatus(selectedStatusName);
          this.applyDefaultOptions();
        },
        error: () => {
          this.applyDefaultOptions();
        },
      });
  }

  private hasMissingOptions(): boolean {
    return (
      this.statusOptions.length === 0 ||
      this.movimentAccounts.length === 0 ||
      this.ledgerAccounts.length === 0
    );
  }

  private fillFormFromMoviment(moviment: BalanceRow): void {
    this.movimentForm.patchValue({
      datetime: this.toDatetimeLocalValue(moviment.datetime),
      statusId: moviment.status_id,
      movimentAccountId: moviment.moviment_account_id,
      ledgerAccountId: moviment.ledger_account_id,
      description: moviment.description,
      value: Math.abs(Number(moviment.value)),
    });
    this.valueSign = Number(moviment.value) < 0 ? -1 : 1;
  }

  private applyDefaultOptions(): void {
    if (!this.movimentForm.controls.statusId.value && this.statusOptions.length > 0) {
      this.movimentForm.controls.statusId.setValue(this.statusOptions[0].id);
    }

    if (!this.movimentForm.controls.movimentAccountId.value && this.movimentAccounts.length > 0) {
      this.movimentForm.controls.movimentAccountId.setValue(this.movimentAccounts[0].id);
    }

    if (!this.movimentForm.controls.ledgerAccountId.value && this.ledgerAccounts.length > 0) {
      this.movimentForm.controls.ledgerAccountId.setValue(this.ledgerAccounts[0].id);
    }
  }

  private buildPayload(): MovimentPayload {
    const formValue = this.movimentForm.getRawValue();

    return {
      contract: this.contractId,
      user: this.userId,
      datetime: formValue.datetime,
      description: formValue.description.trim(),
      ledger_account: formValue.ledgerAccountId,
      moviment_account: formValue.movimentAccountId,
      status: formValue.statusId,
      value: Math.abs(Number(formValue.value)) * this.valueSign,
    };
  }

  private mergeOptions(currentOptions: MovimentOption[], nextOptions: MovimentOption[]): MovimentOption[] {
    const optionMap = new Map<string, MovimentOption>();

    [...currentOptions, ...nextOptions]
      .filter((option) => option.id > 0 && option.name)
      .forEach((option) => optionMap.set(option.name.toLowerCase(), option));

    return Array.from(optionMap.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  private syncSelectedStatus(selectedStatusName: string | undefined): void {
    const selectedStatusId = this.movimentForm.controls.statusId.value;
    const selectedStatusStillExists = this.statusOptions.some((status) => status.id === selectedStatusId);

    if (selectedStatusStillExists) {
      return;
    }

    const matchingStatus = this.statusOptions.find((status) => status.name === selectedStatusName);
    this.movimentForm.controls.statusId.setValue(matchingStatus?.id ?? this.statusOptions[0]?.id ?? 0);
  }

  private normalizeOptions(options: MovimentOption[] | string[]): MovimentOption[] {
    return options
      .map((option, index) => {
        if (typeof option === 'string') {
          return this.toOption(index + 1, option);
        }

        return this.toOption(option.id, option.name);
      })
      .filter((option) => option.id > 0 && option.name);
  }

  private toOption(id: number, name: string): MovimentOption {
    return {
      id: Number(id) || 0,
      name: name?.trim() ?? '',
    };
  }

  private toDatetimeLocalValue(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toISOString().slice(0, 16);
  }

  private getDateKey(value: string): string {
    const date = new Date(value);

    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }
}
