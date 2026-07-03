import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonIcon,
  Platform,
  IonRefresher,
  IonRefresherContent,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowDownCircleOutline,
  arrowUpCircleOutline,
  calendarOutline,
  cameraOutline,
  cardOutline,
  cartOutline,
  checkmarkOutline,
  chevronDownOutline,
  chevronForwardOutline,
  closeOutline,
  repeatOutline,
  timeOutline,
} from 'ionicons/icons';
import { finalize, Subscription } from 'rxjs';
import { environment } from '../../environments/environment';
import { BalanceRow, FinanceDataService, PlanningPayload } from '../finance-data.service';

interface MovimentOption {
  id: number;
  name: string;
}

interface MovimentPayload {
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

interface PreparedReceiptImage {
  dataUrl: string;
  originalBytes: number;
  uploadBytes: number;
  width: number;
  height: number;
}

@Component({
  selector: 'app-new-page',
  templateUrl: './new-page.component.html',
  styleUrls: ['./new-page.component.scss'],
  imports: [CommonModule, IonContent, IonIcon, IonRefresher, IonRefresherContent, ReactiveFormsModule],
})
export class NewPageComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly financeData = inject(FinanceDataService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platform = inject(Platform);
  private readonly apiBaseUrl = environment.apiBaseUrl;
  private readonly selectedMovimentStorageKey = 'selectedMoviment';
  private readonly financeFocusStorageKey = 'financeFocusTarget';
  private readonly fallbackStatusOptions: MovimentOption[] = [];
  @ViewChild('receiptInput') private receiptInput?: ElementRef<HTMLInputElement>;
  @ViewChild('valueInput') private valueInput?: ElementRef<HTMLInputElement>;

  protected readonly movimentForm = this.fb.nonNullable.group({
    datetime: ['', Validators.required],
    statusId: [0, [Validators.required, Validators.min(1)]],
    movimentAccountId: [0, [Validators.required, Validators.min(1)]],
    ledgerAccountId: [0, [Validators.required, Validators.min(1)]],
    description: ['', Validators.required],
    value: this.fb.control<number | null>(null, Validators.required),
    recurringDayOfMonth: [1, [Validators.min(1), Validators.max(31)]],
    recurringEndDate: [''],
  });

  protected isEditMode = false;
  protected isLoading = false;
  protected isSaving = false;
  protected isAnalyzingReceipt = false;
  protected errorMessage = '';
  protected receiptMessage = '';
  protected receiptImagePreview = '';
  protected isRecurringOpen = false;
  protected statusOptions: MovimentOption[] = [...this.fallbackStatusOptions];
  protected ledgerAccounts: MovimentOption[] = [];
  protected movimentAccounts: MovimentOption[] = [];
  protected valueSign: -1 | 1 = -1;

  private originalMoviment: BalanceRow | null = null;
  private backButtonSubscription?: Subscription;

  constructor() {
    addIcons({
      arrowDownCircleOutline,
      arrowUpCircleOutline,
      calendarOutline,
      cameraOutline,
      cardOutline,
      cartOutline,
      checkmarkOutline,
      chevronDownOutline,
      chevronForwardOutline,
      closeOutline,
      repeatOutline,
      timeOutline,
    });
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

  ionViewDidEnter(): void {
    this.backButtonSubscription?.unsubscribe();
    this.backButtonSubscription = this.platform.backButton.subscribeWithPriority(10, () => this.cancel());
    setTimeout(() => this.valueInput?.nativeElement.focus(), 150);
  }

  ionViewWillLeave(): void {
    this.backButtonSubscription?.unsubscribe();
    this.backButtonSubscription = undefined;
  }

  ngOnDestroy(): void {
    this.backButtonSubscription?.unsubscribe();
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
      this.resetAddMovimentState();
    }

    this.applyDefaultOptions();
  }

  protected get pageTitle(): string {
    return this.isEditMode ? 'Editar movimento' : 'Novo movimento';
  }

  protected get isSettledStatusSelected(): boolean {
    return this.getSelectedStatusType() !== 'pending';
  }

  protected get settledStatusLabel(): string {
    return this.valueSign === -1 ? 'Pago' : 'Recebido';
  }

  protected get pendingStatusLabel(): string {
    return this.valueSign === -1 ? 'A pagar' : 'A receber';
  }

  protected setSettlementStatus(isSettled: boolean): void {
    const status = isSettled ? this.getSettledStatusOption() : this.getPendingStatusOption();

    if (status) {
      this.movimentForm.controls.statusId.setValue(status.id);
    }
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

  protected toggleRecurring(): void {
    this.isRecurringOpen = !this.isRecurringOpen;
    this.ensureRecurringDefaults();
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
      this.errorMessage = 'Preencha todos os campos do movimento.';
      return;
    }

    if (this.isRecurringOpen && !this.isEditMode) {
      this.saveRecurringMoviment();
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
          sessionStorage.removeItem(this.selectedMovimentStorageKey);
          void this.router.navigate(['/example/finance']);
        },
        error: () => {
          this.errorMessage = this.isEditMode
            ? 'Não foi possível editar o movimento.'
            : 'Não foi possível adicionar o movimento.';
        },
      });
  }

  private saveRecurringMoviment(): void {
    const payload = this.buildRecurringPayload();

    if (!payload) {
      return;
    }

    this.isSaving = true;
    this.financeData
      .savePlanning('add', payload)
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: () => {
          this.storeRecurringFocusTarget(payload.start_datetime);
          sessionStorage.removeItem(this.selectedMovimentStorageKey);
          void this.router.navigate(['/example/finance']);
        },
        error: (error) => {
          this.errorMessage = error?.error?.message ?? 'Não foi possível criar a recorrência.';
        },
      });
  }

  protected cancel(): void {
    sessionStorage.removeItem(this.selectedMovimentStorageKey);
    void this.router.navigate(['/example/finance']);
  }

  protected refreshMovimentOptions(event: CustomEvent): void {
    this.loadMovimentOptions(event);
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
      expandDetails: false,
    }));
  }

  private async analyzeReceipt(file: File): Promise<void> {
    this.isAnalyzingReceipt = true;
    this.receiptMessage = 'A analisar recibo...';

    try {
      const image = await this.prepareReceiptImage(file);
      this.receiptImagePreview = image.dataUrl;
      console.info('[receipt] Image prepared for upload', {
        fileName: file.name,
        fileType: file.type,
        originalBytes: image.originalBytes,
        uploadBytes: image.uploadBytes,
        width: image.width,
        height: image.height,
      });

      this.http
        .post<ReceiptAnalysisResponse>(`${this.apiBaseUrl}/analyze_moviment_receipt`, {
          imageBase64: image.dataUrl,
          ledgerAccounts: this.ledgerAccounts.map((account) => account.name),
        })
        .pipe(finalize(() => (this.isAnalyzingReceipt = false)))
        .subscribe({
          next: ({ data }) => {
            this.applyReceiptGuesses(data.guesses);
            this.receiptMessage = 'Recibo analisado. Reveja os campos sugeridos antes de guardar.';
          },
          error: (error: HttpErrorResponse) => {
            console.error('[receipt] Analysis request failed', {
              url: error.url,
              status: error.status,
              statusText: error.statusText,
              message: error.message,
              serverMessage: error.error?.message,
            });
            this.receiptMessage = error.status
              ? `Não foi possível analisar este recibo. Erro ${error.status}.`
              : 'Não foi possível conectar ao servidor para analisar este recibo.';
          },
        });
    } catch (error) {
      console.error('[receipt] Could not prepare image', error);
      this.isAnalyzingReceipt = false;
      this.receiptMessage = 'Não foi possível ler esta imagem.';
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

  private async prepareReceiptImage(file: File): Promise<PreparedReceiptImage> {
    const sourceDataUrl = await this.fileToDataUrl(file);
    const image = await this.loadImage(sourceDataUrl);
    const maxDimension = 1800;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Canvas is not available');
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

    return {
      dataUrl,
      originalBytes: file.size,
      uploadBytes: this.getDataUrlBytes(dataUrl),
      width,
      height,
    };
  }

  private loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The selected image format could not be opened'));
      image.src = dataUrl;
    });
  }

  private getDataUrlBytes(dataUrl: string): number {
    const base64 = dataUrl.split(',').pop() ?? '';
    return Math.floor(base64.length * 0.75);
  }

  private getMovimentNavigationState(): MovimentNavigationState {
    const routeMode = this.route.snapshot.queryParamMap.get('mode');
    const historyState = window.history.state as MovimentNavigationState;

    if (routeMode === 'edit') {
      return historyState.moviment
        ? historyState
        : this.getStoredMovimentNavigationState();
    }

    sessionStorage.removeItem(this.selectedMovimentStorageKey);
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

  private loadMovimentOptions(refreshEvent?: CustomEvent): void {
    if (this.isLoading) {
      this.completeRefresh(refreshEvent);
      return;
    }

    this.isLoading = true;

    this.financeData
      .getFinanceSettings()
      .pipe(finalize(() => {
        this.isLoading = false;
        this.completeRefresh(refreshEvent);
      }))
      .subscribe({
        next: (data) => {
          const selectedStatusName = this.statusOptions.find(
            (status) => status.id === this.movimentForm.controls.statusId.value,
          )?.name;

          this.ledgerAccounts = this.mergeOptions(
            this.ledgerAccounts,
            data.ledgerAccounts.map((row) => this.toOption(row.id, row.description)),
          );
          this.movimentAccounts = this.mergeOptions(
            this.movimentAccounts,
            data.accounts.map((row) => this.toOption(row.id, row.description)),
          );
          this.statusOptions = this.mergeOptions(
            this.statusOptions,
            data.statuses.map((row) => this.toOption(row.id, row.description)),
          );
          this.syncSelectedStatus(selectedStatusName);
          this.applyDefaultOptions();
        },
        error: () => {
          this.applyDefaultOptions();
        },
      });
  }

  private completeRefresh(event?: CustomEvent): void {
    const refresher = event?.target as unknown as { complete?: () => Promise<void> | void };
    void refresher?.complete?.();
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
    this.isRecurringOpen = false;
  }

  private resetAddMovimentState(): void {
    const now = new Date();
    const endDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    this.isEditMode = false;
    this.originalMoviment = null;
    this.errorMessage = '';
    this.receiptMessage = '';
    this.receiptImagePreview = '';
    this.isRecurringOpen = false;
    this.valueSign = -1;
    this.movimentForm.reset({
      datetime: this.toDatetimeLocalValue(now.toISOString()),
      statusId: this.statusOptions[0]?.id ?? 0,
      movimentAccountId: 0,
      ledgerAccountId: 0,
      description: '',
      value: null,
      recurringDayOfMonth: now.getDate(),
      recurringEndDate: this.toDateInputValue(endDate),
    });
    sessionStorage.removeItem(this.selectedMovimentStorageKey);
  }

  private applyDefaultOptions(): void {
    if (!this.movimentForm.controls.statusId.value && this.statusOptions.length > 0) {
      this.movimentForm.controls.statusId.setValue(
        this.getSettledStatusOption()?.id ?? this.statusOptions[0].id,
      );
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
      datetime: formValue.datetime,
      description: formValue.description.trim(),
      ledger_account: formValue.ledgerAccountId,
      moviment_account: formValue.movimentAccountId,
      status: formValue.statusId,
      value: Math.abs(Number(formValue.value)) * this.valueSign,
    };
  }

  private buildRecurringPayload(): PlanningPayload | null {
    const formValue = this.movimentForm.getRawValue();
    const startDate = formValue.datetime.slice(0, 10);

    if (!formValue.recurringDayOfMonth || !formValue.recurringEndDate) {
      this.errorMessage = 'Preencha os campos da recorrência.';
      return null;
    }

    if (formValue.recurringEndDate < startDate) {
      this.errorMessage = 'A data final deve ser igual ou posterior ao primeiro lançamento.';
      return null;
    }

    return {
      start_datetime: formValue.datetime,
      end_date: formValue.recurringEndDate,
      day_of_month: formValue.recurringDayOfMonth,
      description: formValue.description.trim(),
      ledger_account: formValue.ledgerAccountId,
      moviment_account: formValue.movimentAccountId,
      value: Math.abs(Number(formValue.value)) * this.valueSign,
    };
  }

  private ensureRecurringDefaults(): void {
    const formValue = this.movimentForm.getRawValue();
    const movementDate = new Date(formValue.datetime || new Date().toISOString());
    const safeDate = Number.isNaN(movementDate.getTime()) ? new Date() : movementDate;

    if (!formValue.recurringDayOfMonth) {
      this.movimentForm.controls.recurringDayOfMonth.setValue(safeDate.getDate());
    }

    if (!formValue.recurringEndDate) {
      const endDate = new Date(safeDate.getFullYear() + 1, safeDate.getMonth(), safeDate.getDate());
      this.movimentForm.controls.recurringEndDate.setValue(this.toDateInputValue(endDate));
    }
  }

  private storeRecurringFocusTarget(datetime: string): void {
    const dayKey = this.getDateKey(datetime);

    sessionStorage.setItem(this.financeFocusStorageKey, JSON.stringify({
      datetime,
      preferPast: false,
      dayKey,
      monthKey: dayKey.slice(0, 7),
      expandDetails: false,
    }));
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
    this.movimentForm.controls.statusId.setValue(
      matchingStatus?.id ?? this.getSettledStatusOption()?.id ?? this.statusOptions[0]?.id ?? 0,
    );
  }

  private getSelectedStatusType(): 'settled' | 'pending' {
    const selectedStatus = this.statusOptions.find(
      (status) => status.id === this.movimentForm.controls.statusId.value,
    );

    return this.isPendingStatus(selectedStatus) ? 'pending' : 'settled';
  }

  private getSettledStatusOption(): MovimentOption | undefined {
    return this.statusOptions.find((status) => !this.isPendingStatus(status));
  }

  private getPendingStatusOption(): MovimentOption | undefined {
    return this.statusOptions.find((status) => this.isPendingStatus(status));
  }

  private isPendingStatus(status: MovimentOption | undefined): boolean {
    const normalizedStatus = this.normalizeStatusName(status?.name);

    return normalizedStatus.includes('provision') ||
      normalizedStatus.includes('pagar') ||
      normalizedStatus.includes('receber') ||
      normalizedStatus.includes('pending');
  }

  private normalizeStatusName(status: string | null | undefined): string {
    return (status ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('pt-BR');
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

  private toDateInputValue(date: Date): string {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
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
