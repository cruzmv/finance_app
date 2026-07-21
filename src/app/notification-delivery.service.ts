import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { AppNotification } from './notification-settings';

@Injectable({ providedIn: 'root' })
export class NotificationDeliveryService {
  private readonly channelId = 'salarium-alerts';
  private channelReady = false;

  get usesNativeNotifications(): boolean {
    return Capacitor.isNativePlatform();
  }

  async scheduleNativeNotifications(notifications: AppNotification[], skippedIds: Set<string>): Promise<Set<string>> {
    if (!this.usesNativeNotifications || notifications.length === 0) {
      return new Set<string>();
    }

    const canNotify = await this.ensureNativePermission();

    if (!canNotify) {
      return new Set<string>();
    }

    await this.ensureAndroidChannel();

    const scheduledIds = new Set<string>();
    const now = Date.now();
    const pending = await LocalNotifications.getPending();
    const pendingIds = new Set(pending.notifications.map((notification) => notification.id));
    const nativeNotifications = notifications
      .filter((notification) => !skippedIds.has(notification.id))
      .filter((notification) => !pendingIds.has(this.toNativeId(notification.id)))
      .map((notification) => {
        const triggerTime = notification.triggerTime ?? now;
        const nativeId = this.toNativeId(notification.id);
        scheduledIds.add(notification.id);

        return {
          id: nativeId,
          title: notification.title,
          body: notification.message,
          largeBody: notification.message,
          channelId: this.channelId,
          autoCancel: true,
          schedule: triggerTime > now + 1000 ? { at: new Date(triggerTime) } : undefined,
          extra: {
            appNotificationId: notification.id,
            movementId: notification.movement?.id,
          },
        };
      });

    if (nativeNotifications.length > 0) {
      await LocalNotifications.schedule({ notifications: nativeNotifications });
    }

    return scheduledIds;
  }

  async showNow(notification: AppNotification): Promise<boolean> {
    if (this.usesNativeNotifications) {
      const scheduledIds = await this.scheduleNativeNotifications([notification], new Set<string>());
      return scheduledIds.has(notification.id);
    }

    if (!this.canUseWebNotifications()) {
      return false;
    }

    const webNotification = new Notification(notification.title, {
      body: notification.message,
      tag: notification.id,
    });

    webNotification.onclick = () => window.focus();
    return true;
  }

  async cancelNativeNotification(notificationId: string): Promise<void> {
    if (!this.usesNativeNotifications) {
      return;
    }

    await LocalNotifications.cancel({ notifications: [{ id: this.toNativeId(notificationId) }] });
  }

  async requestPermission(): Promise<boolean> {
    if (this.usesNativeNotifications) {
      return this.ensureNativePermission();
    }

    if (!('Notification' in window)) {
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'default') {
      return (await Notification.requestPermission()) === 'granted';
    }

    return false;
  }

  private async ensureNativePermission(): Promise<boolean> {
    const current = await LocalNotifications.checkPermissions();

    if (current.display === 'granted') {
      return true;
    }

    if (current.display === 'denied') {
      return false;
    }

    const requested = await LocalNotifications.requestPermissions();
    return requested.display === 'granted';
  }

  private async ensureAndroidChannel(): Promise<void> {
    if (this.channelReady || Capacitor.getPlatform() !== 'android') {
      return;
    }

    await LocalNotifications.createChannel({
      id: this.channelId,
      name: 'Alertas do SalariuM',
      description: 'Lembretes financeiros, vencimentos e alertas configurados.',
      importance: 4,
      visibility: 1,
      lights: true,
      lightColor: '#07864f',
      vibration: true,
    });
    this.channelReady = true;
  }

  private canUseWebNotifications(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  private toNativeId(id: string): number {
    const hash = Array.from(id).reduce((value, character) => {
      return ((value << 5) - value + character.charCodeAt(0)) | 0;
    }, 0);

    return (Math.abs(hash) % 2_147_483_646) + 1;
  }
}
