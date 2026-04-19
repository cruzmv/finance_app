import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowDownCircleOutline, arrowUpCircleOutline, swapVerticalOutline, walletOutline } from 'ionicons/icons';
import { finalize } from 'rxjs';

interface BalanceSnapshot {
  Cash: number;
  Debito: number;
  Credito: number;
  OpenBank: number;
}

interface BalanceRow {
  id: number;
  datetime: string;
  description: string;
  ledger_account: string;
  moviment_account: string;
  status: string;
  value: string;
  balances: BalanceSnapshot;
}

interface BalanceResponse {
  message: string;
  data: BalanceRow[];
}

interface MonthSummary {
  index: number;
  label: string;
  income: number;
  outcome: number;
  balance: number;
  topExpenseLedgers: ExpenseLedgerSummary[];
  expenseChartBackground: string;
  movements: BalanceRow[];
}

interface ExpenseLedgerSummary {
  name: string;
  total: number;
  percent: number;
  color: string;
}

@Component({
  selector: 'app-finance-page',
  templateUrl: './finance-page.component.html',
  styleUrls: ['./finance-page.component.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonIcon,
    MatCardModule,
    MatProgressSpinnerModule,
    MatTableModule,
    CurrencyPipe,
    DatePipe,
  ],
})
export class FinancePageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly expenseChartColors = ['#d94841', '#f07c4a', '#e0b43b'];
  private readonly monthLabels = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  @ViewChild(IonContent) private content?: IonContent;
  @ViewChild('resultsAnchor') private resultsAnchor?: ElementRef<HTMLElement>;

  protected readonly displayedColumns = [
    'datetime',
    'description',
    'ledger',
    'account',
    'status',
    'value',
    'cash',
    'debito',
    'credito',
    'openBank',
  ];

  protected readonly endpoint = 'https://camplife.ddns.net/get_balance';
  protected transactions: BalanceRow[] = [];
  protected filteredTransactions: BalanceRow[] = [];
  protected availableYears: number[] = [];
  protected yearBalances: Record<number, number> = {};
  protected monthSummaries: MonthSummary[] = [];
  protected selectedYear: number | null = null;
  protected selectedMonthIndex: number | null = null;
  protected isLoading = false;
  protected errorMessage = '';

  constructor() {
    addIcons({ arrowDownCircleOutline, arrowUpCircleOutline, swapVerticalOutline, walletOutline });
  }

  ngOnInit() {
    this.loadBalances();
  }

  protected trackById(_: number, row: BalanceRow): number {
    return row.id;
  }

  protected get selectedMonthLabel(): string {
    if (this.selectedMonthIndex === null) {
      return 'Selected month';
    }

    return this.monthSummaries[this.selectedMonthIndex]?.label ?? 'Selected month';
  }

  protected onYearChange(year: number): void {
    this.selectedYear = year;
    this.buildMonthSummaries();
    this.selectedMonthIndex = null;
    this.filteredTransactions = [];
  }

  protected getYearBalance(year: number): number {
    return this.yearBalances[year] ?? 0;
  }

  protected selectMonth(monthIndex: number): void {
    this.selectedMonthIndex = monthIndex;
    this.filteredTransactions = this.monthSummaries.find(
      (month) => month.index === monthIndex,
    )?.movements ?? [];

    setTimeout(() => {
      requestAnimationFrame(() => {
        void this.scrollToTable();
      });
    }, 50);
  }

  private loadBalances(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.http
      .get<BalanceResponse>(this.endpoint)
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: ({ data }) => {
          this.transactions = data;
          this.availableYears = this.extractAvailableYears(data);
          this.yearBalances = this.buildYearBalances(data);
          this.selectedYear = this.availableYears.length > 0 ? this.availableYears[0] : null;
          this.buildMonthSummaries();
          this.selectedMonthIndex = null;
          this.filteredTransactions = [];
        },
        error: () => {
          this.errorMessage =
            'Unable to load finance data from Server.';
        },
      });
  }

  private extractAvailableYears(data: BalanceRow[]): number[] {
    const yearSet = new Set<number>();

    data.forEach((row) => {
      yearSet.add(new Date(row.datetime).getUTCFullYear());
    });

    return Array.from(yearSet).sort((left, right) => left - right);
  }

  private buildYearBalances(data: BalanceRow[]): Record<number, number> {
    return data.reduce<Record<number, number>>((balances, row) => {
      const year = new Date(row.datetime).getUTCFullYear();
      const value = Number(row.value);
      balances[year] = (balances[year] ?? 0) + value;
      return balances;
    }, {});
  }

  private buildMonthSummaries(): void {
    if (this.selectedYear === null) {
      this.monthSummaries = [];
      return;
    }

    this.monthSummaries = this.monthLabels.map((label, index) => {
      const movements = this.transactions.filter((row) => {
        const date = new Date(row.datetime);
        return (
          date.getUTCFullYear() === this.selectedYear &&
          date.getUTCMonth() === index
        );
      });

      const income = movements.reduce((sum, row) => {
        const value = Number(row.value);
        return value > 0 ? sum + value : sum;
      }, 0);

      const outcome = movements.reduce((sum, row) => {
        const value = Number(row.value);
        return value < 0 ? sum + Math.abs(value) : sum;
      }, 0);

      const topExpenseLedgers = this.buildTopExpenseLedgers(movements);
      const expenseChartBackground = this.buildExpenseChartBackground(topExpenseLedgers);

      return {
        index,
        label,
        income,
        outcome,
        balance: income - outcome,
        topExpenseLedgers,
        expenseChartBackground,
        movements,
      };
    });
  }

  private buildTopExpenseLedgers(movements: BalanceRow[]): ExpenseLedgerSummary[] {
    const expenseTotals = new Map<string, number>();

    movements.forEach((row) => {
      const value = Number(row.value);

      if (value >= 0) {
        return;
      }

      const currentTotal = expenseTotals.get(row.ledger_account) ?? 0;
      expenseTotals.set(row.ledger_account, currentTotal + Math.abs(value));
    });

    const topExpenseLedgers = Array.from(expenseTotals.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((left, right) => right.total - left.total)
      .slice(0, 3);

    if (topExpenseLedgers.length === 0) {
      return [
        {
          name: 'No expenses',
          total: 0,
          percent: 100,
          color: this.expenseChartColors[0],
        },
      ];
    }

    const totalExpenses = topExpenseLedgers.reduce((sum, ledger) => sum + ledger.total, 0);

    return topExpenseLedgers.map((ledger, index) => ({
      ...ledger,
      percent: totalExpenses > 0 ? (ledger.total / totalExpenses) * 100 : 0,
      color: this.expenseChartColors[index % this.expenseChartColors.length],
    }));
  }

  private buildExpenseChartBackground(ledgers: ExpenseLedgerSummary[]): string {
    if (ledgers.length === 0) {
      return `conic-gradient(${this.expenseChartColors[0]} 0deg 360deg)`;
    }

    let currentAngle = 0;
    const segments = ledgers.map((ledger) => {
      const start = currentAngle;
      const sweep = (ledger.percent / 100) * 360;
      currentAngle += sweep;
      return `${ledger.color} ${start}deg ${currentAngle}deg`;
    });

    if (currentAngle < 360) {
      segments.push(`rgba(19, 49, 39, 0.08) ${currentAngle}deg 360deg`);
    }

    return `conic-gradient(${segments.join(', ')})`;
  }

  private async scrollToTable(): Promise<void> {
    if (!this.content || !this.resultsAnchor) {
      return;
    }

    const targetY = Math.max(this.resultsAnchor.nativeElement.offsetTop - 16, 0);

    await this.content.scrollToPoint(0, targetY, 500);
  }
}
