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
  addCircleOutline,
  airplaneOutline,
  alertCircleOutline,
  arrowDownCircleOutline,
  arrowUpCircleOutline,
  barcodeOutline,
  bonfireOutline,
  businessOutline,
  calendarOutline,
  cameraOutline,
  carOutline,
  cardOutline,
  cartOutline,
  cashOutline,
  checkmarkOutline,
  checkmarkCircleOutline,
  chevronDownOutline,
  chevronForwardOutline,
  closeOutline,
  ellipsisHorizontalOutline,
  fastFoodOutline,
  gameControllerOutline,
  homeOutline,
  informationCircleOutline,
  medkitOutline,
  qrCodeOutline,
  repeatOutline,
  receiptOutline,
  restaurantOutline,
  saveOutline,
  schoolOutline,
  storefrontOutline,
  timeOutline,
  trailSignOutline,
  trashOutline,
  trendingDownOutline,
  trendingUpOutline,
  walletOutline,
} from 'ionicons/icons';
import { catchError, finalize, forkJoin, map, of, Subscription, switchMap, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth.service';
import {
  BalanceRow,
  CreditBillSyncMissingBill,
  CreditBillSyncResponse,
  FinanceDataService,
  MovimentAccountSettings,
  PlanningPayload,
} from '../finance-data.service';
import { CurrencySettingsService } from '../currency-settings.service';
import { getCreditBillSettings } from '../credit-bill-settings';

interface MovimentOption {
  id: number;
  name: string;
  icon?: string | null;
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

interface CreditBillCycle {
  closingDate: Date;
  dueDate: Date;
  cycleKey: string;
  dueMonthLabel: string;
}

interface LocalCreditBill extends CreditBillSyncMissingBill {
  hasBill: boolean;
}

interface CreditBillPromptState {
  bills: CreditBillSyncMissingBill[];
  total: number;
  dueDateLabel: string;
  accountName: string;
  hideExplanation: boolean;
  compact: boolean;
}

interface PreparedReceiptImage {
  dataUrl: string;
  originalBytes: number;
  uploadBytes: number;
  width: number;
  height: number;
}

interface BarcodeDetectionResult {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorConstructor {
  new(options?: { formats?: string[] }): {
    detect(source: CanvasImageSource): Promise<BarcodeDetectionResult[]>;
  };
  getSupportedFormats?: () => Promise<string[]>;
}

type NewMovementSource = 'dashboard' | 'finance' | 'generic';
type QuickCreateTarget = 'account' | 'ledger';

interface IconOption {
  name: string;
  label: string;
}

@Component({
  selector: 'app-new-page',
  templateUrl: './new-page.component.html',
  styleUrls: ['./new-page.component.scss'],
  imports: [CommonModule, IonContent, IonIcon, IonRefresher, IonRefresherContent, ReactiveFormsModule],
})
export class NewPageComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly financeData = inject(FinanceDataService);
  private readonly currencySettings = inject(CurrencySettingsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platform = inject(Platform);
  private readonly apiBaseUrl = environment.apiBaseUrl;
  private readonly selectedMovimentStorageKey = 'selectedMoviment';
  private readonly financeFocusStorageKey = 'financeFocusTarget';
  private readonly creditBillPromptPreferenceKey = 'hideCreditBillPromptExplanation';
  private readonly creditBillUpdateHintStorageKey = 'financeCreditBillHint';
  private readonly newMovementSourceStorageKey = 'newMovementSourceRoute';
  private readonly lastMovimentAccountStorageKey = 'newMovementLastMovimentAccountId';
  private readonly lastLedgerAccountStorageKey = 'newMovementLastLedgerAccountId';
  private readonly fallbackStatusOptions: MovimentOption[] = [];
  private readonly availableIconNames = new Set([
    'airplane-outline',
    'alert-circle-outline',
    'bonfire-outline',
    'business-outline',
    'car-outline',
    'card-outline',
    'cart-outline',
    'cash-outline',
    'checkmark-circle-outline',
    'ellipsis-horizontal-outline',
    'fast-food-outline',
    'game-controller-outline',
    'home-outline',
    'medkit-outline',
    'receipt-outline',
    'restaurant-outline',
    'school-outline',
    'storefront-outline',
    'time-outline',
    'trail-sign-outline',
    'trending-down-outline',
    'trending-up-outline',
    'wallet-outline',
  ]);
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
  protected receiptCodeValue = '';
  protected receiptCodeFormat = '';
  protected isRecurringOpen = false;
  protected pendingCreditBillPrompt: CreditBillPromptState | null = null;
  protected isCreditBillPromptSaving = false;
  protected statusOptions: MovimentOption[] = [...this.fallbackStatusOptions];
  protected ledgerAccounts: MovimentOption[] = [];
  protected movimentAccounts: MovimentOption[] = [];
  protected valueSign: -1 | 1 = -1;
  protected currentStep: 1 | 2 | 3 = 1;
  protected sourceContext: NewMovementSource = 'dashboard';
  protected usedMovimentAccountIds = new Set<number>();
  protected usedLedgerAccountIds = new Set<number>();
  protected quickCreateTarget: QuickCreateTarget | null = null;
  protected activeQuickIconPicker: QuickCreateTarget | null = null;
  protected readonly iconOptions: IconOption[] = [
    { name: 'wallet-outline', label: 'Carteira' },
    { name: 'card-outline', label: 'Cartão' },
    { name: 'cash-outline', label: 'Dinheiro' },
    { name: 'business-outline', label: 'Banco' },
    { name: 'home-outline', label: 'Casa' },
    { name: 'restaurant-outline', label: 'Alimentação' },
    { name: 'cart-outline', label: 'Compras' },
    { name: 'car-outline', label: 'Transporte' },
    { name: 'airplane-outline', label: 'Viagem' },
    { name: 'medkit-outline', label: 'Saúde' },
    { name: 'school-outline', label: 'Educação' },
    { name: 'game-controller-outline', label: 'Lazer' },
    { name: 'receipt-outline', label: 'Recibo' },
    { name: 'trending-up-outline', label: 'Entrada' },
    { name: 'trending-down-outline', label: 'Saída' },
    { name: 'checkmark-circle-outline', label: 'Confirmado' },
    { name: 'time-outline', label: 'Pendente' },
    { name: 'alert-circle-outline', label: 'Atenção' },
  ];

  protected readonly quickAccountForm = this.fb.nonNullable.group({
    description: ['', Validators.required],
    icon: ['wallet-outline', Validators.required],
    startDate: [''],
    startValue: this.fb.control<number | null>(null),
    closingDay: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(31)]),
    payDay: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(31)]),
    debitAccount: this.fb.control<number | null>(null),
    accountType: this.fb.nonNullable.control<0 | 1>(0, Validators.required),
  });

  protected readonly quickLedgerForm = this.fb.nonNullable.group({
    description: ['', Validators.required],
    icon: ['receipt-outline', Validators.required],
  });

  private readonly host = inject(ElementRef<HTMLElement>);
  private originalMoviment: BalanceRow | null = null;
  private backButtonSubscription?: Subscription;
  private movimentAccountTypes = new Map<number, 0 | 1>();

  constructor() {
    addIcons({
      addCircleOutline,
      airplaneOutline,
      alertCircleOutline,
      arrowDownCircleOutline,
      arrowUpCircleOutline,
      barcodeOutline,
      bonfireOutline,
      businessOutline,
      calendarOutline,
      cameraOutline,
      carOutline,
      cardOutline,
      cartOutline,
      cashOutline,
      checkmarkOutline,
      checkmarkCircleOutline,
      chevronDownOutline,
      chevronForwardOutline,
      closeOutline,
      ellipsisHorizontalOutline,
      fastFoodOutline,
      gameControllerOutline,
      homeOutline,
      informationCircleOutline,
      medkitOutline,
      qrCodeOutline,
      repeatOutline,
      receiptOutline,
      restaurantOutline,
      saveOutline,
      schoolOutline,
      storefrontOutline,
      timeOutline,
      trailSignOutline,
      trashOutline,
      trendingDownOutline,
      trendingUpOutline,
      walletOutline,
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
    this.backButtonSubscription = this.platform.backButton.subscribeWithPriority(10, () => this.handleBackAction());

    if (this.currentStep === 3) {
      setTimeout(() => this.valueInput?.nativeElement.focus(), 150);
    }
  }

  ionViewWillLeave(): void {
    this.clearCreditBillPrompt();
    this.backButtonSubscription?.unsubscribe();
    this.backButtonSubscription = undefined;
  }

  ngOnDestroy(): void {
    this.clearCreditBillPrompt();
    this.backButtonSubscription?.unsubscribe();
  }

  private hydratePageState(): void {
    const navigationState = this.getMovimentNavigationState();
    this.sourceContext = this.getSourceContext();
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

  protected get username(): string {
    return this.auth.user?.username || 'Usuário';
  }

  protected get selectedMonthSummaryLabel(): string {
    const now = new Date();
    const month = new Intl.DateTimeFormat('pt-PT', { month: 'long' }).format(now);
    const label = month.charAt(0).toLocaleUpperCase('pt-PT') + month.slice(1);

    return `${label} ${now.getFullYear()}`;
  }

  protected get backdropClass(): string {
    return `source-${this.sourceContext}`;
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

  protected get typeLabel(): string {
    return this.valueSign === -1 ? 'Despesa' : 'Receita';
  }

  protected get typeDescription(): string {
    return this.valueSign === -1
      ? 'Gastos, contas, compras e outras saídas.'
      : 'Salário, vendas, reembolsos e outras entradas.';
  }

  protected get typeIcon(): string {
    return this.valueSign === -1 ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline';
  }

  protected get typeTone(): 'expense' | 'income' {
    return this.valueSign === -1 ? 'expense' : 'income';
  }

  protected get statusLabel(): string {
    return this.isSettledStatusSelected ? this.settledStatusLabel : this.pendingStatusLabel;
  }

  protected get currencySymbol(): string {
    return this.currencySettings.option.symbol;
  }

  protected setSettlementStatus(isSettled: boolean): void {
    const status = isSettled ? this.getSettledStatusOption() : this.getPendingStatusOption();

    if (status) {
      this.movimentForm.controls.statusId.setValue(status.id);
    }
  }

  protected toggleEditSettlementStatus(): void {
    this.setSettlementStatus(!this.isSettledStatusSelected);
  }

  protected selectMovementType(sign: -1 | 1): void {
    this.setValueSign(sign);
    this.currentStep = 2;
  }

  protected selectSettlementAndContinue(isSettled: boolean): void {
    this.setSettlementStatus(isSettled);
    this.currentStep = 3;
    setTimeout(() => this.valueInput?.nativeElement.focus(), 150);
    this.scheduleSelectedOptionFocus();
  }

  protected handleBackAction(): void {
    if (this.isEditMode || this.currentStep === 1) {
      this.cancel();
      return;
    }

    this.currentStep = this.currentStep === 3 ? 2 : 1;
  }

  protected selectMovimentAccount(account: MovimentOption): void {
    this.movimentForm.controls.movimentAccountId.setValue(account.id);
    this.rememberSelectedOptions();
  }

  protected selectLedgerAccount(account: MovimentOption): void {
    this.movimentForm.controls.ledgerAccountId.setValue(account.id);
    this.rememberSelectedOptions();
  }

  protected getLedgerAccountIcon(account: MovimentOption): string {
    return this.normalizeIcon(account.icon, 'receipt-outline');
  }

  protected getMovimentAccountIcon(account: MovimentOption): string {
    return this.normalizeIcon(account.icon, 'card-outline');
  }

  protected canDeleteMovimentAccount(account: MovimentOption): boolean {
    return !this.usedMovimentAccountIds.has(account.id);
  }

  protected canDeleteLedgerAccount(account: MovimentOption): boolean {
    return !this.usedLedgerAccountIds.has(account.id);
  }

  protected addMovimentAccount(): void {
    this.openQuickCreate('account');
  }

  protected addLedgerAccount(): void {
    this.openQuickCreate('ledger');
  }

  protected deleteMovimentAccount(account: MovimentOption, event: Event): void {
    event.stopPropagation();

    if (!this.canDeleteMovimentAccount(account)) {
      return;
    }

    if (!window.confirm(`Excluir a conta "${account.name}"?`)) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.financeData
      .deleteMovimentAccount(account.id)
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: () => {
          if (this.movimentForm.controls.movimentAccountId.value === account.id) {
            this.movimentForm.controls.movimentAccountId.setValue(0);
          }

          this.movimentAccounts = this.movimentAccounts.filter((item) => item.id !== account.id);
          this.movimentAccountTypes.delete(account.id);

          if (this.getStoredOptionId(this.lastMovimentAccountStorageKey) === account.id) {
            localStorage.removeItem(this.lastMovimentAccountStorageKey);
          }

          this.isLoading = false;
          this.loadMovimentOptions();
        },
        error: () => {
          this.errorMessage = 'Não foi possível excluir a conta.';
        },
      });
  }

  protected deleteLedgerAccount(account: MovimentOption, event: Event): void {
    event.stopPropagation();

    if (!this.canDeleteLedgerAccount(account)) {
      return;
    }

    if (!window.confirm(`Excluir a categoria "${account.name}"?`)) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.financeData
      .deleteLedgerAccount(account.id)
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: () => {
          if (this.movimentForm.controls.ledgerAccountId.value === account.id) {
            this.movimentForm.controls.ledgerAccountId.setValue(0);
          }

          this.ledgerAccounts = this.ledgerAccounts.filter((item) => item.id !== account.id);

          if (this.getStoredOptionId(this.lastLedgerAccountStorageKey) === account.id) {
            localStorage.removeItem(this.lastLedgerAccountStorageKey);
          }

          this.isLoading = false;
          this.loadMovimentOptions();
        },
        error: () => {
          this.errorMessage = 'Não foi possível excluir a categoria.';
        },
      });
  }

  protected get debitAccountOptions(): MovimentOption[] {
    return this.movimentAccounts.filter((account) => {
      return this.movimentAccountTypes.get(account.id) === 0;
    });
  }

  protected getQuickIconLabel(icon: string | null | undefined, fallbackIcon: string): string {
    const normalizedIcon = this.normalizeIcon(icon, fallbackIcon);
    return this.iconOptions.find((option) => option.name === normalizedIcon)?.label ?? 'Ícone';
  }

  protected getQuickIcon(icon: string | null | undefined, fallbackIcon: string): string {
    return this.normalizeIcon(icon, fallbackIcon);
  }

  protected toggleQuickIconPicker(target: QuickCreateTarget): void {
    this.activeQuickIconPicker = this.activeQuickIconPicker === target ? null : target;
  }

  protected selectQuickIcon(target: QuickCreateTarget, icon: string): void {
    const normalizedIcon = this.normalizeIcon(icon, target === 'account' ? 'wallet-outline' : 'receipt-outline');

    if (target === 'account') {
      this.quickAccountForm.controls.icon.setValue(normalizedIcon);
    } else {
      this.quickLedgerForm.controls.icon.setValue(normalizedIcon);
    }

    this.activeQuickIconPicker = null;
  }

  protected closeQuickCreate(): void {
    this.quickCreateTarget = null;
    this.activeQuickIconPicker = null;
    this.quickAccountForm.reset({
      description: '',
      icon: 'wallet-outline',
      startDate: '',
      startValue: null,
      closingDay: null,
      payDay: null,
      debitAccount: null,
      accountType: 0,
    });
    this.quickLedgerForm.reset({
      description: '',
      icon: 'receipt-outline',
    });
  }

  protected saveQuickAccount(): void {
    this.quickAccountForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.quickAccountForm.invalid) {
      this.errorMessage = 'Preencha os campos obrigatórios da conta.';
      return;
    }

    const formValue = this.quickAccountForm.getRawValue();
    const description = formValue.description.trim();

    if (!description) {
      this.errorMessage = 'Preencha o nome da conta.';
      return;
    }

    if (this.hasOptionNamed(this.movimentAccounts, description)) {
      this.errorMessage = 'Já existe uma conta com este nome.';
      return;
    }

    if (formValue.accountType === 1 && (!formValue.payDay || !formValue.debitAccount)) {
      this.errorMessage = 'Preencha o dia de pagamento e a conta de débito do cartão.';
      return;
    }

    this.isSaving = true;
    this.financeData
      .saveMovimentAccount('add', {
        description,
        icon: this.normalizeIcon(formValue.icon, 'wallet-outline'),
        start_date: formValue.startDate || null,
        start_value: formValue.startValue,
        closing_day: formValue.closingDay,
        pay_day: formValue.accountType === 1 ? formValue.payDay : null,
        debit_account: formValue.accountType === 1 ? formValue.debitAccount : null,
        account_type: formValue.accountType,
      })
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: () => {
          this.closeQuickCreate();
          this.reloadOptionsAndSelect('account', description);
        },
        error: () => {
          this.errorMessage = 'Não foi possível criar a conta.';
        },
      });
  }

  protected saveQuickLedger(): void {
    this.quickLedgerForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.quickLedgerForm.invalid) {
      this.errorMessage = 'Preencha os campos obrigatórios da categoria.';
      return;
    }

    const description = this.quickLedgerForm.controls.description.value.trim();

    if (!description) {
      this.errorMessage = 'Preencha o nome da categoria.';
      return;
    }

    if (this.hasOptionNamed(this.ledgerAccounts, description)) {
      this.errorMessage = 'Já existe uma categoria com este nome.';
      return;
    }

    this.isSaving = true;
    this.financeData
      .saveLedgerAccount('add', {
        description,
        icon: this.normalizeIcon(this.quickLedgerForm.controls.icon.value, 'receipt-outline'),
      })
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: () => {
          this.closeQuickCreate();
          this.reloadOptionsAndSelect('ledger', description);
        },
        error: () => {
          this.errorMessage = 'Não foi possível criar a categoria.';
        },
      });
  }

  protected setValueSign(sign: -1 | 1): void {
    this.valueSign = sign;
    this.setSettlementStatus(this.isSettledStatusSelected);
  }

  protected openQuickCreate(target: QuickCreateTarget): void {
    this.errorMessage = '';
    this.activeQuickIconPicker = null;
    this.quickCreateTarget = target;
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

    if (!this.movimentForm.controls.description.value.trim()) {
      this.errorMessage = 'Preencha a descrição do movimento.';
      return;
    }

    this.rememberSelectedOptions();

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
          this.finishMovimentSave(response);
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
    this.receiptMessage = 'A analisar recibo, QR Code e código de barras...';
    this.receiptCodeValue = '';
    this.receiptCodeFormat = '';

    try {
      const image = await this.prepareReceiptImage(file);
      this.receiptImagePreview = image.dataUrl;
      const detectedCodes = await this.detectReceiptCodes(image.dataUrl);
      const firstCode = detectedCodes[0];

      if (firstCode) {
        this.receiptCodeValue = firstCode.rawValue;
        this.receiptCodeFormat = this.getReceiptCodeFormatLabel(firstCode.format);
      }

      console.info('[receipt] Image prepared for upload', {
        fileName: file.name,
        fileType: file.type,
        originalBytes: image.originalBytes,
        uploadBytes: image.uploadBytes,
        width: image.width,
        height: image.height,
        detectedCodes: detectedCodes.length,
      });

      this.http
        .post<ReceiptAnalysisResponse>(`${this.apiBaseUrl}/analyze_moviment_receipt`, {
          imageBase64: image.dataUrl,
          ledgerAccounts: this.ledgerAccounts.map((account) => account.name),
          detectedCodes,
        })
        .pipe(finalize(() => (this.isAnalyzingReceipt = false)))
        .subscribe({
          next: ({ data }) => {
            this.applyReceiptGuesses(data.guesses);
            this.receiptMessage = detectedCodes.length > 0
              ? 'Recibo e código lidos. Reveja os campos sugeridos antes de guardar.'
              : 'Recibo analisado. Reveja os campos sugeridos antes de guardar.';
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

  private async detectReceiptCodes(dataUrl: string): Promise<BarcodeDetectionResult[]> {
    const detectorConstructor = this.getBarcodeDetectorConstructor();

    if (!detectorConstructor) {
      return [];
    }

    try {
      const requestedFormats = [
        'qr_code',
        'code_128',
        'code_39',
        'code_93',
        'codabar',
        'ean_13',
        'ean_8',
        'itf',
        'upc_a',
        'upc_e',
      ];
      const supportedFormats = await detectorConstructor.getSupportedFormats?.();
      const formats = supportedFormats?.length
        ? requestedFormats.filter((format) => supportedFormats.includes(format))
        : requestedFormats;

      if (formats.length === 0) {
        return [];
      }

      const detector = new detectorConstructor({ formats });
      const image = await this.loadImage(dataUrl);
      const detections = await detector.detect(image);

      return detections
        .map((code) => ({
          rawValue: String(code.rawValue ?? '').trim(),
          format: String(code.format ?? '').trim(),
        }))
        .filter((code) => code.rawValue);
    } catch (error) {
      console.info('[receipt] Barcode detection unavailable for this image', error);
      return [];
    }
  }

  private getBarcodeDetectorConstructor(): BarcodeDetectorConstructor | null {
    const detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    return detector ?? null;
  }

  protected get receiptCodeLabel(): string {
    return this.receiptCodeFormat || 'Código lido';
  }

  private getReceiptCodeFormatLabel(format: string): string {
    const labels: Record<string, string> = {
      qr_code: 'QR Code',
      code_128: 'Código de barras',
      code_39: 'Código 39',
      code_93: 'Código 93',
      codabar: 'Codabar',
      ean_13: 'EAN-13',
      ean_8: 'EAN-8',
      itf: 'Interleaved 2 of 5',
      upc_a: 'UPC-A',
      upc_e: 'UPC-E',
    };

    return labels[format] ?? format.replace(/_/g, ' ').toUpperCase();
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

  private getSourceContext(): NewMovementSource {
    const historyState = window.history.state as MovimentNavigationState & { sourceRoute?: string };
    const sourceRoute = historyState.sourceRoute ?? sessionStorage.getItem(this.newMovementSourceStorageKey) ?? '';

    if (sourceRoute.includes('/example/finance')) {
      return 'finance';
    }

    if (sourceRoute.includes('/example/dashboard')) {
      return 'dashboard';
    }

    return 'generic';
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

    forkJoin({
      settings: this.financeData.getFinanceSettings(),
      balances: this.financeData.getBalances(),
    })
      .pipe(finalize(() => {
        this.isLoading = false;
        this.completeRefresh(refreshEvent);
      }))
      .subscribe({
        next: ({ settings, balances }) => {
          const selectedStatusName = this.statusOptions.find(
            (status) => status.id === this.movimentForm.controls.statusId.value,
          )?.name;
          this.usedMovimentAccountIds = new Set(
            balances.map((row) => Number(row.moviment_account_id)).filter((id) => id > 0),
          );
          this.usedLedgerAccountIds = new Set(
            balances.map((row) => Number(row.ledger_account_id)).filter((id) => id > 0),
          );

          this.ledgerAccounts = this.mergeOptions(
            this.ledgerAccounts,
            settings.ledgerAccounts.map((row) => this.toOption(row.id, row.description, row.icon)),
          );
          this.movimentAccounts = this.mergeOptions(
            this.movimentAccounts,
            settings.accounts.map((row) => this.toOption(row.id, row.description, row.icon)),
          );
          this.movimentAccountTypes = new Map(
            settings.accounts.map((row) => [row.id, row.account_type]),
          );
          this.statusOptions = this.mergeOptions(
            this.statusOptions,
            settings.statuses.map((row) => this.toOption(row.id, row.description, row.icon)),
          );
          this.syncSelectedStatus(selectedStatusName);
          this.applyDefaultOptions();
          this.scheduleSelectedOptionFocus();
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
    this.currentStep = 3;
  }

  private resetAddMovimentState(): void {
    const now = new Date();
    const endDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    this.isEditMode = false;
    this.originalMoviment = null;
    this.errorMessage = '';
    this.receiptMessage = '';
    this.receiptImagePreview = '';
    this.receiptCodeValue = '';
    this.receiptCodeFormat = '';
    this.isRecurringOpen = false;
    this.valueSign = -1;
    this.currentStep = 1;
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
      this.movimentForm.controls.movimentAccountId.setValue(
        this.getStoredExistingOptionId(this.lastMovimentAccountStorageKey, this.movimentAccounts)
          ?? this.movimentAccounts[0].id,
      );
    }

    if (!this.movimentForm.controls.ledgerAccountId.value && this.ledgerAccounts.length > 0) {
      this.movimentForm.controls.ledgerAccountId.setValue(
        this.getStoredExistingOptionId(this.lastLedgerAccountStorageKey, this.ledgerAccounts)
          ?? this.ledgerAccounts[0].id,
      );
    }
  }

  private rememberSelectedOptions(): void {
    const movimentAccountId = this.movimentForm.controls.movimentAccountId.value;
    const ledgerAccountId = this.movimentForm.controls.ledgerAccountId.value;

    if (movimentAccountId > 0) {
      localStorage.setItem(this.lastMovimentAccountStorageKey, String(movimentAccountId));
    }

    if (ledgerAccountId > 0) {
      localStorage.setItem(this.lastLedgerAccountStorageKey, String(ledgerAccountId));
    }
  }

  private getStoredExistingOptionId(key: string, options: MovimentOption[]): number | null {
    const storedId = this.getStoredOptionId(key);

    return options.some((option) => option.id === storedId) ? storedId : null;
  }

  private getStoredOptionId(key: string): number {
    return Number(localStorage.getItem(key)) || 0;
  }

  private hasOptionNamed(options: MovimentOption[], name: string): boolean {
    const normalizedName = this.normalizeOptionName(name);
    return options.some((option) => this.normalizeOptionName(option.name) === normalizedName);
  }

  private normalizeOptionName(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('pt-BR');
  }

  private reloadOptionsAndSelect(kind: 'account' | 'ledger', optionName: string): void {
    forkJoin({
      settings: this.financeData.getFinanceSettings(),
      balances: this.financeData.getBalances(true),
    }).subscribe({
      next: ({ settings, balances }) => {
        this.usedMovimentAccountIds = new Set(
          balances.map((row) => Number(row.moviment_account_id)).filter((id) => id > 0),
        );
        this.usedLedgerAccountIds = new Set(
          balances.map((row) => Number(row.ledger_account_id)).filter((id) => id > 0),
        );
        this.movimentAccounts = settings.accounts.map((row) => this.toOption(row.id, row.description, row.icon));
        this.ledgerAccounts = settings.ledgerAccounts.map((row) => this.toOption(row.id, row.description, row.icon));
        this.statusOptions = this.mergeOptions(
          this.statusOptions,
          settings.statuses.map((row) => this.toOption(row.id, row.description, row.icon)),
        );
        this.movimentAccountTypes = new Map(settings.accounts.map((row) => [row.id, row.account_type]));

        const normalizedName = this.normalizeOptionName(optionName);

        if (kind === 'account') {
          const createdAccount = this.movimentAccounts.find(
            (account) => this.normalizeOptionName(account.name) === normalizedName,
          );

          if (createdAccount) {
            this.selectMovimentAccount(createdAccount);
          }
        } else {
          const createdLedger = this.ledgerAccounts.find(
            (account) => this.normalizeOptionName(account.name) === normalizedName,
          );

          if (createdLedger) {
            this.selectLedgerAccount(createdLedger);
          }
        }

        this.applyDefaultOptions();
        this.scheduleSelectedOptionFocus();
      },
      error: () => {
        this.errorMessage = kind === 'account'
          ? 'Conta criada, mas não foi possível atualizar a lista.'
          : 'Categoria criada, mas não foi possível atualizar a lista.';
      },
    });
  }

  private scheduleSelectedOptionFocus(): void {
    setTimeout(() => {
      const hostElement = this.host.nativeElement as HTMLElement;

      hostElement
        .querySelector('.account-section .option-chip.active')
        ?.scrollIntoView({ block: 'nearest', inline: 'center' });
      hostElement
        .querySelector('.category-section .option-chip.active')
        ?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }, 60);
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

  private finishMovimentSave(response: MovimentSaveResponse): void {
    this.storeFinanceFocusTarget(response);

    if (!this.isSelectedMovimentCredit()) {
      this.navigateBackToFinance();
      return;
    }

    const accountId = this.getSelectedCreditAccountId();

    this.financeData.syncCreditBills(false, accountId).subscribe({
      next: (syncResponse) => this.handleCreditBillSyncResponse(syncResponse, accountId),
      error: () => this.handleCreditBillSyncResponse({}, accountId),
    });
  }

  private handleCreditBillSyncResponse(_response: CreditBillSyncResponse, accountId: number): void {
    this.getLocalCreditBills(accountId)
      .subscribe({
        next: (localBills) => {
          const expectedBills = localBills.map(({ hasBill: _hasBill, ...bill }) => bill);
          const missingBills = localBills
            .filter((bill) => !bill.hasBill)
            .map(({ hasBill: _hasBill, ...bill }) => bill);

          if (missingBills.length === 0) {
            this.enforceCreditBillValues(expectedBills).subscribe({
              next: () => this.navigateBackToFinance(),
              error: () => this.navigateBackToFinance(),
            });
            return;
          }

          const total = missingBills.reduce((sum, bill) => sum + Math.abs(Number(bill.value) || 0), 0);
          this.pendingCreditBillPrompt = {
            bills: missingBills,
            total,
            dueDateLabel: this.formatCreditBillDueDate(missingBills),
            accountName: missingBills[0]?.account_description ?? 'cartão',
            hideExplanation: false,
            compact: this.shouldHideCreditBillPromptExplanation(),
          };
        },
        error: () => this.navigateBackToFinance(),
      });
  }

  protected confirmCreditBillPrompt(): void {
    const prompt = this.pendingCreditBillPrompt;

    if (!prompt || this.isCreditBillPromptSaving) {
      return;
    }

    this.persistCreditBillPromptPreference(prompt);
    this.isCreditBillPromptSaving = true;
    this.financeData.syncCreditBills(true, prompt.bills[0]?.account_id, prompt.bills).subscribe({
      next: () => {
        this.enforceCreditBillValues(prompt.bills).subscribe({
          next: () => this.navigateBackToFinance(),
          error: () => this.navigateBackToFinance(),
        });
      },
      error: () => {
        this.isCreditBillPromptSaving = false;
        this.navigateBackToFinance();
      },
    });
  }

  protected declineCreditBillPrompt(): void {
    const prompt = this.pendingCreditBillPrompt;

    if (!prompt) {
      this.navigateBackToFinance();
      return;
    }

    this.persistCreditBillPromptPreference(prompt);
    this.pendingCreditBillPrompt = null;
    this.navigateBackToFinance();
  }

  protected setCreditBillPromptPreference(checked: boolean): void {
    if (!this.pendingCreditBillPrompt) {
      return;
    }

    this.pendingCreditBillPrompt = {
      ...this.pendingCreditBillPrompt,
      hideExplanation: checked,
    };
  }

  private persistCreditBillPromptPreference(prompt: CreditBillPromptState): void {
    if (prompt.hideExplanation) {
      localStorage.setItem(this.creditBillPromptPreferenceKey, 'true');
    }
  }

  private shouldHideCreditBillPromptExplanation(): boolean {
    return localStorage.getItem(this.creditBillPromptPreferenceKey) === 'true';
  }

  private navigateBackToFinance(): void {
    this.clearCreditBillPrompt();
    sessionStorage.removeItem(this.selectedMovimentStorageKey);
    void this.router.navigate(['/example/finance']);
  }

  private clearCreditBillPrompt(): void {
    this.pendingCreditBillPrompt = null;
    this.isCreditBillPromptSaving = false;
  }

  private isSelectedMovimentCredit(): boolean {
    const accountId = this.movimentForm.controls.movimentAccountId.value;

    return this.originalMoviment?.account_type === 1 || this.movimentAccountTypes.get(accountId) === 1;
  }

  private getSelectedCreditAccountId(): number {
    return this.movimentForm.controls.movimentAccountId.value || Number(this.originalMoviment?.moviment_account_id) || 0;
  }

  private getLocalCreditBills(accountId: number) {
    if (!accountId) {
      return of([] as LocalCreditBill[]);
    }

    const movementDate = new Date(this.movimentForm.controls.datetime.value);

    if (Number.isNaN(movementDate.getTime())) {
      return of([] as LocalCreditBill[]);
    }

    return forkJoin({
      settings: this.financeData.getFinanceSettings(),
      balances: this.financeData.getBalances(true),
      onboarding: this.financeData.getContractOnboardingSetup(),
    }).pipe(
      map(({ settings, balances, onboarding }) => {
        const creditBillSettings = getCreditBillSettings(onboarding);

        if (!creditBillSettings.enabled) {
          return [];
        }

        const account = settings.accounts.find((item) => item.id === accountId && item.account_type === 1);

        if (!account?.debit_account || !account.pay_day) {
          return [];
        }

        const cycle = this.getCreditBillCycle(account, movementDate);
        const referenceDate = new Date();
        const cycleRows = balances.filter((row) => {
          if (row.account_type !== 1 || Number(row.moviment_account_id) !== account.id || row.credit_bill) {
            return false;
          }

          const rowDate = new Date(row.datetime);

          return Number(row.value) !== 0 &&
            this.shouldIncludeCreditBillRowStatus(row.status, creditBillSettings.includeProvisioned, account, cycle.closingDate, referenceDate) &&
            rowDate.getTime() >= this.getPreviousCreditClosingDate(cycle.closingDate, account).getTime() &&
            rowDate.getTime() < cycle.closingDate.getTime();
        });
        const cycleTotal = cycleRows.reduce((total, row) => total + (Number(row.value) || 0), 0);
        const value = cycleTotal < 0 ? Math.abs(cycleTotal) : 0;
        const hasBill = this.hasCreditBillForCycle(balances, account, cycle);

        if (value <= 0) {
          return [];
        }

        return [{
          account_id: account.id,
          account_description: account.description,
          cycle_key: cycle.cycleKey,
          due_datetime: cycle.dueDate.toISOString(),
          value,
          movement_count: cycleRows.length,
          hasBill,
        }];
      }),
      catchError(() => of([] as LocalCreditBill[])),
    );
  }

  private enforceCreditBillValues(bills: CreditBillSyncMissingBill[]) {
    if (bills.length === 0) {
      return of(null);
    }

    return forkJoin({
      settings: this.financeData.getFinanceSettings(),
      balances: this.financeData.getBalances(true),
    }).pipe(
      map(({ settings, balances }) => {
        return bills
          .map((bill) => {
            const account = settings.accounts.find((item) => item.id === bill.account_id && item.account_type === 1);
            const dueDate = new Date(bill.due_datetime);

            if (!account?.debit_account || Number.isNaN(dueDate.getTime())) {
              return null;
            }

            const billRow = this.findCreditBillRow(balances, account, dueDate);
            const expectedValue = -Math.abs(Number(bill.value) || 0);

            if (!billRow || this.isSettledStatusName(billRow.status) || Math.abs((Number(billRow.value) || 0) - expectedValue) < 0.01) {
              return null;
            }

            return {
              row: billRow,
              value: expectedValue,
            };
          })
          .filter((item): item is { row: BalanceRow; value: number } => !!item);
      }),
      switchMap((edits) => {
        if (edits.length === 0) {
          return of(null);
        }

        return forkJoin(edits.map(({ row, value }) => {
          return this.financeData.saveMoviment('edit', {
            datetime: row.datetime,
            description: row.description,
            ledger_account: row.ledger_account_id,
            moviment_account: row.moviment_account_id,
            status: row.status_id,
            value,
          }, row);
        })).pipe(tap(() => this.storeCreditBillUpdateHint(edits)));
      }),
      catchError(() => of(null)),
    );
  }

  private storeCreditBillUpdateHint(edits: { row: BalanceRow; value: number }[]): void {
    const firstEdit = edits[0];

    if (!firstEdit) {
      return;
    }

    sessionStorage.setItem(this.creditBillUpdateHintStorageKey, JSON.stringify({
      message: `Fatura atualizada para ${this.formatEuro(Math.abs(firstEdit.value))}.`,
      createdAt: Date.now(),
    }));
  }

  private formatCreditBillDueDate(bills: CreditBillSyncMissingBill[]): string {
    const dueDate = new Date(bills[0]?.due_datetime ?? '');

    if (Number.isNaN(dueDate.getTime())) {
      return 'próximo mês';
    }

    return new Intl.DateTimeFormat('pt-PT', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
      .format(dueDate)
      .replace(/ de ([a-zá-ú])/u, (match, letter: string) => match.replace(letter, letter.toLocaleUpperCase('pt-PT')));
  }

  private getCreditBillCycle(account: MovimentAccountSettings, movementDate: Date): CreditBillCycle {
    const closingDate = this.getCurrentOrNextCreditClosingDate(account, movementDate);
    const dueMonthDate = new Date(closingDate.getFullYear(), closingDate.getMonth() + 1, 1);
    const dueDay = Math.min(
      Math.max(account.pay_day ?? 1, 1),
      new Date(dueMonthDate.getFullYear(), dueMonthDate.getMonth() + 1, 0).getDate(),
    );
    const dueDate = new Date(dueMonthDate.getFullYear(), dueMonthDate.getMonth(), dueDay, 12, 0, 0, 0);
    const dueMonthLabel = new Intl.DateTimeFormat('pt-PT', { month: 'long' }).format(dueDate);

    return {
      closingDate,
      dueDate,
      cycleKey: this.getMonthKey(closingDate),
      dueMonthLabel,
    };
  }

  private getCurrentOrNextCreditClosingDate(account: MovimentAccountSettings, referenceDate: Date): Date {
    const currentClosingDate = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      this.getSafeClosingDay(account, referenceDate),
      0,
      0,
      0,
      0,
    );

    if (referenceDate.getTime() <= currentClosingDate.getTime()) {
      return currentClosingDate;
    }

    const nextMonthReference = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1);

    return new Date(
      nextMonthReference.getFullYear(),
      nextMonthReference.getMonth(),
      this.getSafeClosingDay(account, nextMonthReference),
      0,
      0,
      0,
      0,
    );
  }

  private getPreviousCreditClosingDate(closingDate: Date, account: MovimentAccountSettings): Date {
    const previousMonthReference = new Date(closingDate.getFullYear(), closingDate.getMonth() - 1, 1);

    return new Date(
      previousMonthReference.getFullYear(),
      previousMonthReference.getMonth(),
      this.getSafeClosingDay(account, previousMonthReference),
      0,
      0,
      0,
      0,
    );
  }

  private hasCreditBillForCycle(
    rows: BalanceRow[],
    account: MovimentAccountSettings,
    cycle: CreditBillCycle,
  ): boolean {
    const expectedDescription = this.normalizeCreditBillDescription(
      `Fatura ${account.description} mes ${cycle.dueMonthLabel} ${cycle.dueDate.getFullYear()}`,
    );

    return rows.some((row) => {
      if (Number(row.moviment_account_id) !== account.debit_account) {
        return false;
      }

      const rowDate = new Date(row.datetime);
      const hasSameDueDate = rowDate.getFullYear() === cycle.dueDate.getFullYear()
        && rowDate.getMonth() === cycle.dueDate.getMonth()
        && rowDate.getDate() === cycle.dueDate.getDate();

      return hasSameDueDate && (
        !!row.credit_bill ||
        this.normalizeCreditBillDescription(row.description) === expectedDescription
      );
    });
  }

  private findCreditBillRow(
    rows: BalanceRow[],
    account: MovimentAccountSettings,
    dueDate: Date,
  ): BalanceRow | undefined {
    const expectedDescription = this.normalizeCreditBillDescription(
      `Fatura ${account.description} mes ${new Intl.DateTimeFormat('pt-PT', { month: 'long' }).format(dueDate)} ${dueDate.getFullYear()}`,
    );

    return rows.find((row) => {
      if (Number(row.moviment_account_id) !== account.debit_account) {
        return false;
      }

      const rowDate = new Date(row.datetime);
      const hasSameDueDate = rowDate.getFullYear() === dueDate.getFullYear()
        && rowDate.getMonth() === dueDate.getMonth()
        && rowDate.getDate() === dueDate.getDate();

      return hasSameDueDate && (
        !!row.credit_bill ||
        this.normalizeCreditBillDescription(row.description) === expectedDescription
      );
    });
  }

  private getSafeClosingDay(account: MovimentAccountSettings, referenceDate: Date): number {
    const lastDayOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
    const closingDay = account.closing_day ?? lastDayOfMonth;

    return Math.min(Math.max(closingDay, 1), lastDayOfMonth);
  }

  private getMonthKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');

    return `${date.getFullYear()}-${month}`;
  }

  private isSettledStatusName(status: string | null | undefined): boolean {
    const normalizedStatus = this.normalizeStatusName(status);

    return !normalizedStatus.includes('provision') &&
      !normalizedStatus.includes('pagar') &&
      !normalizedStatus.includes('receber') &&
      !normalizedStatus.includes('pending');
  }

  private shouldIncludeCreditBillRowStatus(
    status: string | null | undefined,
    includeProvisioned: boolean,
    account: MovimentAccountSettings,
    cycleClosingDate: Date,
    referenceDate: Date,
  ): boolean {
    if (this.isSettledStatusName(status)) {
      return true;
    }

    if (!includeProvisioned || !this.isPendingStatusName(status)) {
      return false;
    }

    return cycleClosingDate.getTime() > this.getCurrentOrNextCreditClosingDate(account, referenceDate).getTime();
  }

  private isPendingStatusName(status: string | null | undefined): boolean {
    const normalizedStatus = this.normalizeStatusName(status);

    return normalizedStatus.includes('provision') ||
      normalizedStatus.includes('pagar') ||
      normalizedStatus.includes('receber') ||
      normalizedStatus.includes('pending');
  }

  private normalizeCreditBillDescription(description: string): string {
    return description
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('pt-BR');
  }

  protected formatEuro(value: number): string {
    return this.currencySettings.format(value);
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

        return this.toOption(option.id, option.name, option.icon);
      })
      .filter((option) => option.id > 0 && option.name);
  }

  private normalizeIcon(icon: string | null | undefined, fallbackIcon: string): string {
    const normalizedIcon = (icon ?? '').trim();
    return this.availableIconNames.has(normalizedIcon) ? normalizedIcon : fallbackIcon;
  }

  private toOption(id: number, name: string, icon?: string | null): MovimentOption {
    return {
      id: Number(id) || 0,
      name: name?.trim() ?? '',
      icon: icon ?? null,
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
