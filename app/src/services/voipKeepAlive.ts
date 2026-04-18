import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { VoIPKeepAlive } = NativeModules;

let emitter: NativeEventEmitter | null = null;
let subscription: ReturnType<NativeEventEmitter['addListener']> | null = null;

export function initVoIPKeepAlive(onKeepAlive: () => void): void {
  if (Platform.OS !== 'ios' || !VoIPKeepAlive) return;
  emitter = new NativeEventEmitter(VoIPKeepAlive);
  subscription = emitter.addListener('onKeepAlive', onKeepAlive);
  VoIPKeepAlive.register();
}

export function destroyVoIPKeepAlive(): void {
  if (Platform.OS !== 'ios' || !VoIPKeepAlive) return;
  subscription?.remove();
  subscription = null;
  VoIPKeepAlive.unregister();
}
