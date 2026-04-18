/**
 * Connection state machine types.
 *
 * State diagram:
 *   DISCONNECTED → CONNECTING → IDLE → ACTIVE → COOLDOWN
 *        ↑              ↓        ↓       ↓         ↓
 *        └──────── ERROR ←───────┴───────┴─────────┘
 *
 * Key invariant: reconnect always lands in IDLE, never auto-resumes ACTIVE.
 */

export type RelayState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'IDLE'
  | 'ACTIVE'
  | 'COOLDOWN'
  | 'ERROR';

export interface DeviceInfo {
  shortName: string;
  displayName: string;
  capabilities: Record<string, string>;
  intensityFloor: number;
  isActive: boolean;
  currentIntensity: number;
}

export interface GovernorState {
  heatPct: number;
  inCooldown: boolean;
  cooldownRemaining: number;
  cooldownCount: number;
  predictedSeconds: number | null;
}

export interface ConnectionHealth {
  serverConnected: boolean;
  intifaceConnected: boolean;
  intifaceHealthy: boolean;
  lastHeartbeatAgo: number; // ms
}

export const defaultGovernorState: GovernorState = {
  heatPct: 0,
  inCooldown: false,
  cooldownRemaining: 0,
  cooldownCount: 0,
  predictedSeconds: null,
};

export const defaultConnectionHealth: ConnectionHealth = {
  serverConnected: false,
  intifaceConnected: false,
  intifaceHealthy: false,
  lastHeartbeatAgo: 0,
};
