import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonContent, IonIcon, IonRefresher, IonRefresherContent } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline,
  arrowDownCircleOutline,
  arrowUpCircleOutline,
  calendarClearOutline,
  calendarOutline,
  checkmarkOutline,
  closeOutline,
  createOutline,
  repeatOutline,
  timeOutline,
  trashOutline,
} from 'ionicons/icons';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, finalize, forkJoin, of } from 'rxjs';
import {
  FinanceDataService,
  PlanningPayload,
  PlanningSeries,
} from '../finance-data.service';

interface PlanningOption {
  id: number;
  name: string;
}

@Component({
  selector: 'app-planning-page',
  templateUrl: './planning-page.component.html',
  styleUrls: ['./planning-page.component.scss'],
  imports: [CommonModule, IonContent, IonIcon, IonRefresher, IonRefresherContent, ReactiveFormsModule],
})
export class PlanningPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly financeData = inject(FinanceDataService);

  protected plannings: PlanningSeries[] = [];
  protected ledgerAccounts: PlanningOption[] = [];
  protected movimentAccounts: PlanningOption[] = [];
  protected showForm = false;
  protected editingPlanningId: number | null = null;
  protected valueSign: -1 | 1 = -1;
  protected isLoading = false;
  protected isSaving = false;
  protected errorMessage = '';
  protected successMessage = '';

  protected readonly planningForm = this.fb.nonNullable.group({
    description: ['', Validators.required],
    ledgerAccountId: [0, [Validators.required, Validators.min(1)]],
    movimentAccountId: [0, [Validators.required, Validators.min(1)]],
    startDatetime: ['', Validators.required],
    dayOfMonth: [1, [Validators.required, Validators.min(1), Validators.max(31)]],
    endDate: ['', Validators.required],
    value: this.fb.control<number | null>(null, Validators.required),
  });

  constructor() {
    addIcons({
      addOutline,
      arrowDownCircleOutline,
      arrowUpCircleOutline,
      calendarClearOutline,
      calendarOutline,
      checkmarkOutline,
      closeOutline,
      createOutline,
      repeatOutline,
      timeOutline,
      trashOutline,
    });
  }

  ngOnInit(): void {
    this.loadPage();
  }

  ionViewWillEnter(): void {
    this.loadPage();
  }

  protected openCreateForm(): void {
    const today = new Date();
    const end = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
    this.editingPlanningId = null;
    this.valueSign = -1;
    this.planningForm.reset({
      description: '',
      ledgerAccountId: this.ledgerAccounts[0]?.id ?? 0,
      movimentAccountId: this.movimentAccounts[0]?.id ?? 0,
      startDatetime: this.toDatetimeLocal(today),
      dayOfMonth: today.getDate(),
      endDate: this.toDateInput(end),
      value: null,
    });
    this.clearMessages();
    this.showForm = true;
  }

  protected closeForm(): void {
    this.showForm = false;
    this.editingPlanningId = null;
  }

  protected setValueSign(sign: -1 | 1): void {
    this.valueSign = sign;
  }

  protected editPlanning(planning: PlanningSeries): void {
    this.editingPlanningId = planning.planning;
    this.valueSign = Number(planning.value) < 0 ? -1 : 1;
    this.planningForm.reset({
      description: planning.description,
      ledgerAccountId: planning.ledger_account_id,
      movimentAccountId: planning.moviment_account_id,
      startDatetime: planning.start_datetime.slice(0, 16),
      dayOfMonth: planning.day_of_month,
      endDate: planning.end_date.slice(0, 10),
      value: Math.abs(Number(planning.value)),
    });
    this.clearMessages();
    this.showForm = true;
  }

  protected savePlanning(): void {
    this.planningForm.markAllAsTouched();
    this.clearMessages();

    if (this.planningForm.invalid) {
      this.errorMessage = 'Preencha todos os campos da recorrência.';
      return;
    }

    const form = this.planningForm.getRawValue();
    if (form.endDate < form.startDatetime.slice(0, 10)) {
      this.errorMessage = 'A data final deve ser igual ou posterior ao primeiro lançamento.';
      return;
    }

    const payload: PlanningPayload = {
      start_datetime: form.startDatetime,
      end_date: form.endDate,
      day_of_month: form.dayOfMonth,
      description: form.description.trim(),
      ledger_account: form.ledgerAccountId,
      moviment_account: form.movimentAccountId,
      value: Math.abs(Number(form.value)) * this.valueSign,
    };

    this.isSaving = true;
    this.financeData
      .savePlanning(this.editingPlanningId ? 'edit' : 'add', payload, this.editingPlanningId ?? undefined)
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: () => {
          this.showForm = false;
          this.successMessage = this.editingPlanningId ? 'Recorrência atualizada.' : 'Recorrência criada.';
          this.editingPlanningId = null;
          this.loadPage(undefined, false);
        },
        error: (error) => {
          this.errorMessage = error?.error?.message ?? 'Não foi possível guardar a recorrência.';
        },
      });
  }

  protected deletePlanning(planning: PlanningSeries): void {
    if (!window.confirm(`Excluir a recorrência "${planning.description}" e todos os seus lançamentos?`)) {
      return;
    }

    this.clearMessages();
    this.financeData.deletePlanning(planning.planning).subscribe({
      next: () => {
        this.successMessage = 'Recorrência excluída.';
        this.loadPage(undefined, false);
      },
      error: () => {
        this.errorMessage = 'Não foi possível excluir a recorrência.';
      },
    });
  }

  protected refresh(event: CustomEvent): void {
    this.loadPage(event);
  }

  protected toNumber(value: string | number): number {
    return Number(value) || 0;
  }

  private loadPage(refreshEvent?: CustomEvent, clearMessages = true): void {
    if (this.isLoading) {
      this.completeRefresh(refreshEvent);
      return;
    }

    this.isLoading = true;
    if (clearMessages) {
      this.clearMessages();
    }

    forkJoin({
      plannings: this.financeData.getPlanningSeries().pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('[planning] Could not load recurring series', error);
          return of([]);
        }),
      ),
      settings: this.financeData.getFinanceSettings(),
    })
      .pipe(finalize(() => {
        this.isLoading = false;
        this.completeRefresh(refreshEvent);
      }))
      .subscribe({
        next: ({ plannings, settings }) => {
          this.plannings = plannings;
          this.ledgerAccounts = settings.ledgerAccounts.map(({ id, description }) => ({ id, name: description }));
          this.movimentAccounts = settings.accounts.map(({ id, description }) => ({ id, name: description }));
          this.applyDefaultOptions();
        },
        error: () => {
          this.errorMessage = 'Não foi possível carregar o planejamento.';
        },
      });
  }

  private clearMessages(): void {
    this.errorMessage = '';
    this.successMessage = '';
  }

  private applyDefaultOptions(): void {
    if (!this.planningForm.controls.ledgerAccountId.value && this.ledgerAccounts.length > 0) {
      this.planningForm.controls.ledgerAccountId.setValue(this.ledgerAccounts[0].id);
    }

    if (!this.planningForm.controls.movimentAccountId.value && this.movimentAccounts.length > 0) {
      this.planningForm.controls.movimentAccountId.setValue(this.movimentAccounts[0].id);
    }
  }

  private completeRefresh(event?: CustomEvent): void {
    const refresher = event?.target as unknown as { complete?: () => Promise<void> | void };
    void refresher?.complete?.();
  }

  private toDatetimeLocal(date: Date): string {
    return `${this.toDateInput(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  private toDateInput(date: Date): string {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }
}
