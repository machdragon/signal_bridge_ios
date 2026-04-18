/**
 * IntifaceConnection — WebSocket connection to Intiface Central.
 *
 * Uses React Native's built-in WebSocket API (works on both iOS + Android).
 *
 * Handles:
 *  - Buttplug v3 handshake (RequestServerInfo)
 *  - Device scanning + tracking (DeviceAdded, DeviceRemoved, DeviceList)
 *  - ScalarCmd (vibrate / rotate / oscillate / etc.)
 *  - StopDeviceCmd / StopAllDevices
 *  - Health ping (RequestDeviceList every 15s)
 */

import {
  ButtplugDevice,
  ButtplugEvent,
  ScalarEntry,
  buildRequestServerInfo,
  buildStartScanning,
  buildRequestDeviceList,
  buildScalarCmd,
  buildStopDeviceCmd,
  buildStopAllDevices,
  parseButtplugMessages,
} from './ButtplugMessages';

type DeviceEventListener = (event: ButtplugEvent) => void;

export class IntifaceConnection {
  private url: string;
  private ws: WebSocket | null = null;
  private msgId = 0;
  private _isConnected = false;
  private healthPingTimer: ReturnType<typeof setInterval> | null = null;
  private deviceEventListeners: DeviceEventListener[] = [];

  // Devices tracked from Buttplug events
  private _devices = new Map<number, ButtplugDevice>();

  // Pending handshake resolve/reject
  private handshakeResolve: (() => void) | null = null;
  private handshakeReject: ((e: Error) => void) | null = null;

  constructor(url = 'ws://127.0.0.1:12345') {
    this.url = url;
  }

  get devices(): ReadonlyMap<number, ButtplugDevice> {
    return this._devices;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  onDeviceEvent(listener: DeviceEventListener): () => void {
    this.deviceEventListeners.push(listener);
    return () => {
      this.deviceEventListeners = this.deviceEventListeners.filter((l) => l !== listener);
    };
  }

  private emitDeviceEvent(event: ButtplugEvent): void {
    for (const listener of this.deviceEventListeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }

  private nextId(): number {
    return ++this.msgId;
  }

  /**
   * Connect to Intiface and perform the Buttplug v3 handshake.
   * Throws on failure.
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      let handshakeDone = false;

      ws.onopen = () => {
        this.handshakeResolve = resolve;
        this.handshakeReject = reject;
        ws.send(buildRequestServerInfo(this.nextId()));
      };

      ws.onmessage = (event) => {
        const text = typeof event.data === 'string' ? event.data : '';
        if (!handshakeDone) {
          // First message: handshake response
          const events = parseButtplugMessages(text);
          for (const e of events) {
            if (e.type === 'ServerInfo') {
              handshakeDone = true;
              this._isConnected = true;
              this.startHealthPing();
              resolve();
              return;
            } else if (e.type === 'Error') {
              reject(new Error(`Buttplug handshake error: ${e.message}`));
              ws.close();
              return;
            }
          }
        } else {
          this.handleMessages(parseButtplugMessages(text));
        }
      };

      ws.onerror = (error) => {
        this._isConnected = false;
        if (!handshakeDone) {
          reject(new Error(`WebSocket error: ${String(error)}`));
        }
      };

      ws.onclose = () => {
        this._isConnected = false;
        this.clearHealthPing();
        if (!handshakeDone) {
          reject(new Error('WebSocket closed before handshake'));
        }
      };
    });
  }

  private handleMessages(events: ButtplugEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'DeviceAdded':
          this._devices.set(event.device.deviceIndex, event.device);
          this.emitDeviceEvent(event);
          break;
        case 'DeviceRemoved':
          this._devices.delete(event.deviceIndex);
          this.emitDeviceEvent(event);
          break;
        case 'DeviceList':
          for (const dev of event.devices) {
            this._devices.set(dev.deviceIndex, dev);
          }
          this.emitDeviceEvent(event);
          break;
        case 'Error':
          // Log only — don't throw; engine will detect disconnect via WS close
          console.warn('[IntifaceConnection] Buttplug error:', event.message);
          break;
        case 'ScanningFinished':
          this.emitDeviceEvent(event);
          break;
        default:
          break;
      }
    }
  }

  /**
   * Start health ping — sends RequestDeviceList every 15s.
   */
  private startHealthPing(): void {
    this.clearHealthPing();
    this.healthPingTimer = setInterval(() => {
      this.send(buildRequestDeviceList(this.nextId())).catch(() => {
        this.clearHealthPing();
      });
    }, 15_000);
  }

  private clearHealthPing(): void {
    if (this.healthPingTimer !== null) {
      clearInterval(this.healthPingTimer);
      this.healthPingTimer = null;
    }
  }

  /**
   * Scan for devices. StartScanning → wait → RequestDeviceList → wait 1s.
   */
  async scan(durationMs = 5000): Promise<void> {
    await this.send(buildStartScanning(this.nextId()));
    await delay(durationMs);
    await this.send(buildRequestDeviceList(this.nextId()));
    await delay(1000);
  }

  /**
   * Send ScalarCmd to a device.
   * Matches actuators by type + optional featureIndex, or falls back to index 0.
   */
  async scalarCmd(
    deviceIndex: number,
    intensity: number,
    actuatorType = 'Vibrate',
    featureIndex?: number,
  ): Promise<void> {
    const device = this._devices.get(deviceIndex);
    const scalars: ScalarEntry[] = [];

    if (device) {
      for (const actuator of device.scalarActuators) {
        if (actuator.actuatorType.toLowerCase() === actuatorType.toLowerCase()) {
          if (featureIndex !== undefined && actuator.index !== featureIndex) continue;
          scalars.push({
            index: actuator.index,
            scalar: Math.min(1, Math.max(0, intensity)),
            actuatorType: actuator.actuatorType,
          });
        }
      }
    }

    if (scalars.length === 0) {
      scalars.push({
        index: featureIndex ?? 0,
        scalar: Math.min(1, Math.max(0, intensity)),
        actuatorType,
      });
    }

    await this.send(buildScalarCmd(this.nextId(), deviceIndex, scalars));
  }

  async stopDevice(deviceIndex: number): Promise<void> {
    await this.send(buildStopDeviceCmd(this.nextId(), deviceIndex));
  }

  async stopAll(): Promise<void> {
    await this.send(buildStopAllDevices(this.nextId()));
  }

  async close(): Promise<void> {
    this.clearHealthPing();
    this._isConnected = false;
    this._devices.clear();
    try { this.ws?.close(1000, 'Disconnecting'); } catch { /* ignore */ }
    this.ws = null;
  }

  private send(message: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this._isConnected) {
        reject(new Error('Not connected'));
        return;
      }
      try {
        this.ws.send(message);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
