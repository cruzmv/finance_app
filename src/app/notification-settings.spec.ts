import { BalanceRow } from './finance-data.service';
import { evaluateNotifications } from './notification-settings';

describe('evaluateNotifications', () => {
  const now = new Date('2026-07-21T12:00:00.000Z');
  const rule = {
    id: 'due-rule',
    type: 'movement-due',
    enabled: true,
    direction: 'both',
    leadMinutes: 60,
  };

  function movement(id: number, datetime: string, status = 'Provisionado'): BalanceRow {
    return {
      id,
      datetime,
      description: `Movimento ${id}`,
      ledger_account_id: 1,
      ledger_account: 'Contas',
      moviment_account_id: 1,
      moviment_account: 'Conta',
      status_id: 1,
      status,
      value: '-10',
      balances: {},
      credit_status: null,
      credit_bill: null,
      account_type: 0,
    };
  }

  function evaluate(rows: BalanceRow[], includeFutureTriggers = false) {
    return evaluateNotifications({
      rows,
      accounts: [],
      ledgerAccounts: [],
      onboardingSetup: { notificationSettings: { rules: [rule] } },
      readIds: new Set<string>(),
      now,
      includeFutureTriggers,
    });
  }

  it('keeps an overdue provisioned movement in the bell', () => {
    expect(evaluate([movement(1, '2026-07-20T12:00:00.000Z')]).map((item) => item.movement?.id)).toEqual([1]);
  });

  it('does not show a future notification before its lead window', () => {
    expect(evaluate([movement(2, '2026-07-23T12:00:00.000Z')])).toEqual([]);
  });

  it('returns future triggers when preparing native scheduling', () => {
    const notifications = evaluate([movement(3, '2026-07-23T12:00:00.000Z')], true);

    expect(notifications.length).toBe(1);
    expect(notifications[0].triggerTime).toBe(new Date('2026-07-23T11:00:00.000Z').getTime());
  });

  it('removes a notification after the movement is settled', () => {
    expect(evaluate([movement(4, '2026-07-20T12:00:00.000Z', 'Consumado')])).toEqual([]);
  });
});
