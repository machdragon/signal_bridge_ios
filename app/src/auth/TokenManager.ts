/**
 * TokenManager — secure token storage using expo-secure-store.
 *
 * Uses iOS Keychain / Android Keystore under the hood.
 * All methods are async and safe to call from UI code.
 */

import * as SecureStore from 'expo-secure-store';

const KEY_TOKEN = 'jwt_token';
const KEY_USERNAME = 'username';
const KEY_USER_ID = 'user_id';
const KEY_SERVER_URL = 'server_url';
const KEY_INTIFACE_URL = 'intiface_url';
const KEY_VOLUME_KEY_ENABLED = 'volume_key_enabled';

const DEFAULT_SERVER_URL = 'https://signal-bridge.duckdns.org';
const DEFAULT_INTIFACE_URL = 'ws://127.0.0.1:12345';

export class TokenManager {
  async getToken(): Promise<string | null> {
    return SecureStore.getItemAsync(KEY_TOKEN);
  }

  async setToken(value: string): Promise<void> {
    await SecureStore.setItemAsync(KEY_TOKEN, value);
  }

  async getUsername(): Promise<string | null> {
    return SecureStore.getItemAsync(KEY_USERNAME);
  }

  async getUserId(): Promise<string | null> {
    return SecureStore.getItemAsync(KEY_USER_ID);
  }

  async getServerUrl(): Promise<string> {
    return (await SecureStore.getItemAsync(KEY_SERVER_URL)) ?? DEFAULT_SERVER_URL;
  }

  async setServerUrl(value: string): Promise<void> {
    await SecureStore.setItemAsync(KEY_SERVER_URL, value);
  }

  async getIntifaceUrl(): Promise<string> {
    return (await SecureStore.getItemAsync(KEY_INTIFACE_URL)) ?? DEFAULT_INTIFACE_URL;
  }

  async setIntifaceUrl(value: string): Promise<void> {
    await SecureStore.setItemAsync(KEY_INTIFACE_URL, value);
  }

  async getVolumeKeyEnabled(): Promise<boolean> {
    const val = await SecureStore.getItemAsync(KEY_VOLUME_KEY_ENABLED);
    return val !== 'false'; // default true
  }

  async setVolumeKeyEnabled(value: boolean): Promise<void> {
    await SecureStore.setItemAsync(KEY_VOLUME_KEY_ENABLED, value ? 'true' : 'false');
  }

  async isLoggedIn(): Promise<boolean> {
    const token = await this.getToken();
    if (!token) return false;
    return !isTokenExpired(token);
  }

  async tokenExpiryDisplay(): Promise<string | null> {
    const token = await this.getToken();
    if (!token) return null;
    return getTokenExpiryDisplay(token);
  }

  async saveAuth(token: string, username: string, userId: string): Promise<void> {
    await SecureStore.setItemAsync(KEY_TOKEN, token);
    await SecureStore.setItemAsync(KEY_USERNAME, username);
    await SecureStore.setItemAsync(KEY_USER_ID, userId);
  }

  async clearAuth(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY_TOKEN);
    await SecureStore.deleteItemAsync(KEY_USERNAME);
    await SecureStore.deleteItemAsync(KEY_USER_ID);
  }
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isTokenExpired(jwt: string): boolean {
  const payload = decodeJwtPayload(jwt);
  if (!payload) return true;
  const exp = payload.exp as number | undefined;
  if (!exp) return true;
  return Date.now() / 1000 > exp;
}

function getTokenExpiryDisplay(jwt: string): string | null {
  const payload = decodeJwtPayload(jwt);
  if (!payload) return null;
  const exp = payload.exp as number | undefined;
  if (!exp) return null;
  const remaining = exp - Date.now() / 1000;
  if (remaining <= 0) return 'Expired';
  if (remaining < 3600) return `${Math.floor(remaining / 60)}m remaining`;
  if (remaining < 86400) return `${Math.floor(remaining / 3600)}h remaining`;
  return `${Math.floor(remaining / 86400)}d remaining`;
}

// Singleton export
export const tokenManager = new TokenManager();
