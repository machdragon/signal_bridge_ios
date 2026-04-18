/**
 * Emergency stop service.
 *
 * Sets up the notification "STOP ALL" action button (iOS + Android).
 * Volume-key emergency stop is handled separately in volumeKeyStop.ts.
 */

import * as Notifications from 'expo-notifications';

const NOTIFICATION_CATEGORY = 'RELAY_ACTIVE';
const STOP_ACTION_ID = 'STOP';

let stopCallback: (() => void) | null = null;
let notificationResponseSubscription: ReturnType<typeof Notifications.addNotificationResponseReceivedListener> | null = null;

/**
 * Initialize emergency stop mechanisms.
 * Call once after RelayEngine starts, passing engine.emergencyStop.
 */
export async function initEmergencyStop(onStop: () => void): Promise<void> {
  notificationResponseSubscription?.remove();
  notificationResponseSubscription = null;
  stopCallback = onStop;

  await Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  // Set up notification category with STOP ALL action
  await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORY, [
    {
      identifier: STOP_ACTION_ID,
      buttonTitle: 'STOP ALL',
      options: { isDestructive: true, opensAppToForeground: false },
    },
  ]);

  // Listen for notification action taps
  notificationResponseSubscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      if (response.actionIdentifier === STOP_ACTION_ID) {
        console.log('[EmergencyStop] Notification STOP ALL tapped');
        stopCallback?.();
      }
    },
  );
}

export function destroyEmergencyStop(): void {
  notificationResponseSubscription?.remove();
  notificationResponseSubscription = null;
  stopCallback = null;
}

/**
 * Build a notification with the STOP ALL action button visible.
 * Call this to show/update the relay notification.
 */
export async function scheduleRelayNotification(status: string): Promise<void> {
  // Dismiss previous notifications so we update-in-place rather than stacking
  await Notifications.dismissAllNotificationsAsync();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Signal Bridge',
      body: status,
      categoryIdentifier: NOTIFICATION_CATEGORY,
      sticky: true,
    },
    trigger: null, // immediate
  });
}

export async function dismissRelayNotification(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync();
}

