/**
 * ServerConnection — WebSocket connection to the VPS relay server.
 *
 * Handles:
 *  - JWT authentication (phone_auth → auth_ok)
 *  - Sending device_list reports
 *  - Receiving commands and routing them to the engine
 *  - Heartbeat ping/pong (auto-responds; fires callbacks for watchdog + governor)
 *  - Sending command_ack responses
 */

export interface GovernorSnapshot {
  heatPct: number;
  inCooldown: boolean;
  cooldownRemaining: number;
  cooldownCount: number;
  predictedSeconds: number | null;
}

export interface ServerMessage {
  type: string;
  payload: Record<string, unknown>;
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

type CommandListener = (msg: ServerMessage) => void;
type DisconnectListener = () => void;

export class ServerConnection {
  private baseUrl: string;
  private token: string;
  private ws: WebSocket | null = null;
  private _isConnected = false;
  // Set to true the moment onclose fires. If onDisconnect() is registered
  // after this point (i.e. the socket dropped in the gap between connect()
  // resolving and the relay loop reaching Step 7), fire the listener
  // immediately so the await-Promise in relayLoop never hangs.
  private _didDisconnect = false;

  private commandListeners: CommandListener[] = [];
  private disconnectListeners: DisconnectListener[] = [];

  onHeartbeatReceived: (() => void) | null = null;
  onGovernorUpdate: ((gov: GovernorSnapshot) => void) | null = null;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  onCommand(listener: CommandListener): () => void {
    this.commandListeners.push(listener);
    return () => { this.commandListeners = this.commandListeners.filter((l) => l !== listener); };
  }

  onDisconnect(listener: DisconnectListener): () => void {
    if (this._didDisconnect) {
      // Socket already closed before this listener was registered.
      // Fire synchronously so the relay loop isn't left hanging.
      try { listener(); } catch { /* ignore */ }
      return () => {};
    }
    this.disconnectListeners.push(listener);
    return () => { this.disconnectListeners = this.disconnectListeners.filter((l) => l !== listener); };
  }

  /**
   * Connect to the server and authenticate with JWT.
   * Throws AuthenticationError on bad credentials; generic Error on network failure.
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.buildWsUrl();
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      let authDone = false;

      const authTimeout = setTimeout(() => {
        if (!authDone) {
          reject(new Error('Auth timeout'));
          ws.close();
        }
      }, 10_000);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'phone_auth', token: this.token }));
      };

      ws.onmessage = (event) => {
        const text = typeof event.data === 'string' ? event.data : '';
        if (!authDone) {
          try {
            const msg = JSON.parse(text) as Record<string, unknown>;
            if (msg.type === 'auth_ok') {
              authDone = true;
              clearTimeout(authTimeout);
              this._isConnected = true;
              resolve();
            } else {
              clearTimeout(authTimeout);
              const errMsg = (msg.message as string) ?? 'Authentication failed';
              reject(new AuthenticationError(errMsg));
              ws.close();
            }
          } catch {
            clearTimeout(authTimeout);
            reject(new Error('Invalid auth response'));
            ws.close();
          }
          return;
        }
        this.handleMessage(text);
      };

      ws.onerror = () => {
        this._isConnected = false;
        clearTimeout(authTimeout);
        if (!authDone) {
          reject(new Error('WebSocket connection failed'));
        }
      };

      ws.onclose = () => {
        clearTimeout(authTimeout);
        this._isConnected = false;
        if (!authDone) {
          reject(new Error('WebSocket closed before auth'));
        }
        this._didDisconnect = true;
        for (const listener of this.disconnectListeners) {
          try { listener(); } catch { /* ignore */ }
        }
      };
    });
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as Record<string, unknown>;
      const type = msg.type as string;
      if (!type) return;

      switch (type) {
        case 'ping':
        case 'heartbeat_ping':
          this.sendPong().catch(() => {});
          this.onHeartbeatReceived?.();
          const gov = extractGovernor(msg);
          if (gov) this.onGovernorUpdate?.(gov);
          break;
        case 'command':
        case 'pattern':
        case 'stop':
        case 'scan':
        case 'read_sensor':
          for (const listener of this.commandListeners) {
            try { listener({ type, payload: msg }); } catch { /* ignore */ }
          }
          break;
        default:
          break;
      }
    } catch {
      // ignore malformed messages
    }
  }

  async sendDeviceList(devices: Array<Record<string, unknown>>): Promise<void> {
    await this.send(JSON.stringify({ type: 'device_list', devices }));
  }

  async sendAck(
    success: boolean,
    message: string,
    requestId: string,
    devicesAffected: string[] = [],
  ): Promise<void> {
    await this.send(
      JSON.stringify({
        type: 'command_ack',
        request_id: requestId,
        success,
        message,
        devices_affected: devicesAffected,
      }),
    );
  }

  async sendEmergencyStop(): Promise<void> {
    await this.send(JSON.stringify({ type: 'phone_emergency_stop' }));
  }

  async sendPong(): Promise<void> {
    await this.send(JSON.stringify({ type: 'heartbeat_pong' }));
  }

  async close(): Promise<void> {
    this._isConnected = false;
    try { this.ws?.close(1000, 'Disconnecting'); } catch { /* ignore */ }
    this.ws = null;
  }

  private send(message: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this._isConnected) {
        reject(new Error('Not connected'));
        return;
      }
      try {
        this.ws.send(message);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  private buildWsUrl(): string {
    let base = this.baseUrl.replace(/\/$/, '');
    if (base.startsWith('https://')) {
      base = 'wss://' + base.slice('https://'.length);
    } else if (base.startsWith('http://')) {
      base = 'ws://' + base.slice('http://'.length);
    } else if (!base.startsWith('wss://') && !base.startsWith('ws://')) {
      base = 'wss://' + base;
    }
    return base.endsWith('/ws/phone') ? base : base + '/ws/phone';
  }
}

function extractGovernor(msg: Record<string, unknown>): GovernorSnapshot | null {
  const heat = msg.heat_pct as number | undefined;
  if (heat === undefined) return null;
  return {
    heatPct: heat,
    inCooldown: (msg.in_cooldown as boolean) ?? false,
    cooldownRemaining: (msg.cooldown_remaining as number) ?? 0,
    cooldownCount: (msg.cooldown_count as number) ?? 0,
    predictedSeconds: (msg.predicted_seconds as number | null) ?? null,
  };
}
