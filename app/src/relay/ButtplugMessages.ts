/**
 * Raw Buttplug v3 protocol messages.
 *
 * Buttplug uses a JSON array of single-key objects:
 *   [{"RequestServerInfo": {"Id": 1, "ClientName": "...", "MessageVersion": 3}}]
 *
 * No library dependency, raw JSON only.
 */

// ── Outgoing (to Intiface) ─────────────────────────────────────────

export function buildRequestServerInfo(id: number): string {
  return JSON.stringify([
    { RequestServerInfo: { Id: id, ClientName: 'Signal Bridge', MessageVersion: 3 } },
  ]);
}

export function buildStartScanning(id: number): string {
  return JSON.stringify([{ StartScanning: { Id: id } }]);
}

export function buildRequestDeviceList(id: number): string {
  return JSON.stringify([{ RequestDeviceList: { Id: id } }]);
}

export function buildScalarCmd(
  id: number,
  deviceIndex: number,
  scalars: ScalarEntry[],
): string {
  return JSON.stringify([
    {
      ScalarCmd: {
        Id: id,
        DeviceIndex: deviceIndex,
        Scalars: scalars.map((s) => ({
          Index: s.index,
          Scalar: s.scalar,
          ActuatorType: s.actuatorType,
        })),
      },
    },
  ]);
}

export function buildStopDeviceCmd(id: number, deviceIndex: number): string {
  return JSON.stringify([{ StopDeviceCmd: { Id: id, DeviceIndex: deviceIndex } }]);
}

export function buildStopAllDevices(id: number): string {
  return JSON.stringify([{ StopAllDevices: { Id: id } }]);
}

// ── Data types ─────────────────────────────────────────────────────

export interface ScalarEntry {
  index: number;
  scalar: number;
  actuatorType: string;
}

export interface ActuatorInfo {
  index: number;
  actuatorType: string;
  stepCount: number;
}

export interface ButtplugDevice {
  deviceIndex: number;
  deviceName: string;
  scalarActuators: ActuatorInfo[];
}

// ── Incoming events ────────────────────────────────────────────────

export type ButtplugEvent =
  | { type: 'ServerInfo'; serverName: string; messageVersion: number }
  | { type: 'DeviceAdded'; device: ButtplugDevice }
  | { type: 'DeviceRemoved'; deviceIndex: number }
  | { type: 'DeviceList'; devices: ButtplugDevice[] }
  | { type: 'Ok' }
  | { type: 'Error'; message: string; errorCode: number }
  | { type: 'ScanningFinished' };

/**
 * Parse a Buttplug JSON array into typed events.
 * Returns empty array on parse failure — never throws.
 */
export function parseButtplugMessages(raw: string): ButtplugEvent[] {
  try {
    const array = JSON.parse(raw);
    if (!Array.isArray(array)) return [];
    const events: ButtplugEvent[] = [];
    for (const element of array) {
      if ('ServerInfo' in element) {
        const info = element.ServerInfo;
        events.push({
          type: 'ServerInfo',
          serverName: info.ServerName ?? 'Intiface',
          messageVersion: info.MessageVersion ?? 0,
        });
      } else if ('DeviceAdded' in element) {
        events.push({ type: 'DeviceAdded', device: parseDevice(element.DeviceAdded) });
      } else if ('DeviceRemoved' in element) {
        events.push({ type: 'DeviceRemoved', deviceIndex: element.DeviceRemoved.DeviceIndex ?? -1 });
      } else if ('DeviceList' in element) {
        const devices = (element.DeviceList.Devices ?? []).map(parseDevice);
        events.push({ type: 'DeviceList', devices });
      } else if ('Ok' in element) {
        events.push({ type: 'Ok' });
      } else if ('Error' in element) {
        const err = element.Error;
        events.push({
          type: 'Error',
          message: err.ErrorMessage ?? 'Unknown error',
          errorCode: err.ErrorCode ?? 0,
        });
      } else if ('ScanningFinished' in element) {
        events.push({ type: 'ScanningFinished' });
      }
    }
    return events;
  } catch {
    return [];
  }
}

function parseDevice(obj: Record<string, unknown>): ButtplugDevice {
  const index = (obj.DeviceIndex as number) ?? -1;
  const name = (obj.DeviceName as string) ?? 'Unknown';
  const actuators: ActuatorInfo[] = [];
  const scalarCmds = (obj.DeviceMessages as Record<string, unknown>)?.ScalarCmd as unknown[];
  if (Array.isArray(scalarCmds)) {
    scalarCmds.forEach((feature: unknown, i: number) => {
      const f = feature as Record<string, unknown>;
      actuators.push({
        index: (f.Index as number) ?? i,
        actuatorType: (f.ActuatorType as string) ?? 'Vibrate',
        stepCount: (f.StepCount as number) ?? 20,
      });
    });
  }
  return { deviceIndex: index, deviceName: name, scalarActuators: actuators };
}
