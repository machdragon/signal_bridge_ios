/**
 * PatternRunner — runs timed patterns (pulse, wave, escalate) on devices.
 */

import { IntifaceConnection } from './IntifaceConnection';
import { DeviceManager } from './DeviceManager';
import { DeviceInfo } from './ConnectionStateMachine';

export interface CommandAck {
  success: boolean;
  message: string;
  requestId: string;
  devicesAffected: string[];
}

export class PatternRunner {
  private intiface: IntifaceConnection;
  private devices: DeviceManager;
  private onDeviceStateChanged: ((devices: DeviceInfo[]) => void) | null;

  // shortName → active timer handle
  private activeTasks = new Map<string, ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>>();

  constructor(
    intiface: IntifaceConnection,
    devices: DeviceManager,
    onDeviceStateChanged?: (devices: DeviceInfo[]) => void,
  ) {
    this.intiface = intiface;
    this.devices = devices;
    this.onDeviceStateChanged = onDeviceStateChanged ?? null;
  }

  async runCommand(type: string, payload: Record<string, unknown>): Promise<CommandAck> {
    switch (type) {
      case 'command': return this.handleCommand(payload);
      case 'pattern': return this.handlePattern(payload);
      case 'stop': return this.handleStop(payload);
      case 'scan': return this.handleScan();
      case 'read_sensor':
        return { success: false, message: 'Sensors not supported in RN relay', requestId: '', devicesAffected: [] };
      default:
        return { success: false, message: `Unknown command type: ${type}`, requestId: '', devicesAffected: [] };
    }
  }

  async emergencyStopAll(): Promise<void> {
    for (const timer of this.activeTasks.values()) {
      clearInterval(timer as ReturnType<typeof setInterval>);
      clearTimeout(timer as ReturnType<typeof setTimeout>);
    }
    this.activeTasks.clear();
    this.devices.setAllStopped();
    this.notifyDeviceState();
    try { await this.intiface.stopAll(); } catch { /* ignore */ }
  }

  async destroy(): Promise<void> {
    for (const timer of this.activeTasks.values()) {
      clearInterval(timer as ReturnType<typeof setInterval>);
      clearTimeout(timer as ReturnType<typeof setTimeout>);
    }
    this.activeTasks.clear();
    try { await this.intiface.stopAll(); } catch { /* ignore */ }
  }

  private notifyDeviceState(): void {
    this.onDeviceStateChanged?.(this.devices.buildDeviceInfoList());
  }

  private cancelPatterns(device: string): void {
    if (device === 'all') {
      for (const timer of this.activeTasks.values()) {
        clearInterval(timer as ReturnType<typeof setInterval>);
        clearTimeout(timer as ReturnType<typeof setTimeout>);
      }
      this.activeTasks.clear();
    } else {
      const timer = this.activeTasks.get(device);
      if (timer !== undefined) {
        clearInterval(timer as ReturnType<typeof setInterval>);
        clearTimeout(timer as ReturnType<typeof setTimeout>);
        this.activeTasks.delete(device);
      }
    }
  }

  // ── Command handlers ────────────────────────────────────────────

  private async handleCommand(payload: Record<string, unknown>): Promise<CommandAck> {
    const device = (payload.device as string) ?? 'all';
    const intensity = Number(payload.intensity ?? 0.5);
    const outputType = (payload.action as string) ?? (payload.output_type as string) ?? 'vibrate';
    const duration = Number(payload.duration ?? 0);
    const featureIndex = payload.feature_index != null ? Number(payload.feature_index) : undefined;
    const requestId = (payload.request_id as string) ?? '';

    const targets = this.devices.resolveTargets(device);
    if (targets.length === 0) {
      return {
        success: false,
        message: `Device not found. Available: ${this.devices.availableDevices().join(', ')}`,
        requestId,
        devicesAffected: [],
      };
    }

    const names: string[] = [];
    for (const { shortName, index } of targets) {
      // Cancel any existing timer (previous auto-stop or pattern) for this device
      this.cancelPatterns(shortName);

      const adj = this.devices.applyFloor(intensity, shortName);
      await this.intiface.scalarCmd(index, adj, capitalize(outputType), featureIndex);
      this.devices.setDeviceActive(shortName, intensity);
      names.push(shortName);

      // Per-device auto-stop timer — stored in activeTasks so it can be cancelled
      if (duration > 0) {
        const timer = setTimeout(async () => {
          this.activeTasks.delete(shortName);
          try { await this.intiface.stopDevice(index); } catch { /* ignore */ }
          this.devices.setDeviceStopped(shortName);
          this.notifyDeviceState();
        }, duration * 1000);
        this.activeTasks.set(shortName, timer);
      }
    }
    this.notifyDeviceState();

    return { success: true, message: `Set ${outputType} ${intensity} on ${names.join(', ')}`, requestId, devicesAffected: names };
  }

  private async handlePattern(payload: Record<string, unknown>): Promise<CommandAck> {
    const pattern = (payload.pattern as string) ?? 'pulse';
    const device = (payload.device as string) ?? 'all';
    const intensity = Number(payload.intensity ?? 0.6);
    const duration = Number(payload.duration ?? 10);
    const outputType = (payload.action as string) ?? (payload.output_type as string) ?? 'vibrate';
    const hold = Number(payload.hold_seconds ?? 0);
    const featureIndex = payload.feature_index != null ? Number(payload.feature_index) : undefined;
    const requestId = (payload.request_id as string) ?? '';

    const targets = this.devices.resolveTargets(device);
    if (targets.length === 0) {
      return { success: false, message: 'Device not found', requestId, devicesAffected: [] };
    }
    if (!['pulse', 'wave', 'escalate'].includes(pattern)) {
      return { success: false, message: `Unknown pattern: ${pattern}`, requestId, devicesAffected: [] };
    }

    for (const { shortName, index } of targets) {
      this.cancelPatterns(shortName);
      const floor = this.devices.getIntensityFloor(shortName);
      this.devices.setDeviceActive(shortName, intensity);

      switch (pattern) {
        case 'pulse':
          this.runPulse(shortName, index, outputType, intensity, duration, floor, featureIndex);
          break;
        case 'wave':
          this.runWave(shortName, index, outputType, intensity, duration, floor, featureIndex);
          break;
        case 'escalate':
          this.runEscalate(shortName, index, outputType, intensity, duration, hold, floor, featureIndex);
          break;
        default:
          return { success: false, message: `Unknown pattern: ${pattern}`, requestId, devicesAffected: [] };
      }
    }
    this.notifyDeviceState();

    const names = targets.map((t) => t.shortName);
    return { success: true, message: `Pattern ${pattern} started on ${names.join(', ')}`, requestId, devicesAffected: names };
  }

  private async handleStop(payload: Record<string, unknown>): Promise<CommandAck> {
    const device = (payload.device as string) ?? 'all';
    const requestId = (payload.request_id as string) ?? '';

    let targets = this.devices.resolveTargets(device);
    let fallback = false;
    if (device !== 'all' && targets.length === 0) {
      fallback = true;
      targets = this.devices.resolveTargets('all');
    }

    for (const { shortName, index } of targets) {
      this.cancelPatterns(shortName);
      try { await this.intiface.stopDevice(index); } catch { /* ignore */ }
      this.devices.setDeviceStopped(shortName);
    }
    if (device === 'all') {
      this.cancelPatterns('all');
      try { await this.intiface.stopAll(); } catch { /* ignore */ }
      this.devices.setAllStopped();
    }
    this.notifyDeviceState();

    const names = targets.map((t) => t.shortName);
    if (fallback) {
      return {
        success: true,
        message: `Unknown device — stopped ALL as safety fallback. Available: ${this.devices.availableDevices().join(', ')}`,
        requestId,
        devicesAffected: names,
      };
    }
    return { success: true, message: `Stopped ${names.join(', ') || 'all'}`, requestId, devicesAffected: names };
  }

  private async handleScan(): Promise<CommandAck> {
    await this.intiface.scan(5000);
    return { success: true, message: `Scan complete — ${this.devices.deviceCount} device(s)`, requestId: '', devicesAffected: [] };
  }

  // ── Pattern implementations ─────────────────────────────────────

  private runPulse(
    shortName: string, index: number, outputType: string,
    intensity: number, duration: number, floor: number, featureIndex?: number,
  ): void {
    const endTime = Date.now() + duration * 1000;
    let on = true;
    const timer = setInterval(async () => {
      if (Date.now() >= endTime) {
        clearInterval(timer);
        this.activeTasks.delete(shortName);
        try { await this.intiface.stopDevice(index); } catch { /* ignore */ }
        this.devices.setDeviceStopped(shortName);
        this.notifyDeviceState();
        return;
      }
      if (on) {
        const adj = applyFloor(intensity, floor);
        try { await this.intiface.scalarCmd(index, adj, capitalize(outputType), featureIndex); } catch { /* ignore */ }
        this.devices.setDeviceActive(shortName, intensity);
      } else {
        try { await this.intiface.scalarCmd(index, 0, capitalize(outputType), featureIndex); } catch { /* ignore */ }
        this.devices.setDeviceActive(shortName, 0.01);
      }
      on = !on;
    }, 400);
    this.activeTasks.set(shortName, timer);
  }

  private runWave(
    shortName: string, index: number, outputType: string,
    intensity: number, duration: number, floor: number, featureIndex?: number,
  ): void {
    const startTime = Date.now();
    const endTime = startTime + duration * 1000;
    const timer = setInterval(async () => {
      if (Date.now() >= endTime) {
        clearInterval(timer);
        this.activeTasks.delete(shortName);
        try { await this.intiface.stopDevice(index); } catch { /* ignore */ }
        this.devices.setDeviceStopped(shortName);
        this.notifyDeviceState();
        return;
      }
      const elapsed = (Date.now() - startTime) / 1000;
      const raw = ((Math.sin(elapsed * 2) + 1) / 2) * intensity;
      const adj = applyFloor(raw, floor);
      try { await this.intiface.scalarCmd(index, adj, capitalize(outputType), featureIndex); } catch { /* ignore */ }
      this.devices.setDeviceActive(shortName, raw);
    }, 100);
    this.activeTasks.set(shortName, timer);
  }

  private runEscalate(
    shortName: string, index: number, outputType: string,
    peak: number, duration: number, hold: number, floor: number, featureIndex?: number,
  ): void {
    const steps = 20;
    const stepMs = (duration * 1000) / steps;
    let step = 0;
    const rampTimer = setInterval(async () => {
      if (step > steps) {
        clearInterval(rampTimer);
        this.devices.setDeviceActive(shortName, peak);
        this.notifyDeviceState();

        if (hold > 0) {
          const holdTimer = setTimeout(async () => {
            this.activeTasks.delete(shortName);
            try { await this.intiface.stopDevice(index); } catch { /* ignore */ }
            this.devices.setDeviceStopped(shortName);
            this.notifyDeviceState();
          }, hold * 1000);
          this.activeTasks.set(shortName, holdTimer);
        } else {
          // hold == 0: stop device immediately after ramp
          this.activeTasks.delete(shortName);
          try { await this.intiface.stopDevice(index); } catch { /* ignore */ }
          this.devices.setDeviceStopped(shortName);
          this.notifyDeviceState();
        }
        return;
      }
      const raw = (step / steps) * peak;
    const adj = applyFloor(raw, floor);
    try { await this.intiface.scalarCmd(index, adj, capitalize(outputType), featureIndex); } catch { /* ignore */ }
    this.devices.setDeviceActive(shortName, raw);
    step++;
    }, stepMs);
    this.activeTasks.set(shortName, rampTimer);
  }
}

function applyFloor(raw: number, floor: number): number {
  if (raw <= 0.01) return 0;
  if (floor > 0) return Math.min(1, Math.max(0, floor + raw * (1 - floor)));
  return Math.min(1, Math.max(0, raw));
}

/** Capitalize the first letter of an actuator type for Buttplug (e.g. 'vibrate' → 'Vibrate'). */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
