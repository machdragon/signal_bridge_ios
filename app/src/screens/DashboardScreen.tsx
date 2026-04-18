import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRelayStore } from '../store/relayStore';
import { RelayEngine } from '../relay/RelayEngine';
import { DeviceInfo, RelayState } from '../relay/ConnectionStateMachine';
import { tokenManager } from '../auth/TokenManager';
import {
  initEmergencyStop,
  destroyEmergencyStop,
  scheduleRelayNotification,
  dismissRelayNotification,
} from '../services/emergencyStop';
import { initVolumeKeyStop, destroyVolumeKeyStop } from '../services/volumeKeyStop';
import { registerBackgroundTask, unregisterBackgroundTask, setKeepaliveCallback } from '../services/backgroundTask';
import { initVoIPKeepAlive, destroyVoIPKeepAlive } from '../services/voipKeepAlive';
import * as Notifications from 'expo-notifications';
import { T } from '../theme';

function stateColor(state: RelayState): string {
  switch (state) {
    case 'IDLE':
    case 'ACTIVE': return T.green;
    case 'CONNECTING': return T.amber;
    case 'COOLDOWN': return T.amber;
    case 'ERROR': return T.red;
    default: return T.textMuted;
  }
}

function stateLabel(state: RelayState): string {
  switch (state) {
    case 'DISCONNECTED': return 'Disconnected';
    case 'CONNECTING': return 'Connecting…';
    case 'IDLE': return 'Connected — Idle';
    case 'ACTIVE': return 'Active';
    case 'COOLDOWN': return 'Cooldown';
    case 'ERROR': return 'Error';
  }
}

export function DashboardScreen() {
  const navigation = useNavigation();
  const { state, devices, governor, health, error } = useRelayStore();
  const engineRef = useRef<RelayEngine | null>(null);
  const [pendingToggle, setPendingToggle] = useState(false);

  const insets = useSafeAreaInsets();
  const isConnected = state !== 'DISCONNECTED' && state !== 'ERROR';
  const isConnecting = state === 'CONNECTING';

  async function startRelay() {
    if (engineRef.current != null) return;

    const { status: notifPermStatus } = await Notifications.requestPermissionsAsync();
    if (notifPermStatus !== 'granted') {
      console.warn('[DashboardScreen] Notification permission denied — STOP ALL unavailable');
    }

    if (Platform.OS === 'android') {
      await IntentLauncher.startActivityAsync(
        'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
        { data: 'package:com.aletheiaVox.signalbridge' },
      ).catch(() => {});
    }

    const token = await tokenManager.getToken();
    if (!token) {
      useRelayStore.getState().setError('Session expired. Please sign out and sign back in.');
      return;
    }
    const serverUrl = await tokenManager.getServerUrl();
    const intifaceUrl = await tokenManager.getIntifaceUrl();

    const engine = new RelayEngine({
      serverUrl,
      token,
      intifaceUrl,
      onNotificationUpdate: (status) => {
        scheduleRelayNotification(status).catch(() => {});
      },
      onStopped: () => {
        if (engineRef.current !== engine) return;
        engineRef.current = null;
        destroyEmergencyStop();
        destroyVolumeKeyStop();
        destroyVoIPKeepAlive();
        setKeepaliveCallback(() => {});
        dismissRelayNotification().catch(() => {});
      },
    });
    engineRef.current = engine;

    try {
      await initEmergencyStop(() => engine.emergencyStop());
      await scheduleRelayNotification('Connecting…').catch(() => {});
      const volumeKeyEnabled = await tokenManager.getVolumeKeyEnabled();
      if (volumeKeyEnabled) initVolumeKeyStop(() => engine.emergencyStop());
      initVoIPKeepAlive(() => {
        // iOS fires this every 600s while backgrounded — ping relay to keep socket alive
        engine.ping().catch(() => {});
      });
      setKeepaliveCallback(() => {
        if (engineRef.current !== engine) return;
        const relayState = useRelayStore.getState().state;
        if (relayState === 'DISCONNECTED' || relayState === 'ERROR') {
          engine.start();
        }
      });
      await registerBackgroundTask();
    } catch (err) {
      engineRef.current = null;
      destroyEmergencyStop();
      destroyVolumeKeyStop();
      destroyVoIPKeepAlive();
      setKeepaliveCallback(() => {});
      useRelayStore.getState().setError('Failed to initialize relay services.');
      return;
    }

    engine.start();
  }

  async function stopRelay() {
    await dismissRelayNotification().catch(() => {});
    destroyEmergencyStop();
    destroyVolumeKeyStop();
    destroyVoIPKeepAlive();
    setKeepaliveCallback(() => {});
    await unregisterBackgroundTask().catch(() => {});
    await engineRef.current?.stop();
    engineRef.current = null;
  }

  async function handleConnectToggle() {
    if (pendingToggle) return;
    setPendingToggle(true);
    try {
      if (isConnected || isConnecting) {
        await stopRelay();
      } else {
        await startRelay();
      }
    } finally {
      setPendingToggle(false);
    }
  }

  function handleEmergencyStop() {
    engineRef.current?.emergencyStop();
  }

  useEffect(() => {
    return () => {
      engineRef.current?.stop().catch(() => {});
      dismissRelayNotification().catch(() => {});
      destroyEmergencyStop();
      destroyVolumeKeyStop();
      destroyVoIPKeepAlive();
      setKeepaliveCallback(() => {});
      unregisterBackgroundTask().catch(() => {});
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Signal Bridge</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Settings' as never)}>
          <Ionicons name="settings-outline" size={24} color={T.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {Platform.OS === 'ios' && isConnected && (
          <View style={styles.iosBanner}>
            <Text style={styles.iosBannerText}>
              Keep app in foreground — relay stops if backgrounded
            </Text>
          </View>
        )}

        <View style={styles.statusRow}>
          <StatusCard
            label="Server"
            icon="cloud-outline"
            connected={health.serverConnected}
            detail={
              health.serverConnected && health.lastHeartbeatAgo > 0
                ? `${Math.floor(health.lastHeartbeatAgo / 1000)}s ago`
                : undefined
            }
          />
          <StatusCard
            label="Intiface"
            icon="bluetooth"
            connected={health.intifaceConnected && health.intifaceHealthy}
          />
        </View>

        <Text style={[styles.stateText, { color: stateColor(state) }]}>{stateLabel(state)}</Text>

        {error != null && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {isConnected && governor.heatPct > 0 && (
          <View style={styles.governorContainer}>
            <View style={styles.governorHeader}>
              <Text style={styles.governorLabel}>Session intensity</Text>
              <Text
                style={[
                  styles.governorValue,
                  governor.inCooldown
                    ? { color: T.amber }
                    : governor.heatPct > 80
                    ? { color: T.red }
                    : governor.heatPct > 50
                    ? { color: T.amber }
                    : { color: T.text },
                ]}
              >
                {governor.inCooldown
                  ? `COOLDOWN ${governor.cooldownRemaining}s`
                  : governor.predictedSeconds != null && governor.heatPct > 50
                  ? `~${governor.predictedSeconds}s`
                  : `${Math.round(governor.heatPct)}%`}
              </Text>
            </View>
            <View style={styles.heatBarTrack}>
              <View
                style={[
                  styles.heatBarFill,
                  {
                    width: `${Math.min(100, governor.heatPct)}%`,
                    backgroundColor: governor.inCooldown
                      ? T.amber
                      : governor.heatPct > 80
                      ? T.red
                      : governor.heatPct > 50
                      ? T.amber
                      : T.green,
                  },
                ]}
              />
            </View>
          </View>
        )}

        {devices.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Devices ({devices.length})</Text>
            {devices.map((device) => (
              <DeviceCard key={device.shortName} device={device} />
            ))}
          </>
        )}
        {devices.length === 0 && isConnected && (
          <Text style={styles.noDevicesText}>
            No devices found. Make sure Intiface Central is running.
          </Text>
        )}

      </ScrollView>

      <View style={styles.bottomControls}>
        {isConnected && (
          <TouchableOpacity style={styles.stopAllButton} onPress={handleEmergencyStop}>
            <Text style={styles.stopAllText}>⏹ STOP ALL</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[
            styles.connectButton,
            (isConnected || isConnecting) && styles.connectButtonActive,
            pendingToggle && styles.connectButtonDisabled,
          ]}
          onPress={() => { handleConnectToggle().catch(() => {}); }}
          disabled={pendingToggle}
        >
          {isConnecting || pendingToggle ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.connectButtonText}>
              {isConnected || isConnecting ? 'Disconnect' : 'Connect'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StatusCard({
  label,
  icon,
  connected,
  detail,
}: {
  label: string;
  icon: string;
  connected: boolean;
  detail?: string;
}) {
  return (
    <View style={statusStyles.card}>
      <Ionicons
        name={icon as never}
        size={20}
        color={connected ? T.green : T.textMuted}
        style={statusStyles.icon}
      />
      <View>
        <Text style={statusStyles.label}>{label}</Text>
        <Text style={[statusStyles.status, { color: connected ? T.green : T.textMuted }]}>
          {connected ? 'Connected' : 'Disconnected'}
          {detail ? ` · ${detail}` : ''}
        </Text>
      </View>
    </View>
  );
}

function DeviceCard({ device }: { device: DeviceInfo }) {
  return (
    <View style={[deviceStyles.card, device.isActive && deviceStyles.cardActive]}>
      <View style={deviceStyles.info}>
        <Text style={deviceStyles.name}>{device.displayName}</Text>
        <Text style={deviceStyles.caps}>
          {Object.keys(device.capabilities).join(', ')}
        </Text>
      </View>
      {device.isActive && (
        <Text style={deviceStyles.intensity}>
          {Math.round(device.currentIntensity * 100)}%
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: T.surface,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: T.text },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 8 },
  iosBanner: {
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.amber,
  },
  iosBannerText: { color: T.amber, fontSize: 13 },
  statusRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  stateText: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  errorCard: {
    backgroundColor: '#FFEBEE',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  errorText: { color: T.primary, fontSize: 14 },
  governorContainer: { marginVertical: 8 },
  governorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  governorLabel: { color: T.textMuted, fontSize: 13 },
  governorValue: { fontSize: 13, fontWeight: '600' },
  heatBarTrack: {
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    overflow: 'hidden',
  },
  heatBarFill: { height: 4, borderRadius: 2 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: T.text,
    marginTop: 12,
    marginBottom: 8,
  },
  noDevicesText: { color: T.textMuted, textAlign: 'center', marginTop: 24 },
  bottomControls: {
    padding: 16,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: T.border,
    backgroundColor: T.surface,
  },
  stopAllButton: {
    backgroundColor: T.red,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
  },
  stopAllText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  connectButton: {
    backgroundColor: T.primary,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  connectButtonActive: { backgroundColor: '#757575' },
  connectButtonDisabled: { opacity: 0.6 },
  connectButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

const statusStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: T.surface,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: T.border,
  },
  icon: { marginRight: 2 },
  label: { color: T.textMuted, fontSize: 12 },
  status: { fontSize: 13, fontWeight: '600' },
});

const deviceStyles = StyleSheet.create({
  card: {
    backgroundColor: T.surface,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: T.border,
  },
  cardActive: { borderColor: T.green },
  info: { flex: 1 },
  name: { color: T.text, fontSize: 15, fontWeight: '600' },
  caps: { color: T.textMuted, fontSize: 13, marginTop: 2 },
  intensity: { color: T.green, fontSize: 18, fontWeight: 'bold' },
});
