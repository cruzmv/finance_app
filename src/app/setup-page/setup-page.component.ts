import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addCircleOutline,
  arrowBackOutline,
  arrowForwardOutline,
  briefcaseOutline,
  calendarOutline,
  carOutline,
  cardOutline,
  cartOutline,
  cashOutline,
  checkmarkCircleOutline,
  gameControllerOutline,
  homeOutline,
  libraryOutline,
  medkitOutline,
  receiptOutline,
  saveOutline,
  trashOutline,
  walletOutline,
} from 'ionicons/icons';
import { concatMap, finalize, forkJoin, map, of, tap } from 'rxjs';
import {
  ContractOnboardingSetup,
  FinanceDataService,
  LedgerAccountSettings,
  MovimentAccountPayload,
  MovimentAccountSettings,
  PlanningPayload,
} from '../finance-data.service';
import {
  AppCurrencyCode,
  CurrencySettingsService,
  appCurrencyOptions,
} from '../currency-settings.service';

type AccountKind = 'debit' | 'credit';
type AccountRef = `existing:${number}` | `draft:${number}`;

interface DraftAccount {
  tempId: number;
  kind: AccountKind;
  description: string;
  icon: string;
  startDate: string;
  startValue: number | null;
  closingDay: number | null;
  payDay: number | null;
  debitAccountRef: AccountRef | '';
}

interface DraftBill {
  tempId: number;
  description: string;
  dayOfMonth: number;
  value: number | null;
  category: string;
  accountRef: AccountRef | '';
}

interface AccountOption {
  ref: AccountRef;
  name: string;
  kind: AccountKind;
  icon: string;
}

interface CreatedPlanningResponse {
  planning?: number;
}

interface SuggestedCategory {
  name: string;
  icon: string;
  selected: boolean;
}

const suggestedCategories = [
  { name: 'Salário', icon: 'briefcase-outline', selected: true },
  { name: 'Aluguel', icon: 'home-outline', selected: true },
  { name: 'Internet', icon: 'receipt-outline', selected: true },
  { name: 'Luz', icon: 'receipt-outline', selected: true },
  { name: 'Mercado', icon: 'cart-outline', selected: true },
  { name: 'Transporte', icon: 'car-outline', selected: true },
  { name: 'Saúde', icon: 'medkit-outline', selected: true },
  { name: 'Lazer', icon: 'game-controller-outline', selected: false },
];

@Component({
  selector: 'app-setup-page',
  templateUrl: './setup-page.component.html',
  styleUrls: ['./setup-page.component.scss'],
  imports: [CommonModule, IonContent, IonIcon, ReactiveFormsModule],
})
export class SetupPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly financeData = inject(FinanceDataService);
  private readonly currencySettings = inject(CurrencySettingsService);
  private readonly router = inject(Router);
  @ViewChild('setupScroll') private setupScroll?: ElementRef<HTMLElement>;

  protected step = 1;
  protected readonly totalSteps = 7;
  protected isLoading = false;
  protected isSaving = false;
  protected errorMessage = '';
  protected successMessage = '';
  protected existingAccounts: MovimentAccountSettings[] = [];
  protected existingLedgers: LedgerAccountSettings[] = [];
  protected draftAccounts: DraftAccount[] = [];
  protected draftBills: DraftBill[] = [];
  protected categories = suggestedCategories.map((category) => ({ ...category }));
  protected activeAccountIconPicker = false;
  protected activeCategoryIconPicker: string | 'custom' | null = null;
  protected startValueDisplay = '';
  protected salaryValueDisplay = '';
  protected billValueDisplay = '';
  protected currencySearch = '';
  protected readonly currencyOptions = appCurrencyOptions;
  protected readonly iconOptions = [
    { name: 'wallet-outline', label: 'Carteira' },
    { name: 'card-outline', label: 'Cartão' },
    { name: 'cash-outline', label: 'Dinheiro' },
    { name: 'briefcase-outline', label: 'Trabalho' },
    { name: 'home-outline', label: 'Casa' },
    { name: 'receipt-outline', label: 'Conta' },
    { name: 'cart-outline', label: 'Compras' },
    { name: 'car-outline', label: 'Transporte' },
    { name: 'medkit-outline', label: 'Saúde' },
    { name: 'game-controller-outline', label: 'Lazer' },
  ];

  protected readonly currencyForm = this.fb.nonNullable.group({
    currencyCode: this.fb.nonNullable.control<AppCurrencyCode>(this.currencySettings.currencyCode, Validators.required),
  });

  protected readonly accountForm = this.fb.nonNullable.group({
    kind: this.fb.nonNullable.control<AccountKind>('debit', Validators.required),
    description: ['', Validators.required],
    icon: ['wallet-outline', Validators.required],
    startDate: [''],
    startValue: this.fb.control<number | null>(null),
    closingDay: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(31)]),
    payDay: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(31)]),
    debitAccountRef: this.fb.nonNullable.control<AccountRef | ''>(''),
  });

  protected readonly customCategoryForm = this.fb.nonNullable.group({
    description: [''],
    icon: ['receipt-outline'],
  });

  protected readonly salaryForm = this.fb.nonNullable.group({
    enabled: [true],
    description: ['Salário', Validators.required],
    dayOfMonth: [1, [Validators.required, Validators.min(1), Validators.max(31)]],
    value: this.fb.control<number | null>(null),
    accountRef: this.fb.nonNullable.control<AccountRef | ''>(''),
    endDate: [this.defaultEndDate(), Validators.required],
  });

  protected readonly billForm = this.fb.nonNullable.group({
    description: ['Aluguel', Validators.required],
    dayOfMonth: [5, [Validators.required, Validators.min(1), Validators.max(31)]],
    value: this.fb.control<number | null>(null),
    category: ['Aluguel', Validators.required],
    accountRef: this.fb.nonNullable.control<AccountRef | ''>(''),
  });

  constructor() {
    addIcons({
      addCircleOutline,
      arrowBackOutline,
      arrowForwardOutline,
      briefcaseOutline,
      calendarOutline,
      carOutline,
      cardOutline,
      cartOutline,
      cashOutline,
      checkmarkCircleOutline,
      gameControllerOutline,
      homeOutline,
      libraryOutline,
      medkitOutline,
      receiptOutline,
      saveOutline,
      trashOutline,
      walletOutline,
    });
  }

  ngOnInit(): void {
    this.loadSetup();
  }

  protected get accountOptions(): AccountOption[] {
    const existing = this.existingAccounts.map<AccountOption>((account) => ({
      ref: `existing:${account.id}`,
      name: account.description,
      kind: account.account_type === 1 ? 'credit' : 'debit',
      icon: account.icon ?? (account.account_type === 1 ? 'card-outline' : 'wallet-outline'),
    }));
    const drafts = this.draftAccounts.map<AccountOption>((account) => ({
      ref: `draft:${account.tempId}`,
      name: account.description,
      kind: account.kind,
      icon: account.icon,
    }));

    return [...existing, ...drafts];
  }

  protected get debitAccountOptions(): AccountOption[] {
    return this.accountOptions.filter((account) => account.kind === 'debit');
  }

  protected get selectedCategoryNames(): string[] {
    return this.categories.filter((category) => category.selected).map((category) => category.name);
  }

  protected get filteredCurrencyOptions() {
    const normalizedSearch = this.normalizeText(this.currencySearch);

    if (!normalizedSearch) {
      return this.currencyOptions;
    }

    return this.currencyOptions.filter((currency) => {
      return this.normalizeText(`${currency.code} ${currency.label} ${currency.symbol}`).includes(normalizedSearch);
    });
  }

  protected get selectedCategoryOptions(): SuggestedCategory[] {
    return this.categories.filter((category) => category.selected);
  }

  protected nextStep(): void {
    this.errorMessage = '';
    if (this.step < this.totalSteps) {
      this.setStep(this.step + 1);
    }
  }

  protected previousStep(): void {
    this.errorMessage = '';
    if (this.step > 1) {
      this.setStep(this.step - 1);
    }
  }

  protected setAccountKind(kind: AccountKind): void {
    this.accountForm.controls.kind.setValue(kind);
    this.accountForm.controls.icon.setValue(kind === 'credit' ? 'card-outline' : 'wallet-outline');
    if (kind === 'debit') {
      this.accountForm.controls.closingDay.setValue(null);
      this.accountForm.controls.payDay.setValue(null);
      this.accountForm.controls.debitAccountRef.setValue('');
    }
  }

  protected get currencySymbol(): string {
    return this.currencyOptions.find((option) => option.code === this.currencyForm.controls.currencyCode.value)?.symbol ?? '€';
  }

  protected selectCurrency(code: AppCurrencyCode): void {
    this.currencyForm.controls.currencyCode.setValue(code);
    this.currencySettings.setCurrency(code);
  }

  protected updateCurrencySearch(value: string): void {
    this.currencySearch = value;
  }

  protected selectAccountIcon(icon: string): void {
    this.accountForm.controls.icon.setValue(icon);
    this.activeAccountIconPicker = false;
  }

  protected getIconLabel(icon: string | null | undefined): string {
    return this.iconOptions.find((option) => option.name === icon)?.label ?? 'Ícone';
  }

  protected toggleCategoryIconPicker(category: SuggestedCategory, event: Event): void {
    event.stopPropagation();
    this.activeCategoryIconPicker = this.activeCategoryIconPicker === category.name ? null : category.name;
  }

  protected selectCategoryIcon(category: SuggestedCategory, icon: string, event: Event): void {
    event.stopPropagation();
    this.categories = this.categories.map((item) => item.name === category.name ? { ...item, icon } : item);
    this.activeCategoryIconPicker = null;
  }

  protected selectCustomCategoryIcon(icon: string): void {
    this.customCategoryForm.controls.icon.setValue(icon);
    this.activeCategoryIconPicker = null;
  }

  protected updateMoneyControl(controlName: 'startValue' | 'value', value: string, formName: 'account' | 'salary' | 'bill'): void {
    const parsed = this.currencySettings.parse(value);

    if (formName === 'account') {
      this.accountForm.controls.startValue.setValue(parsed);
      this.startValueDisplay = value;
      return;
    }

    if (formName === 'salary') {
      this.salaryForm.controls.value.setValue(parsed);
      this.salaryValueDisplay = value;
      return;
    }

    this.billForm.controls.value.setValue(parsed);
    this.billValueDisplay = value;
  }

  protected formatMoneyDisplay(formName: 'account' | 'salary' | 'bill'): void {
    if (formName === 'account') {
      this.startValueDisplay = this.formatOptionalMoney(this.accountForm.controls.startValue.value);
      return;
    }

    if (formName === 'salary') {
      this.salaryValueDisplay = this.formatOptionalMoney(this.salaryForm.controls.value.value);
      return;
    }

    this.billValueDisplay = this.formatOptionalMoney(this.billForm.controls.value.value);
  }

  protected clearMoneyDisplay(formName: 'account' | 'salary' | 'bill'): void {
    if (formName === 'account') {
      this.startValueDisplay = this.accountForm.controls.startValue.value?.toString() ?? '';
      return;
    }

    if (formName === 'salary') {
      this.salaryValueDisplay = this.salaryForm.controls.value.value?.toString() ?? '';
      return;
    }

    this.billValueDisplay = this.billForm.controls.value.value?.toString() ?? '';
  }

  protected addDraftAccount(): void {
    this.accountForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.accountForm.invalid) {
      this.errorMessage = 'Preencha o nome da conta e os dias entre 1 e 31.';
      return;
    }

    const form = this.accountForm.getRawValue();
    const description = form.description.trim();
    if (!description) {
      this.errorMessage = 'Preencha o nome da conta.';
      return;
    }

    if (this.hasAccountNamed(description)) {
      this.errorMessage = 'Já existe uma conta com este nome.';
      return;
    }

    if (form.kind === 'credit' && (!form.payDay || !form.debitAccountRef)) {
      this.errorMessage = 'Para cartão de crédito, informe pagamento e conta de débito.';
      return;
    }

    this.draftAccounts = [
      ...this.draftAccounts,
      {
        tempId: Date.now(),
        kind: form.kind,
        description,
        icon: form.icon,
        startDate: form.startDate,
        startValue: form.startValue,
        closingDay: form.kind === 'credit' ? form.closingDay : null,
        payDay: form.kind === 'credit' ? form.payDay : null,
        debitAccountRef: form.kind === 'credit' ? form.debitAccountRef : '',
      },
    ];
    this.accountForm.reset({
      kind: 'debit',
      description: '',
      icon: 'wallet-outline',
      startDate: '',
      startValue: null,
      closingDay: null,
      payDay: null,
      debitAccountRef: '',
    });
    this.startValueDisplay = '';
    this.applyDefaultRefs();
  }

  protected removeDraftAccount(account: DraftAccount): void {
    this.clearAccountRefs(`draft:${account.tempId}`);
    this.draftAccounts = this.draftAccounts.filter((item) => item.tempId !== account.tempId);
    this.applyDefaultRefs();
  }

  protected toggleCategory(name: string): void {
    this.categories = this.categories.map((category) => {
      return category.name === name ? { ...category, selected: !category.selected } : category;
    });
  }

  protected addCustomCategory(): void {
    const description = this.customCategoryForm.controls.description.value.trim();
    if (!description) {
      return;
    }

    if (!this.categories.some((category) => category.name.toLowerCase() === description.toLowerCase())) {
      this.categories = [
        ...this.categories,
        { name: description, icon: 'receipt-outline', selected: true },
      ];
    }
    this.customCategoryForm.reset({ description: '', icon: 'receipt-outline' });
  }

  protected addDraftBill(): void {
    this.billForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.billForm.invalid) {
      this.errorMessage = 'Preencha descrição, dia, categoria e valor da conta repetitiva.';
      return;
    }

    const form = this.billForm.getRawValue();
    if (!form.accountRef) {
      this.errorMessage = 'Escolha a conta onde esta recorrência será lançada.';
      return;
    }

    this.draftBills = [
      ...this.draftBills,
      {
        tempId: Date.now(),
        description: form.description.trim(),
        dayOfMonth: form.dayOfMonth,
        value: form.value,
        category: form.category,
        accountRef: form.accountRef,
      },
    ];
    this.billForm.reset({
      description: '',
      dayOfMonth: 5,
      value: null,
      category: this.selectedCategoryNames[0] ?? 'Aluguel',
      accountRef: this.defaultDebitRef(),
    });
    this.billValueDisplay = '';
  }

  protected removeDraftBill(bill: DraftBill): void {
    this.draftBills = this.draftBills.filter((item) => item.tempId !== bill.tempId);
  }

  protected selectSalaryAccount(accountRef: AccountRef): void {
    this.salaryForm.controls.accountRef.setValue(accountRef);
  }

  protected selectBillCategory(category: string): void {
    this.billForm.controls.category.setValue(category);
  }

  protected selectBillAccount(accountRef: AccountRef): void {
    this.billForm.controls.accountRef.setValue(accountRef);
  }

  protected goToAccountStep(): void {
    this.setStep(3);
  }

  protected goToCategoryStep(): void {
    this.setStep(4);
  }

  protected removeAccountOption(account: AccountOption, event: Event): void {
    event.stopPropagation();

    if (account.ref.startsWith('draft:')) {
      const tempId = Number(account.ref.replace('draft:', ''));
      const draft = this.draftAccounts.find((item) => item.tempId === tempId);
      if (draft) {
        this.removeDraftAccount(draft);
      }
      return;
    }

    const accountId = Number(account.ref.replace('existing:', ''));
    if (!accountId || !window.confirm(`Excluir a conta "${account.name}"?`)) {
      return;
    }

    this.financeData.deleteMovimentAccount(accountId).subscribe({
      next: () => {
        this.existingAccounts = this.existingAccounts.filter((item) => item.id !== accountId);
        this.clearAccountRefs(account.ref);
        this.applyDefaultRefs();
      },
      error: () => {
        this.errorMessage = 'Não foi possível excluir a conta.';
      },
    });
  }

  protected removeCategoryOption(category: SuggestedCategory, event: Event): void {
    event.stopPropagation();
    this.categories = this.categories.filter((item) => item.name !== category.name);

    if (this.billForm.controls.category.value === category.name) {
      this.billForm.controls.category.setValue(this.selectedCategoryNames[0] ?? '');
    }

    this.draftBills = this.draftBills.map((bill) => {
      return bill.category === category.name ? { ...bill, category: this.selectedCategoryNames[0] ?? '' } : bill;
    });
  }

  protected skipSetup(): void {
    this.persistSetup(true, [], true);
  }

  protected finishSetup(): void {
    this.errorMessage = '';

    if (this.salaryForm.controls.enabled.value) {
      this.salaryForm.markAllAsTouched();
      const salary = this.salaryForm.getRawValue();
      if (this.salaryForm.invalid || !salary.value || !salary.accountRef) {
        this.errorMessage = 'Para lançar salário recorrente, preencha conta, dia, valor e data final.';
        this.setStep(5);
        return;
      }
    }

    this.isSaving = true;
    const accountIdByRef = new Map<AccountRef, number>();
    this.existingAccounts.forEach((account) => accountIdByRef.set(`existing:${account.id}`, account.id));

    of(null)
      .pipe(
        concatMap(() => this.createDraftAccounts(accountIdByRef)),
        concatMap(() => this.createSelectedCategories()),
        concatMap(() => this.createRecurringMovements(accountIdByRef)),
        concatMap((planningIds) => this.persistSetup(false, planningIds, false)),
        finalize(() => (this.isSaving = false)),
      )
      .subscribe({
        next: () => {
          this.successMessage = 'Setup guardado. Seu painel já pode começar com dados reais.';
          void this.router.navigate(['/example/dashboard']);
        },
        error: (error) => {
          this.errorMessage = error?.error?.message ?? 'Não foi possível concluir o setup.';
        },
      });
  }

  private loadSetup(): void {
    this.isLoading = true;
    forkJoin({
      settings: this.financeData.getFinanceSettings(),
      setup: this.financeData.getContractOnboardingSetup(),
    })
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: ({ settings, setup }) => {
          this.existingAccounts = settings.accounts;
          this.existingLedgers = settings.ledgerAccounts;
          this.restoreDraft(setup);
          this.applyDefaultRefs();
        },
        error: () => {
          this.errorMessage = 'Não foi possível carregar o setup inicial.';
        },
      });
  }

  private createDraftAccounts(accountIdByRef: Map<AccountRef, number>) {
    const debitDrafts = this.draftAccounts.filter((account) => account.kind === 'debit');
    const creditDrafts = this.draftAccounts.filter((account) => account.kind === 'credit');
    const saveDrafts = (drafts: DraftAccount[]) => drafts.reduce((chain, account) => {
      return chain.pipe(concatMap(() => {
        const payload = this.toAccountPayload(account, accountIdByRef);
        return this.financeData.saveMovimentAccount('add', payload).pipe(
          concatMap(() => this.financeData.getFinanceSettings()),
          tap((settings) => {
            this.existingAccounts = settings.accounts;
            const created = settings.accounts.find((item) => item.description.toLowerCase() === account.description.toLowerCase());
            if (created) {
              accountIdByRef.set(`draft:${account.tempId}`, created.id);
            }
          }),
          map(() => null),
        );
      }));
    }, of(null));

    return saveDrafts(debitDrafts).pipe(concatMap(() => saveDrafts(creditDrafts)));
  }

  private createSelectedCategories() {
    const existingNames = new Set(this.existingLedgers.map((ledger) => ledger.description.toLowerCase()));
    const missing = this.categories.filter((category) => {
      return category.selected && !existingNames.has(category.name.toLowerCase());
    });

    if (missing.length === 0) {
      return of(null);
    }

    return forkJoin(missing.map((category) => {
      return this.financeData.saveLedgerAccount('add', {
        description: category.name,
        icon: category.icon,
      });
    })).pipe(
      concatMap(() => this.financeData.getFinanceSettings()),
      tap((settings) => (this.existingLedgers = settings.ledgerAccounts)),
      map(() => null),
    );
  }

  private createRecurringMovements(accountIdByRef: Map<AccountRef, number>) {
    const planningPayloads: PlanningPayload[] = [];
    const salary = this.salaryForm.getRawValue();

    if (salary.enabled && salary.value && salary.accountRef) {
      planningPayloads.push({
        start_datetime: this.toMonthlyDatetime(salary.dayOfMonth),
        end_date: salary.endDate,
        day_of_month: salary.dayOfMonth,
        description: salary.description.trim(),
        ledger_account: this.resolveLedgerId('Salário'),
        moviment_account: accountIdByRef.get(salary.accountRef) ?? 0,
        value: Math.abs(Number(salary.value)),
      });
    }

    this.draftBills.forEach((bill) => {
      if (!bill.accountRef) {
        return;
      }

      const accountId = accountIdByRef.get(bill.accountRef);
      if (!accountId || !bill.value) {
        return;
      }

      planningPayloads.push({
        start_datetime: this.toMonthlyDatetime(bill.dayOfMonth),
        end_date: this.defaultEndDate(),
        day_of_month: bill.dayOfMonth,
        description: bill.description,
        ledger_account: this.resolveLedgerId(bill.category),
        moviment_account: accountId,
        value: Math.abs(Number(bill.value)) * -1,
      });
    });

    if (planningPayloads.length === 0) {
      return of([] as number[]);
    }

    return forkJoin(planningPayloads.map((payload) => {
      return this.financeData.savePlanning('add', payload).pipe(
        map((response) => (response as CreatedPlanningResponse)?.planning),
      );
    })).pipe(map((ids) => ids.filter((id): id is number => typeof id === 'number')));
  }

  private persistSetup(skipped: boolean, planningIds: number[], navigateAfter: boolean) {
    const setup: ContractOnboardingSetup = {
      version: 1,
      completed: !skipped,
      completedAt: skipped ? undefined : new Date().toISOString(),
      skipped,
      skippedAt: skipped ? new Date().toISOString() : undefined,
      planningIds,
      answers: {
        currencyCode: this.currencyForm.controls.currencyCode.value,
        accounts: this.draftAccounts,
        categories: this.selectedCategoryNames,
        categoryIcons: this.categories.reduce<Record<string, string>>((icons, category) => {
          icons[category.name] = category.icon;
          return icons;
        }, {}),
        salary: this.salaryForm.getRawValue(),
        bills: this.draftBills,
      },
    };

    return this.financeData.saveContractOnboardingSetup(setup).pipe(
      tap(() => {
        if (navigateAfter) {
          void this.router.navigate(['/example/dashboard']);
        }
      }),
      map(() => setup),
    );
  }

  private restoreDraft(setup: ContractOnboardingSetup | null): void {
    const answers = setup?.answers as {
      accounts?: DraftAccount[];
      categories?: string[];
      categoryIcons?: Record<string, string>;
      currencyCode?: AppCurrencyCode;
      salary?: {
        enabled: boolean;
        description: string;
        dayOfMonth: number;
        value: number | null;
        accountRef: AccountRef | '';
        endDate: string;
      };
      bills?: DraftBill[];
    } | null;

    if (!answers || setup?.completed || setup?.skipped) {
      return;
    }

    this.draftAccounts = answers.accounts ?? [];
    this.draftBills = answers.bills ?? [];
    if (answers.currencyCode) {
      this.selectCurrency(answers.currencyCode);
    }
    if (answers.categories) {
      const selected = new Set(answers.categories.map((name) => name.toLowerCase()));
      this.categories = this.categories.map((category) => ({
        ...category,
        selected: selected.has(category.name.toLowerCase()),
        icon: answers.categoryIcons?.[category.name] ?? category.icon,
      }));
    }
    if (answers.salary) {
      this.salaryForm.reset(answers.salary);
      this.salaryValueDisplay = this.formatOptionalMoney(answers.salary.value);
    }
  }

  private setStep(step: number): void {
    this.step = Math.max(1, Math.min(this.totalSteps, step));
    this.scrollStepToTop();
  }

  private scrollStepToTop(): void {
    requestAnimationFrame(() => {
      this.setupScroll?.nativeElement.scrollTo({ top: 0, behavior: 'auto' });
    });
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('pt-BR');
  }

  private formatOptionalMoney(value: number | null): string {
    return value === null || value === undefined ? '' : this.currencySettings.format(value);
  }

  private toAccountPayload(account: DraftAccount, accountIdByRef: Map<AccountRef, number>): MovimentAccountPayload {
    return {
      description: account.description,
      icon: account.icon,
      start_date: account.startDate || null,
      start_value: account.startValue,
      closing_day: account.closingDay,
      pay_day: account.kind === 'credit' ? account.payDay : null,
      debit_account: account.kind === 'credit' ? accountIdByRef.get(account.debitAccountRef as AccountRef) ?? null : null,
      account_type: account.kind === 'credit' ? 1 : 0,
    };
  }

  private resolveLedgerId(name: string): number {
    return this.existingLedgers.find((ledger) => ledger.description.toLowerCase() === name.toLowerCase())?.id
      ?? this.existingLedgers[0]?.id
      ?? 0;
  }

  private hasAccountNamed(name: string): boolean {
    const normalized = name.toLowerCase();
    return this.existingAccounts.some((account) => account.description.toLowerCase() === normalized)
      || this.draftAccounts.some((account) => account.description.toLowerCase() === normalized);
  }

  private applyDefaultRefs(): void {
    const debitRef = this.defaultDebitRef();
    const anyRef = this.accountOptions[0]?.ref ?? '';
    if (!this.salaryForm.controls.accountRef.value) {
      this.salaryForm.controls.accountRef.setValue(debitRef || anyRef);
    }
    if (!this.billForm.controls.accountRef.value) {
      this.billForm.controls.accountRef.setValue(debitRef || anyRef);
    }
    if (!this.accountForm.controls.debitAccountRef.value) {
      this.accountForm.controls.debitAccountRef.setValue(debitRef);
    }
  }

  private defaultDebitRef(): AccountRef | '' {
    return this.debitAccountOptions[0]?.ref ?? '';
  }

  private clearAccountRefs(accountRef: AccountRef): void {
    if (this.salaryForm.controls.accountRef.value === accountRef) {
      this.salaryForm.controls.accountRef.setValue('');
    }

    if (this.billForm.controls.accountRef.value === accountRef) {
      this.billForm.controls.accountRef.setValue('');
    }

    this.draftBills = this.draftBills.map((bill) => {
      return bill.accountRef === accountRef ? { ...bill, accountRef: '' } : bill;
    });
  }

  private toMonthlyDatetime(dayOfMonth: number): string {
    const now = new Date();
    const clampedDay = Math.min(dayOfMonth, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}T09:00`;
  }

  private defaultEndDate(): string {
    return `${new Date().getFullYear()}-12-31`;
  }
}
