/**
 * Relay state store backed by Zustand.
 *
 * Single source of truth for all relay state: connection status, devices, governor, health, errors.
 */

import { create } from 'zustand';
import {
  RelayState,
  DeviceInfo,
  GovernorState,
  ConnectionHealth,
  defaultGovernorState,
  defaultConnectionHealth,
} from '../relay/ConnectionStateMachine';

interface RelayStore {
  state: RelayState;
  devices: DeviceInfo[];
  governor: GovernorState;
  health: ConnectionHealth;
  error: string | null;

  setState: (s: RelayState) => void;
  updateDevices: (devices: DeviceInfo[]) => void;
  updateGovernor: (governor: GovernorState) => void;
  updateHealth: (health: ConnectionHealth) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useRelayStore = create<RelayStore>((set) => ({
  state: 'DISCONNECTED',
  devices: [],
  governor: defaultGovernorState,
  health: defaultConnectionHealth,
  error: null,

  setState: (s) => set({ state: s }),
  updateDevices: (devices) => set({ devices }),
  updateGovernor: (governor) => set({ governor }),
  updateHealth: (health) => set({ health }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      state: 'DISCONNECTED',
      devices: [],
      governor: defaultGovernorState,
      health: defaultConnectionHealth,
      error: null,
    }),
}));
