import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
  Linking,
} from 'react-native';
import { TextInput as PaperInput } from 'react-native-paper';
import Slider from '@react-native-community/slider';
import Constants from 'expo-constants';
import { tokenManager } from '../auth/TokenManager';
import { T } from '../theme';

interface SafetyConfig {
  governor_enabled: boolean;
  heat_rate: number;
  cool_rate: number;
  cooldown_threshold: number;
  cooldown_duration: number;
}

const DEFAULTS: SafetyConfig = {
  governor_enabled: true,
  heat_rate: 3.0,
  cool_rate: 2.0,
  cooldown_threshold: 90,
  cooldown_duration: 30,
};

interface Props {
  onSignOut: () => void;
}

export function SettingsScreen({ onSignOut }: Props) {
  const [serverUrl, setServerUrl] = useState('');
  const [intifaceUrl, setIntifaceUrl] = useState('');
  const [username, setUsername] = useState('');
  const [tokenExpiry, setTokenExpiry] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [safety, setSafety] = useState<SafetyConfig>(DEFAULTS);
  const [safetyLoaded, setSafetyLoaded] = useState(false);
  const [volumeKeyEnabled, setVolumeKeyEnabledState] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const url = await tokenManager.getServerUrl();
      setServerUrl(url);
      setIntifaceUrl(await tokenManager.getIntifaceUrl());
      setUsername((await tokenManager.getUsername()) ?? '');
      setTokenExpiry(await tokenManager.tokenExpiryDisplay());
      setVolumeKeyEnabledState(await tokenManager.getVolumeKeyEnabled());

      const token = await tokenManager.getToken();
      if (!token) return;
      try {
        const res = await fetch(`${url.replace(/\/$/, '')}/safety/config`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as SafetyConfig;
          setSafety({ ...DEFAULTS, ...data });
        }
      } catch {
        // server unreachable — show defaults
      } finally {
        setSafetyLoaded(true);
      }
    })().catch(() => {});
  }, []);

  async function saveSafetyConfig(config: SafetyConfig) {
    const url = (await tokenManager.getServerUrl()).replace(/\/$/, '');
    const token = await tokenManager.getToken();
    if (!token) return;
    await fetch(`${url}/safety/config`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  }

  function updateSafety(patch: Partial<SafetyConfig>) {
    const next = { ...safety, ...patch };
    setSafety(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveSafetyConfig(next).catch(() => {});
    }, 500);
  }

  async function handleSave() {
    const trimmedServer = serverUrl.trim().replace(/\/$/, '');
    const trimmedIntiface = intifaceUrl.trim().replace(/\/$/, '');
    if (!trimmedServer || !trimmedIntiface) {
      Alert.alert('Invalid URL', 'Server URL and Intiface URL cannot be empty.');
      return;
    }
    await tokenManager.setServerUrl(trimmedServer);
    await tokenManager.setIntifaceUrl(trimmedIntiface);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleSignOut() {
    Alert.alert('Sign out', 'This will disconnect the relay and clear your credentials.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await tokenManager.clearAuth();
          onSignOut();
        },
      },
    ]);
  }

  const inputTheme = { colors: { primary: T.primary } };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Account */}
      <Text style={styles.sectionTitle}>Account</Text>
      <View style={styles.card}>
        <View style={styles.infoRow}>
          <Text style={styles.label}>Username</Text>
          <Text style={styles.value}>{username || '—'}</Text>
        </View>
        <View style={[styles.infoRow, styles.infoRowLast]}>
          <Text style={styles.label}>Token</Text>
          <Text style={[styles.value, tokenExpiry === 'Expired' && styles.expired]}>
            {tokenExpiry ?? '—'}
          </Text>
        </View>
      </View>

      {/* Connection */}
      <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Connection</Text>
      <PaperInput
        mode="outlined"
        label="Server URL"
        value={serverUrl}
        onChangeText={setServerUrl}
        autoCapitalize="none"
        keyboardType="url"
        style={styles.input}
        theme={inputTheme}
        outlineColor={T.border}
        activeOutlineColor={T.primary}
      />
      <PaperInput
        mode="outlined"
        label="Intiface URL"
        value={intifaceUrl}
        onChangeText={setIntifaceUrl}
        autoCapitalize="none"
        keyboardType="url"
        style={styles.input}
        theme={inputTheme}
        outlineColor={T.border}
        activeOutlineColor={T.primary}
      />
      <TouchableOpacity style={styles.saveButton} onPress={() => { handleSave().catch(() => {}); }}>
        <Text style={styles.saveButtonText}>{saved ? 'Saved!' : 'Save'}</Text>
      </TouchableOpacity>

      {/* Safety */}
      <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Safety</Text>
      <View style={styles.card}>
        <View style={styles.governorRow}>
          <View style={styles.governorRowText}>
            <Text style={styles.governorTitle}>Safety Governor</Text>
            <Text style={styles.governorSubtitle}>
              Automatic cooldown when session intensity is sustained
            </Text>
          </View>
          <Switch
            value={safetyLoaded ? safety.governor_enabled : true}
            onValueChange={(v) => updateSafety({ governor_enabled: v })}
            trackColor={{ true: T.primary }}
            thumbColor={T.surface}
          />
        </View>

        <SliderRow
          label="Cooldown triggers at"
          value={safety.cooldown_threshold}
          unit="% heat"
          min={50}
          max={100}
          step={5}
          hint={`~${Math.round(safety.cooldown_threshold / safety.heat_rate)}s at full intensity to trigger`}
          onValueChange={(v) => updateSafety({ cooldown_threshold: v })}
        />

        <SliderRow
          label="Minimum cooldown"
          value={safety.cooldown_duration}
          unit="s"
          min={10}
          max={120}
          step={5}
          onValueChange={(v) => updateSafety({ cooldown_duration: v })}
        />

        <SliderRow
          label="Heat sensitivity"
          value={safety.heat_rate}
          unit=""
          min={1}
          max={10}
          step={0.5}
          hint="Higher = reaches cooldown faster"
          onValueChange={(v) => updateSafety({ heat_rate: v })}
        />

        <SliderRow
          label="Recovery speed"
          value={safety.cool_rate}
          unit=""
          min={0.5}
          max={5}
          step={0.5}
          hint="Higher = cools down faster when idle"
          onValueChange={(v) => updateSafety({ cool_rate: v })}
          last
        />
      </View>

      {/* Emergency Stop */}
      <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Emergency Stop</Text>
      <View style={styles.card}>
        <View style={styles.governorRow}>
          <View style={styles.governorRowText}>
            <Text style={styles.governorTitle}>Volume key emergency stop</Text>
            <Text style={styles.governorSubtitle}>
              Triple-press or hold volume-down to stop all devices
            </Text>
          </View>
          <Switch
            value={volumeKeyEnabled}
            onValueChange={(v) => {
              setVolumeKeyEnabledState(v);
              tokenManager.setVolumeKeyEnabled(v).catch(() => {});
            }}
            trackColor={{ true: T.primary }}
            thumbColor={T.surface}
          />
        </View>
        {volumeKeyEnabled && (
          <View style={styles.accessibilityNote}>
            <Text style={styles.accessibilityWarning}>
              Volume key interception requires the Signal Bridge accessibility service to be
              enabled. This only intercepts volume key presses — no screen reading or other
              permissions.
            </Text>
            <TouchableOpacity
              style={styles.accessibilityButton}
              onPress={() => Linking.openSettings()}
            >
              <Text style={styles.accessibilityButtonText}>Open Accessibility Settings</Text>
            </TouchableOpacity>
            <Text style={styles.accessibilityFooter}>
              The notification STOP ALL button and in-app button are always active regardless
              of this setting.
            </Text>
          </View>
        )}
      </View>

      {/* About */}
      <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>About</Text>
      <View style={styles.card}>
        <View style={styles.infoRow}>
          <Text style={styles.label}>Version</Text>
          <Text style={styles.value}>{Constants.expoConfig?.version ?? '—'}</Text>
        </View>
        <View style={[styles.infoRow, styles.infoRowLast]}>
          <Text style={styles.label}>Server</Text>
          <Text style={styles.value} numberOfLines={1}>{serverUrl || '—'}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={() => { handleSignOut().catch(() => {}); }}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SliderRow({
  label,
  value,
  unit,
  min,
  max,
  step,
  hint,
  last,
  onValueChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
  last?: boolean;
  onValueChange: (v: number) => void;
}) {
  const display = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return (
    <View style={[sliderStyles.container, last && sliderStyles.last]}>
      <View style={sliderStyles.header}>
        <Text style={sliderStyles.label}>{label}</Text>
        <Text style={sliderStyles.value}>{display}{unit}</Text>
      </View>
      <Slider
        style={sliderStyles.slider}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={onValueChange}
        minimumTrackTintColor={T.amber}
        maximumTrackTintColor="#E0E0E0"
        thumbTintColor={T.amber}
      />
      {hint != null && <Text style={sliderStyles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: T.text,
    marginBottom: 8,
  },
  sectionTitleSpaced: { marginTop: 24 },
  card: {
    backgroundColor: T.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.border,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  infoRowLast: { borderBottomWidth: 0 },
  label: { color: T.textMuted, fontSize: 15 },
  value: { color: T.text, fontSize: 15, fontWeight: '500' },
  expired: { color: T.red },
  input: { backgroundColor: T.surface, marginBottom: 12 },
  saveButton: {
    backgroundColor: T.primary,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 4,
  },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  governorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  governorRowText: { flex: 1, marginRight: 12 },
  governorTitle: { fontSize: 15, fontWeight: '600', color: T.text },
  governorSubtitle: { fontSize: 12, color: T.textMuted, marginTop: 2 },
  accessibilityNote: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  accessibilityWarning: {
    fontSize: 13,
    color: T.amber,
    lineHeight: 18,
    marginBottom: 12,
  },
  accessibilityButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.primary,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  accessibilityButtonText: { color: T.primary, fontSize: 15, fontWeight: '600' },
  accessibilityFooter: { fontSize: 12, color: T.textMuted, lineHeight: 16 },
  signOutButton: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
    borderWidth: 1,
    borderColor: T.primary,
  },
  signOutText: { color: T.primary, fontSize: 16, fontWeight: '600' },
});

const sliderStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  last: { borderBottomWidth: 0 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  label: { fontSize: 14, color: T.text },
  value: { fontSize: 14, fontWeight: '600', color: T.text },
  slider: { width: '100%', height: 36 },
  hint: { fontSize: 12, color: T.textMuted, marginTop: 2, marginBottom: 4 },
});
