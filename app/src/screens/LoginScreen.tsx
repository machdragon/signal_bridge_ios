import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { TextInput as PaperInput } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { tokenManager } from '../auth/TokenManager';
import { T } from '../theme';

interface Props {
  onLoginSuccess: () => void;
}

export function LoginScreen({ onLoginSuccess }: Props) {
  const navigation = useNavigation();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [serverUrl, setServerUrl] = useState('https://signal-bridge.duckdns.org');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    tokenManager.getServerUrl()
      .then((saved) => { if (!cancelled) setServerUrl(saved); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit() {
    setError(null);
    if (!username.trim()) { setError('Username is required'); return; }
    if (!password) { setError('Password is required'); return; }
    if (isRegisterMode && password !== confirmPassword) { setError("Passwords don't match"); return; }
    if (isRegisterMode && password.length < 8) { setError('Password must be at least 8 characters'); return; }

    setLoading(true);
    try {
      const url = serverUrl.trim().replace(/\/$/, '');
      const endpoint = isRegisterMode ? 'register' : 'login';
      const response = await fetch(`${url}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setError((data.error as string) ?? (isRegisterMode ? 'Registration failed' : 'Invalid credentials'));
        return;
      }
      await tokenManager.saveAuth(data.token as string, data.username as string, data.user_id as string);
      await tokenManager.setServerUrl(url);
      onLoginSuccess();
    } catch (e) {
      const msg = String(e);
      if (msg.includes('Network') || msg.includes('fetch')) {
        setError("Can't reach server. Check your connection and server URL.");
      } else {
        setError(`Connection error: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }

  function toggleMode() {
    setIsRegisterMode((m) => !m);
    setError(null);
    setConfirmPassword('');
    setShowPassword(false);
  }

  const inputTheme = { colors: { primary: T.primary } };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.settingsIcon} onPress={() => navigation.navigate('Settings' as never)}>
            <Ionicons name="settings-outline" size={24} color={T.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>Signal Bridge</Text>
        <Text style={styles.subtitle}>
          {isRegisterMode ? 'Create your account' : 'Sign in to continue'}
        </Text>

        <PaperInput
          mode="outlined"
          label="Username"
          value={username}
          onChangeText={(v) => { setUsername(v); setError(null); }}
          autoCapitalize="none"
          editable={!loading}
          style={styles.input}
          theme={inputTheme}
          outlineColor={T.border}
          activeOutlineColor={T.primary}
        />

        <PaperInput
          mode="outlined"
          label="Password"
          value={password}
          onChangeText={(v) => { setPassword(v); setError(null); }}
          secureTextEntry={!showPassword}
          editable={!loading}
          style={styles.input}
          theme={inputTheme}
          outlineColor={T.border}
          activeOutlineColor={T.primary}
          right={
            <PaperInput.Icon
              icon={showPassword ? 'eye-off' : 'eye'}
              onPress={() => setShowPassword((v) => !v)}
              color={T.textMuted}
            />
          }
        />

        {isRegisterMode && (
          <PaperInput
            mode="outlined"
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={(v) => { setConfirmPassword(v); setError(null); }}
            secureTextEntry
            editable={!loading}
            style={styles.input}
            theme={inputTheme}
            outlineColor={T.border}
            activeOutlineColor={T.primary}
          />
        )}

        {error != null && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={() => { handleSubmit().catch(() => {}); }}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? '…' : isRegisterMode ? 'Create Account' : 'Sign In'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toggleButton} onPress={toggleMode} disabled={loading}>
          <Text style={styles.toggleText}>
            {isRegisterMode
              ? 'Already have an account? Sign in'
              : "Don't have an account? Create one"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.advancedToggle} onPress={() => setShowAdvanced((v) => !v)}>
          <Text style={styles.advancedLabel}>Advanced</Text>
        </TouchableOpacity>

        {showAdvanced && (
          <PaperInput
            mode="outlined"
            label="Server URL"
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            keyboardType="url"
            editable={!loading}
            style={styles.input}
            theme={inputTheme}
            outlineColor={T.border}
            activeOutlineColor={T.primary}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 24 },
  topRow: { alignItems: 'flex-end', marginBottom: 8 },
  settingsIcon: { padding: 4 },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: T.primary,
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: T.textMuted,
    textAlign: 'center',
    marginBottom: 32,
  },
  input: {
    backgroundColor: T.surface,
    marginBottom: 12,
  },
  errorCard: {
    backgroundColor: '#FFEBEE',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  errorText: { color: T.primary, fontSize: 14 },
  button: {
    backgroundColor: T.primary,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  toggleButton: { alignItems: 'center', marginTop: 20 },
  toggleText: { color: T.primary, fontSize: 14 },
  advancedToggle: { alignItems: 'center', marginTop: 24 },
  advancedLabel: { color: T.textMuted, fontSize: 13 },
});
