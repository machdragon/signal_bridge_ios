/**
 * DeviceManager — maps Buttplug device indices to short names and profiles.
 */

import { ButtplugDevice } from './ButtplugMessages';
import { DeviceInfo } from './ConnectionStateMachine';

// ── Device profiles ────────────────────────────────────────────────

interface DeviceProfile {
  shortName: string;
  matchStrings: string[];
  capabilities: Record<string, string>;
  intensityFloor: number;
  notes: string;
}

const BUILT_IN_PROFILES: DeviceProfile[] = [
  {
    shortName: 'ferri',
    matchStrings: ['Ferri'],
    capabilities: { vibrate: 'external clitoral vibration' },
    intensityFloor: 0.0,
    notes: 'Small wearable. Intense even at low settings.',
  },
  {
    shortName: 'lush',
    matchStrings: ['Lush'],
    capabilities: { vibrate: 'internal egg vibration' },
    intensityFloor: 0.0,
    notes: 'Insertable egg. Strong deep vibration.',
  },
  {
    shortName: 'gravity',
    matchStrings: ['Gravity'],
    capabilities: { vibrate: 'shaft vibration', oscillate: 'thrusting motion' },
    intensityFloor: 0.0,
    notes: 'Vibration + thrusting. Use 0.05+ intensity for slow strokes.',
  },
  {
    shortName: 'enigma',
    matchStrings: ['Enigma'],
    capabilities: { vibrate: 'G-spot thumping stimulation', rotate: 'clitoral sonic pulse' },
    intensityFloor: 0.4,
    notes: "Dual stimulation. 'rotate' = sonic pulse. Needs 40%+ to feel.",
  },
  {
    shortName: 'max',
    matchStrings: ['Max'],
    capabilities: { vibrate: 'internal vibration', constrict: 'air pump compression' },
    intensityFloor: 0.0,
    notes: 'Vibration + air pump constriction.',
  },
  {
    shortName: 'nora',
    matchStrings: ['Nora'],
    capabilities: { vibrate: 'internal vibration', rotate: 'internal rotation' },
    intensityFloor: 0.0,
    notes: 'Vibration + actual physical rotation.',
  },
  {
    shortName: 'edge',
    matchStrings: ['Edge'],
    capabilities: {
      vibrate:
        'dual motor vibration (feature_index 0 = base, 1 = tip)',
    },
    intensityFloor: 0.0,
    notes:
      'Prostate massager. Two vibration motors addressable via feature_index: 0 = base motor, 1 = tip motor. Omit feature_index to drive both together.',
  },
  {
    shortName: 'hush',
    matchStrings: ['Hush'],
    capabilities: { vibrate: 'vibration' },
    intensityFloor: 0.0,
    notes: 'Vibrating plug. Simple single-motor.',
  },
  {
    shortName: 'domi',
    matchStrings: ['Domi'],
    capabilities: { vibrate: 'powerful wand vibration' },
    intensityFloor: 0.0,
    notes: 'Mini wand. Very powerful. Start low.',
  },
  {
    shortName: 'osci',
    matchStrings: ['Osci'],
    capabilities: { oscillate: 'oscillating stimulation' },
    intensityFloor: 0.0,
    notes: 'Oscillating G-spot stimulator. Uses oscillate, not vibrate.',
  },
  {
    shortName: 'dolce',
    matchStrings: ['Dolce'],
    capabilities: {
      vibrate:
        'dual vibration (feature_index 0 = internal, 1 = external)',
    },
    intensityFloor: 0.0,
    notes:
      "Couples' vibrator. Two vibration motors addressable via feature_index: 0 = internal motor, 1 = external clitoral motor. Omit feature_index to drive both together.",
  },
  {
    shortName: 'flexer',
    matchStrings: ['Flexer'],
    capabilities: { vibrate: 'vibration', oscillate: 'come-hither motion' },
    intensityFloor: 0.0,
    notes: 'Vibration + finger-like come-hither oscillation.',
  },
];

function matchDeviceProfile(buttplugName: string): DeviceProfile | null {
  const lower = buttplugName.toLowerCase();
  return (
    BUILT_IN_PROFILES.find((p) =>
      p.matchStrings.some((m) => lower.includes(m.toLowerCase())),
    ) ?? null
  );
}

// ── DeviceManager ──────────────────────────────────────────────────

export class DeviceManager {
  // shortName → buttplug device index
  private nameMap = new Map<string, number>();
  // buttplug index → ButtplugDevice
  private bpDevices = new Map<number, ButtplugDevice>();
  // shortName → matched profile
  private matchedProfiles = new Map<string, DeviceProfile>();
  // shortName → current intensity (0 = idle)
  private activeIntensity = new Map<string, number>();

  addDevice(device: ButtplugDevice): void {
    this.bpDevices.set(device.deviceIndex, device);
    const profile = matchDeviceProfile(device.deviceName);
    const shortName =
      profile?.shortName ?? device.deviceName.toLowerCase().replace(/\s+/g, '_');
    this.nameMap.set(shortName, device.deviceIndex);
    if (profile) this.matchedProfiles.set(shortName, profile);
  }

  removeDevice(deviceIndex: number): void {
    let removedName: string | null = null;
    for (const [name, idx] of this.nameMap.entries()) {
      if (idx === deviceIndex) {
        removedName = name;
        break;
      }
    }
    if (removedName) {
      this.nameMap.delete(removedName);
      this.matchedProfiles.delete(removedName);
      this.activeIntensity.delete(removedName);
    }
    this.bpDevices.delete(deviceIndex);
  }

  clear(): void {
    this.nameMap.clear();
    this.bpDevices.clear();
    this.matchedProfiles.clear();
    this.activeIntensity.clear();
  }

  /** Resolve "all" or a short name to [{shortName, index}] pairs. */
  resolveTargets(device: string): Array<{ shortName: string; index: number }> {
    if (device === 'all') {
      return Array.from(this.nameMap.entries()).map(([shortName, index]) => ({
        shortName,
        index,
      }));
    }
    const index = this.nameMap.get(device);
    if (index === undefined) return [];
    return [{ shortName: device, index }];
  }

  getIntensityFloor(shortName: string): number {
    return this.matchedProfiles.get(shortName)?.intensityFloor ?? 0;
  }

  /**
   * Apply intensity floor: 0 stays 0; otherwise floor + raw*(1-floor), clamped 0–1.
   */
  applyFloor(raw: number, shortName: string): number {
    if (raw <= 0.01) return 0;
    const floor = this.getIntensityFloor(shortName);
    if (floor > 0) {
      return Math.min(1, Math.max(0, floor + raw * (1 - floor)));
    }
    return Math.min(1, Math.max(0, raw));
  }

  availableDevices(): string[] {
    return Array.from(this.nameMap.keys());
  }

  getIndex(shortName: string): number | undefined {
    return this.nameMap.get(shortName);
  }

  /** Build the device_list report sent to the VPS server. */
  buildDeviceListReport(): Array<Record<string, unknown>> {
    return Array.from(this.nameMap.entries()).map(([shortName, idx]) => {
      const bpDev = this.bpDevices.get(idx);
      const profile = this.matchedProfiles.get(shortName);
      const capabilities: Record<string, Record<string, string>> = {};

      if (bpDev) {
        for (const actuator of bpDev.scalarActuators) {
          const type = actuator.actuatorType.toLowerCase();
          if (['vibrate', 'rotate', 'oscillate', 'constrict'].includes(type)) {
            capabilities[type] = {};
          }
        }
      }
      if (Object.keys(capabilities).length === 0 && profile) {
        for (const cap of Object.keys(profile.capabilities)) {
          capabilities[cap] = {};
        }
      }

      return {
        short_name: shortName,
        name: bpDev?.deviceName ?? shortName,
        intensity_floor: profile?.intensityFloor ?? 0,
        capabilities,
        notes: profile?.notes ?? bpDev?.deviceName ?? shortName,
      };
    });
  }

  /** Build DeviceInfo list for the UI store. */
  buildDeviceInfoList(): DeviceInfo[] {
    return Array.from(this.nameMap.entries()).map(([shortName, idx]) => {
      const bpDev = this.bpDevices.get(idx);
      const profile = this.matchedProfiles.get(shortName);
      const intensity = this.activeIntensity.get(shortName) ?? 0;
      return {
        shortName,
        displayName: bpDev?.deviceName ?? shortName,
        capabilities: profile?.capabilities ?? {},
        intensityFloor: profile?.intensityFloor ?? 0,
        isActive: intensity > 0,
        currentIntensity: intensity,
      };
    });
  }

  setDeviceActive(shortName: string, intensity: number): void {
    this.activeIntensity.set(shortName, Math.min(1, Math.max(0, intensity)));
  }

  setDeviceStopped(shortName: string): void {
    this.activeIntensity.delete(shortName);
  }

  setAllStopped(): void {
    this.activeIntensity.clear();
  }

  get hasActiveDevices(): boolean {
    return this.activeIntensity.size > 0;
  }

  get deviceCount(): number {
    return this.nameMap.size;
  }
}
