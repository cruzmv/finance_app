import { BalanceRow, ContractOnboardingSetup, LedgerAccountSettings, MovimentAccountSettings } from './finance-data.service';

export type NotificationRuleType =
  'movement-due'
  | 'credit-confirmation'
  | 'category-limit'
  | 'account-limit'
  | 'entry-reminder';

export type MovementDirection = 'payable' | 'receivable' | 'both';

export interface NotificationRule {
  id: string;
  type: NotificationRuleType;
  enabled: boolean;
  label?: string;
  direction?: MovementDirection;
  leadMinutes?: number;
  delayMinutes?: number;
  ledgerAccountId?: number;
  movimentAccountId?: number;
  limitValue?: number;
  thresholdPercent?: number;
  intervalHours?: number;
}

export interface AppNotification {
  id: string;
  ruleId: string;
  ruleType: NotificationRuleType;
  movement?: BalanceRow;
  title: string;
  message: string;
  dueLabel: string;
  isRead: boolean;
  triggerTime?: number;
}

export interface NotificationEvaluationContext {
  rows: BalanceRow[];
  accounts: MovimentAccountSettings[];
  ledgerAccounts: LedgerAccountSettings[];
  onboardingSetup: ContractOnboardingSetup | null;
  readIds: Set<string>;
  now: Date;
  includeFutureTriggers?: boolean;
}

export function getNotificationRules(onboardingSetup: ContractOnboardingSetup | null): NotificationRule[] {
  const settings = getNotificationSettings(onboardingSetup);
  const rules = Array.isArray(settings['rules']) ? settings['rules'] : [];

  return rules
    .map((rule) => normalizeRule(rule))
    .filter((rule): rule is NotificationRule => Boolean(rule));
}

export function setNotificationRules(
  onboardingSetup: ContractOnboardingSetup | null,
  rules: NotificationRule[],
): ContractOnboardingSetup {
  return {
    ...(onboardingSetup ?? {}),
    notificationSettings: {
      ...getNotificationSettings(onboardingSetup),
      rules,
    },
  };
}

export function evaluateNotifications(context: NotificationEvaluationContext): AppNotification[] {
  const rules = getNotificationRules(context.onboardingSetup).filter((rule) => rule.enabled);

  return rules
    .reduce<AppNotification[]>((notifications, rule) => {
      return notifications.concat(evaluateRule(rule, context));
    }, [])
    .filter((notification) => !notification.isRead)
    .sort((left, right) => (left.triggerTime ?? 0) - (right.triggerTime ?? 0));
}

export function getRuleTypeLabel(type: NotificationRuleType): string {
  const labels: Record<NotificationRuleType, string> = {
    'movement-due': 'A pagar / A receber',
    'credit-confirmation': 'Confirmação no crédito',
    'category-limit': 'Limite por categoria',
    'account-limit': 'Limite por conta',
    'entry-reminder': 'Lembrete de lançamentos',
  };

  return labels[type];
}

export function getRuleSummary(
  rule: NotificationRule,
  accounts: MovimentAccountSettings[],
  ledgerAccounts: LedgerAccountSettings[],
): string {
  if (rule.type === 'movement-due') {
    return `${getDirectionLabel(rule.direction ?? 'both')} ${formatDuration(rule.leadMinutes ?? 360)} antes`;
  }

  if (rule.type === 'credit-confirmation') {
    return `${formatDuration(rule.delayMinutes ?? 1440)} depois do lançamento`;
  }

  if (rule.type === 'category-limit') {
    const category = ledgerAccounts.find((item) => item.id === rule.ledgerAccountId)?.description ?? 'Categoria';
    return `${category}: ${rule.thresholdPercent ?? 80}% de ${formatNumber(rule.limitValue)}`;
  }

  if (rule.type === 'account-limit') {
    const account = accounts.find((item) => item.id === rule.movimentAccountId)?.description ?? 'Conta';
    return `${account}: ${rule.thresholdPercent ?? 80}% de ${formatNumber(rule.limitValue)}`;
  }

  return `A cada ${rule.intervalHours ?? 12}h`;
}

function evaluateRule(rule: NotificationRule, context: NotificationEvaluationContext): AppNotification[] {
  if (rule.type === 'movement-due') {
    return evaluateMovementDueRule(rule, context);
  }

  if (rule.type === 'credit-confirmation') {
    return evaluateCreditConfirmationRule(rule, context);
  }

  if (rule.type === 'category-limit') {
    return evaluateCategoryLimitRule(rule, context);
  }

  if (rule.type === 'account-limit') {
    return evaluateAccountLimitRule(rule, context);
  }

  return evaluateEntryReminderRule(rule, context);
}

function evaluateMovementDueRule(rule: NotificationRule, context: NotificationEvaluationContext): AppNotification[] {
  const leadMs = minutesToMs(rule.leadMinutes ?? 360);
  const nowTime = context.now.getTime();
  const direction = rule.direction ?? 'both';

  return context.rows
    .filter((row) => isStatus(row, 'provisionado'))
    .filter((row) => direction === 'both' || (direction === 'payable' ? Number(row.value) < 0 : Number(row.value) > 0))
    .filter((row) => {
      const time = getTime(row);
      const triggerTime = time - leadMs;

      // Overdue provisioned movements remain actionable in the bell. Native
      // scheduling can additionally ask for every future trigger so the OS can
      // deliver it while the app is closed.
      return context.includeFutureTriggers || triggerTime <= nowTime;
    })
    .map((row) => {
      const id = `${rule.id}:movement:${row.id}:${row.datetime}`;
      const isExpense = Number(row.value) < 0;

      return {
        id,
        ruleId: rule.id,
        ruleType: rule.type,
        movement: row,
        title: isExpense ? 'Conta perto de vencer' : 'Recebimento previsto',
        message: `"${row.description}" está prevista para acontecer em breve.`,
        dueLabel: getFriendlyDateTime(row.datetime),
        isRead: context.readIds.has(id),
        triggerTime: getTime(row) - leadMs,
      };
    });
}

function evaluateCreditConfirmationRule(rule: NotificationRule, context: NotificationEvaluationContext): AppNotification[] {
  const delayMs = minutesToMs(rule.delayMinutes ?? 1440);
  const nowTime = context.now.getTime();

  return context.rows
    .filter((row) => row.account_type === 1)
    .filter((row) => Number(row.value) < 0)
    .filter((row) => isStatus(row, 'consumado'))
    .filter((row) => (row.credit_status ?? '').toLowerCase() !== 'confirmed')
    .filter((row) => getTime(row) + delayMs <= nowTime)
    .map((row) => {
      const id = `${rule.id}:credit:${row.id}:${row.datetime}`;

      return {
        id,
        ruleId: rule.id,
        ruleType: rule.type,
        movement: row,
        title: 'Confirmar lançamento no crédito',
        message: `Confira se "${row.description}" já apareceu na fatura do cartão.`,
        dueLabel: getFriendlyDateTime(row.datetime),
        isRead: context.readIds.has(id),
        triggerTime: getTime(row) + delayMs,
      };
    });
}

function evaluateCategoryLimitRule(rule: NotificationRule, context: NotificationEvaluationContext): AppNotification[] {
  const limit = Number(rule.limitValue) || 0;
  const threshold = Number(rule.thresholdPercent) || 0;

  if (!rule.ledgerAccountId || limit <= 0 || threshold <= 0) {
    return [];
  }

  const now = context.now;
  const spent = Math.abs(context.rows
    .filter((row) => isSameMonth(row, now))
    .filter((row) => Number(row.ledger_account_id) === rule.ledgerAccountId)
    .filter((row) => isStatus(row, 'consumado'))
    .filter((row) => Number(row.value) < 0)
    .reduce((total, row) => total + Number(row.value), 0));
  const triggerValue = limit * threshold / 100;

  if (spent < triggerValue) {
    return [];
  }

  const category = context.ledgerAccounts.find((item) => item.id === rule.ledgerAccountId)?.description ?? 'categoria';
  const id = `${rule.id}:category:${now.getFullYear()}-${now.getMonth()}`;

  return [{
    id,
    ruleId: rule.id,
    ruleType: rule.type,
    title: 'Limite de categoria atingido',
    message: `${category} já chegou a ${formatNumber(spent)} de ${formatNumber(limit)}.`,
    dueLabel: `${Math.round(spent / limit * 100)}% do limite`,
    isRead: context.readIds.has(id),
    triggerTime: now.getTime(),
  }];
}

function evaluateAccountLimitRule(rule: NotificationRule, context: NotificationEvaluationContext): AppNotification[] {
  const limit = Number(rule.limitValue) || 0;
  const threshold = Number(rule.thresholdPercent) || 0;

  if (!rule.movimentAccountId || limit <= 0 || threshold <= 0) {
    return [];
  }

  const account = context.accounts.find((item) => item.id === rule.movimentAccountId);
  const latestBalance = getLatestAccountBalance(context.rows, account, context.now);
  const triggerValue = limit * threshold / 100;

  if (latestBalance === null || latestBalance > triggerValue) {
    return [];
  }

  const id = `${rule.id}:account:${context.now.getFullYear()}-${context.now.getMonth()}-${context.now.getDate()}`;

  return [{
    id,
    ruleId: rule.id,
    ruleType: rule.type,
    title: 'Limite de conta atingido',
    message: `${account?.description ?? 'Conta'} está em ${formatNumber(latestBalance)}.`,
    dueLabel: `${Math.round(latestBalance / limit * 100)}% de ${formatNumber(limit)}`,
    isRead: context.readIds.has(id),
    triggerTime: context.now.getTime(),
  }];
}

function evaluateEntryReminderRule(rule: NotificationRule, context: NotificationEvaluationContext): AppNotification[] {
  const intervalHours = Number(rule.intervalHours) || 12;
  const nowTime = context.now.getTime();
  const latestEntryTime = context.rows.reduce((latest, row) => {
    const time = getTime(row);
    return time <= nowTime ? Math.max(latest, time) : latest;
  }, 0);
  const referenceTime = latestEntryTime || Number(localStorage.getItem('notificationEntryReminderStartedAt')) || nowTime;
  const dueTime = referenceTime + intervalHours * 60 * 60 * 1000;

  if (!localStorage.getItem('notificationEntryReminderStartedAt')) {
    localStorage.setItem('notificationEntryReminderStartedAt', String(referenceTime));
  }

  if (dueTime > nowTime) {
    return [];
  }

  const id = `${rule.id}:entry:${Math.floor(nowTime / (intervalHours * 60 * 60 * 1000))}`;

  return [{
    id,
    ruleId: rule.id,
    ruleType: rule.type,
    title: 'Registrar movimentos',
    message: 'Já faz um tempo desde o último lançamento. Vale atualizar suas movimentações.',
    dueLabel: `A cada ${intervalHours}h`,
    isRead: context.readIds.has(id),
    triggerTime: dueTime,
  }];
}

function getNotificationSettings(onboardingSetup: ContractOnboardingSetup | null): Record<string, unknown> {
  const settings = onboardingSetup?.['notificationSettings'];
  return settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : {};
}

function normalizeRule(value: unknown): NotificationRule | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const rule = value as NotificationRule;
  const validTypes: NotificationRuleType[] = [
    'movement-due',
    'credit-confirmation',
    'category-limit',
    'account-limit',
    'entry-reminder',
  ];

  if (!rule.id || !validTypes.includes(rule.type)) {
    return null;
  }

  return {
    ...rule,
    enabled: rule.enabled !== false,
  };
}

function getLatestAccountBalance(rows: BalanceRow[], account: MovimentAccountSettings | undefined, now: Date): number | null {
  if (!account) {
    return null;
  }

  const latestRow = rows
    .filter((row) => getTime(row) <= now.getTime())
    .sort((left, right) => getTime(right) - getTime(left))[0];

  if (!latestRow?.balances) {
    return null;
  }

  const byId = latestRow.balances[String(account.id)];
  if (typeof byId === 'number') {
    return byId;
  }

  const byDescription = latestRow.balances[account.description];
  return typeof byDescription === 'number' ? byDescription : null;
}

function getDirectionLabel(direction: MovementDirection): string {
  if (direction === 'payable') {
    return 'A pagar';
  }

  if (direction === 'receivable') {
    return 'A receber';
  }

  return 'A pagar e a receber';
}

function isSameMonth(row: BalanceRow, date: Date): boolean {
  const rowDate = new Date(row.datetime);
  return rowDate.getFullYear() === date.getFullYear() && rowDate.getMonth() === date.getMonth();
}

function isStatus(row: BalanceRow, status: string): boolean {
  return row.status?.trim().toLowerCase() === status;
}

function getTime(row: BalanceRow): number {
  return new Date(row.datetime).getTime();
}

function getFriendlyDateTime(datetime: string): string {
  const date = new Date(datetime);
  const dateLabel = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  return `${dateLabel}, ${timeLabel}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = minutes / 60;
  return `${hours}h`;
}

function formatNumber(value: number | undefined): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}
