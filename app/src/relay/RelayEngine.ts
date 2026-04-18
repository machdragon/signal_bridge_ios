/**
 * RelayEngine — orchestrates all relay components.
 *
 * Lifecycle:
 *  1. Connect to Intiface Central → Buttplug handshake → scan devices
 *  2. Connect to VPS server → JWT auth → send device list
 *  3. Enter relay loop: route server commands to Intiface, respond with acks
 *  4. Heartbeat watchdog: if no server ping in 12s while ACTIVE → local emergency stop
 *  5. On disconnect: clean up, retry with exponential backoff (5 attempts max)
 *
 * Key safety invariant: reconnect always lands in IDLE, never auto-resumes ACTIVE.
 */

import { AppState, AppStateStatus, Platform } from 'react-native';
import { IntifaceConnection } from './IntifaceConnection';
import { ServerConnection, AuthenticationError, GovernorSnapshot } from './ServerConnection';
import { DeviceManager } from './DeviceManager';
import { PatternRunner } from './PatternRunner';
import { useRelayStore } from '../store/relayStore';
import { RelayState, ConnectionHealth } from './ConnectionStateMachine';

export interface RelayEngineConfig {
  serverUrl: string;
  token: string;
  intifaceUrl: string;
  onNotificationUpdate: (status: string) => void;
  /** Fired when the relay loop exits for any reason (natural stop or explicit stop). */
  onStopped?: () => void;
}

export class RelayEngine {
  private config: RelayEngineConfig;

  private intiface: IntifaceConnection | null = null;
  private server: ServerConnection | null = null;
  private deviceManager: DeviceManager | null = null;
  private patternRunner: PatternRunner | null = null;

  private isRunning = false;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatTime = 0;

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max; give up after MAX_RETRIES
  private retryCount = 0;
  private static readonly MAX_RETRIES = 5;

  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  private removeServerCommandListener: (() => void) | null = null;
  private removeServerDisconnectListener: (() => void) | null = null;
  private removeDeviceEventListener: (() => void) | null = null;

  // Signaling mechanism to break the "wait for commands" phase on disconnect
  private disconnectSignal: (() => void) | null = null;

  constructor(config: RelayEngineConfig) {
    this.config = config;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.retryCount = 0;

    // iOS dead man's switch: stop all devices if app goes to background
    this.appStateSubscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (Platform.OS === 'ios' && state === 'background') {
          console.log('[RelayEngine] iOS: app backgrounded → emergency stop');
          this.emergencyStop().catch(() => {});
        }
      },
    );

    this.setState('CONNECTING');
    this.relayLoop().catch((e) =>
      console.error('[RelayEngine] relay loop crashed:', e),
    );
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.disconnectSignal?.();
    this.stopWatchdog();
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;

    await this.patternRunner?.emergencyStopAll().catch(() => {});
    this.patternRunner?.destroy();

    try { await this.server?.close(); } catch { /* ignore */ }
    try { await this.intiface?.close(); } catch { /* ignore */ }

    this.cleanup();
    useRelayStore.getState().reset();
  }

  async emergencyStop(): Promise<void> {
    console.log('[RelayEngine] EMERGENCY STOP');
    await this.patternRunner?.emergencyStopAll().catch(() => {});
    try { await this.server?.sendEmergencyStop(); } catch { /* ignore */ }
    try {
      await this.server?.sendAck(true, 'Emergency stop triggered on phone', 'emergency', this.deviceManager?.availableDevices() ?? []);
    } catch { /* ignore */ }
    const currentState = useRelayStore.getState().state;
    if (currentState !== 'DISCONNECTED' && currentState !== 'ERROR') {
      this.setState('IDLE');
    }
  }

  async ping(): Promise<void> {
    await this.server?.sendPong();
  }

  // ── Main relay loop ─────────────────────────────────────────────

  private async relayLoop(): Promise<void> {
    try {
    while (this.isRunning) {
      try {
        // Step 1: Connect to Intiface
        const intf = new IntifaceConnection(this.config.intifaceUrl);
        this.intiface = intf;

        try {
          await intf.connect();
        } catch (e) {
          console.log('[RelayEngine] Can\'t reach Intiface Central:', e);
          try { await intf.close(); } catch { /* ignore */ }
          this.intiface = null;
          this.setError("Can't reach Intiface Central. Is it running?");
          this.updateHealth({ intifaceConnected: false });
          this.setState('ERROR');
          this.config.onNotificationUpdate("Can't reach Intiface");
          if (this.retryCount >= RelayEngine.MAX_RETRIES) {
            this.config.onNotificationUpdate('Connection failed — tap to retry');
            this.isRunning = false;
            return;
          }
          const backoff = this.nextBackoffMs();
          await delay(backoff);
          continue;
        }

        // Step 2: Scan for devices
        await intf.scan(5000);
        const dm = new DeviceManager();
        this.deviceManager = dm;
        for (const [, device] of intf.devices) {
          dm.addDevice(device);
        }

        // Listen for device add/remove events
        this.removeDeviceEventListener?.();
        this.removeDeviceEventListener = intf.onDeviceEvent((event) => {
          if (event.type === 'DeviceAdded') {
            dm.addDevice(event.device);
            useRelayStore.getState().updateDevices(dm.buildDeviceInfoList());
            this.config.onNotificationUpdate(`Connected (${dm.deviceCount} devices)`);
            this.server?.sendDeviceList(dm.buildDeviceListReport()).catch(() => {});
          } else if (event.type === 'DeviceRemoved') {
            dm.removeDevice(event.deviceIndex);
            useRelayStore.getState().updateDevices(dm.buildDeviceInfoList());
            this.config.onNotificationUpdate(`Connected (${dm.deviceCount} devices)`);
            this.server?.sendDeviceList(dm.buildDeviceListReport()).catch(() => {});
          } else if (event.type === 'DeviceList') {
            for (const dev of event.devices) dm.addDevice(dev);
            useRelayStore.getState().updateDevices(dm.buildDeviceInfoList());
          }
        });

        this.updateHealth({ intifaceConnected: true, intifaceHealthy: true });

        // Step 3: Connect to VPS server
        const srv = new ServerConnection(this.config.serverUrl, this.config.token);
        this.server = srv;

        try {
          await srv.connect();
        } catch (e) {
          if (e instanceof AuthenticationError) {
            try { await srv.close(); } catch { /* ignore */ }
            try { await intf.close(); } catch { /* ignore */ }
            this.removeDeviceEventListener?.();
            this.removeDeviceEventListener = null;
            this.server = null;
            this.intiface = null;
            this.setError('Authentication failed. Try signing out and back in.');
            this.setState('ERROR');
            this.config.onNotificationUpdate('Auth failed');
            this.isRunning = false;
            return;
          }
          console.log('[RelayEngine] Can\'t reach server:', e);
          try { await srv.close(); } catch { /* ignore */ }
          try { await intf.close(); } catch { /* ignore */ }
          this.removeDeviceEventListener?.();
          this.removeDeviceEventListener = null;
          this.server = null;
          this.intiface = null;
          this.setError(`Can't reach server: ${String(e)}`);
          this.updateHealth({ serverConnected: false });
          this.setState('ERROR');
          this.config.onNotificationUpdate("Can't reach server");
          if (this.retryCount >= RelayEngine.MAX_RETRIES) {
            this.isRunning = false;
            return;
          }
          await delay(this.nextBackoffMs());
          continue;
        }

        // Step 4: Send device list
        const deviceList = dm.buildDeviceListReport();
        if (deviceList.length > 0) {
          await srv.sendDeviceList(deviceList).catch(() => {});
        }

        this.updateHealth({ serverConnected: true, intifaceConnected: true, intifaceHealthy: true });
        useRelayStore.getState().updateDevices(dm.buildDeviceInfoList());
        this.setError(null);
        this.resetBackoff();
        this.setState('IDLE');
        this.config.onNotificationUpdate(`Connected (${dm.deviceCount} devices)`);

        // Step 5: Create pattern runner
        const runner = new PatternRunner(intf, dm, (updatedDevices) => {
          useRelayStore.getState().updateDevices(updatedDevices);
        });
        this.patternRunner = runner;

        // Step 6: Start heartbeat watchdog
        this.lastHeartbeatTime = Date.now();
        this.startWatchdog(dm);

        // Wire heartbeat callbacks
        srv.onHeartbeatReceived = () => {
          this.lastHeartbeatTime = Date.now();
        };
        srv.onGovernorUpdate = (gov) => this.handleGovernorUpdate(gov, dm);

        // Step 7: Listen for incoming commands
        // Wait until the connection drops (disconnect event fires)
        await new Promise<void>((resolve) => {
          this.disconnectSignal = resolve;

          this.removeServerCommandListener?.();
          this.removeServerCommandListener = srv.onCommand(async (msg) => {
            // Update heartbeat timestamp — any server message counts as proof of liveness
            this.lastHeartbeatTime = Date.now();
            try {
              const ack = await runner.runCommand(msg.type, msg.payload);
              await srv.sendAck(ack.success, ack.message, ack.requestId, ack.devicesAffected).catch(() => {});
              if (msg.type === 'scan') {
                await srv.sendDeviceList(dm.buildDeviceListReport()).catch(() => {});
                useRelayStore.getState().updateDevices(dm.buildDeviceInfoList());
              }
              if (ack.success) {
                if (dm.hasActiveDevices) {
                  this.setState('ACTIVE');
                } else if (useRelayStore.getState().state === 'ACTIVE') {
                  this.setState('IDLE');
                }
              }
            } catch (e) {
              console.error('[RelayEngine] command error:', e);
              await srv.sendAck(false, `Error: ${String(e)}`, (msg.payload.request_id as string) ?? '', []).catch(() => {});
            }
          });

          this.removeServerDisconnectListener?.();
          this.removeServerDisconnectListener = srv.onDisconnect(() => {
            console.log('[RelayEngine] Server disconnected');
            resolve();
          });
        });

        this.disconnectSignal = null;

      } catch (e) {
        console.error('[RelayEngine] relay error:', e);
      }

      // Cleanup before retry
      this.stopWatchdog();
      await this.patternRunner?.emergencyStopAll().catch(() => {});
      this.patternRunner?.destroy();
      try { await this.server?.close(); } catch { /* ignore */ }
      try { await this.intiface?.close(); } catch { /* ignore */ }
      this.cleanup();

      if (this.isRunning) {
        if (this.retryCount >= RelayEngine.MAX_RETRIES) {
          this.setError('Connection lost. Tap Connect to try again.');
          this.setState('DISCONNECTED');
          this.config.onNotificationUpdate('Disconnected — tap to retry');
          this.isRunning = false;
        } else {
          const backoff = this.nextBackoffMs();
          console.log(`[RelayEngine] Reconnecting in ${backoff}ms (attempt ${this.retryCount}/${RelayEngine.MAX_RETRIES})`);
          this.setState('CONNECTING');
          this.config.onNotificationUpdate(`Reconnecting (${this.retryCount}/${RelayEngine.MAX_RETRIES})…`);
          await delay(backoff);
        }
      }
    }
    } finally {
      this.appStateSubscription?.remove();
      this.appStateSubscription = null;
      this.config.onStopped?.();
    }
  }

  // ── Watchdog ───────────────────────────────────────────────────

  private startWatchdog(dm: DeviceManager): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      const sinceLastPing = Date.now() - this.lastHeartbeatTime;
      useRelayStore.getState().updateHealth({
        serverConnected: this.server?.isConnected ?? false,
        intifaceConnected: this.intiface?.isConnected ?? false,
        intifaceHealthy: this.intiface?.isConnected ?? false,
        lastHeartbeatAgo: sinceLastPing,
      });

      if (sinceLastPing > 12_000 && useRelayStore.getState().state === 'ACTIVE') {
        console.warn('[RelayEngine] WATCHDOG: no server ping — emergency stop');
        this.emergencyStop().catch(() => {});
        this.config.onNotificationUpdate('WATCHDOG: Lost server — stopped all');
      }
    }, 3000);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  // ── Governor ───────────────────────────────────────────────────

  private handleGovernorUpdate(gov: GovernorSnapshot, dm: DeviceManager): void {
    useRelayStore.getState().updateGovernor({
      heatPct: gov.heatPct,
      inCooldown: gov.inCooldown,
      cooldownRemaining: gov.cooldownRemaining,
      cooldownCount: gov.cooldownCount,
      predictedSeconds: gov.predictedSeconds,
    });

    const current = useRelayStore.getState().state;
    if (gov.inCooldown && current === 'ACTIVE') {
      this.setState('COOLDOWN');
      this.config.onNotificationUpdate(`Cooldown (${gov.cooldownRemaining}s)`);
    } else if (!gov.inCooldown && current === 'COOLDOWN') {
      this.setState('IDLE');
      this.config.onNotificationUpdate(`Connected (${dm.deviceCount} devices)`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  private setState(state: RelayState): void {
    useRelayStore.getState().setState(state);
  }

  private setError(msg: string | null): void {
    useRelayStore.getState().setError(msg);
  }

  private updateHealth(partial: Partial<ConnectionHealth>): void {
    const current = useRelayStore.getState().health;
    useRelayStore.getState().updateHealth({ ...current, ...partial });
  }

  private cleanup(): void {
    this.removeServerCommandListener?.();
    this.removeServerDisconnectListener?.();
    this.removeDeviceEventListener?.();
    this.removeServerCommandListener = null;
    this.removeServerDisconnectListener = null;
    this.removeDeviceEventListener = null;
    this.server = null;
    this.intiface = null;
    this.deviceManager = null;
    this.patternRunner = null;
  }

  private nextBackoffMs(): number {
    const ms = Math.min(1000 * (1 << this.retryCount), 30_000);
    this.retryCount++;
    return ms;
  }

  private resetBackoff(): void {
    this.retryCount = 0;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
