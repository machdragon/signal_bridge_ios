/**
 * Background task registration for Android.
 *
 * Android: expo-task-manager + expo-background-fetch keeps the relay alive.
 * iOS: background-fetch is not used; persistent relay is maintained via the VoIP
 *      keep-alive callback (~600s interval) registered in VoIPKeepAlive.swift.
 *      RelayEngine also listens to AppState for foreground reconnection (see RelayEngine.ts).
 *
 * NOTE: On Android, this task fires at most every ~15 minutes by the OS.
 *       The foreground RelayEngine handles real-time relay; this is a recovery
 *       mechanism to reconnect if the engine dropped while the app was in the background.
 */

import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { Platform } from 'react-native';

const TASK_NAME = 'RELAY_KEEPALIVE';

let onKeepalive: (() => void) | null = null;

/** Set a callback to run on each background keepalive tick. */
export function setKeepaliveCallback(cb: () => void): void {
  onKeepalive = cb;
}

// Define the task at module load time (required by expo-task-manager)
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    console.log('[BackgroundTask] keepalive tick');
    onKeepalive?.();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Register the background keepalive task (Android only).
 * Safe to call multiple times — silently no-ops on iOS and if already registered.
 */
export async function registerBackgroundTask(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (isRegistered) return;
  await BackgroundFetch.registerTaskAsync(TASK_NAME, {
    minimumInterval: 15, // minimum 15 seconds (OS may delay further)
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

/**
 * Unregister the background task (e.g. on logout).
 */
export async function unregisterBackgroundTask(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (isRegistered) {
    await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
  }
}
