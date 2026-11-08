/* Minimaler Discord-Rich-Presence-Client (IPC über Named Pipe / Unix-Socket), ohne Abhängigkeiten */
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const pipePath = n => (process.platform === 'win32'
  ? `\\\\?\\pipe\\discord-ipc-${n}`
  : path.join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp', `discord-ipc-${n}`));

const frame = (op, data) => {
  const j = Buffer.from(JSON.stringify(data));
  const b = Buffer.alloc(8 + j.length);
  b.writeInt32LE(op, 0);
  b.writeInt32LE(j.length, 4);
  j.copy(b, 8);
  return b;
};

class Rpc {
  constructor() {
    this.sock = null;
    this.ready = false;
    this.want = false;
    this.id = '';
    this.error = '';
    this.activity = null;
    this.timer = null;
    this.buf = Buffer.alloc(0);
  }

  start(id) {
    id = String(id || '').trim();
    if (!/^\d{15,22}$/.test(id)) {
      this.stop();
      this.error = id ? 'Ungültige Application-ID' : 'Keine Application-ID eingetragen';
      return;
    }
    if (this.want && this.id === id) return;
    this.stop();
    this.want = true;
    this.id = id;
    this.error = '';
    this.connect(0);
  }

  stop() {
    this.want = false;
    this.ready = false;
    this.id = '';
    clearTimeout(this.timer);
    if (this.sock) {
      try { this.sock.destroy(); } catch {}
      this.sock = null;
    }
  }

  retry() {
    clearTimeout(this.timer);
    if (this.want) this.timer = setTimeout(() => this.connect(0), 15000);
  }

  connect(n) {
    if (!this.want) return;
    if (n > 9) {
      this.error = 'Discord nicht gefunden – läuft die Desktop-App?';
      return this.retry();
    }
    const s = net.createConnection(pipePath(n));
    let opened = false;
    s.once('connect', () => {
      opened = true;
      this.sock = s;
      this.buf = Buffer.alloc(0);
      s.write(frame(0, { v: 1, client_id: this.id }));
    });
    s.on('data', d => this.read(s, d));
    s.on('error', () => { if (!opened) this.connect(n + 1); });
    s.on('close', () => {
      if (!opened || this.sock !== s) return;
      this.ready = false;
      this.sock = null;
      if (this.want) {
        this.error = 'Verbindung zu Discord getrennt';
        this.retry();
      }
    });
  }

  read(s, d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) return;
      let msg = {};
      try { msg = JSON.parse(this.buf.subarray(8, 8 + len).toString('utf8')); } catch {}
      this.buf = this.buf.subarray(8 + len);
      if (op === 3) s.write(frame(4, msg));
      else if (op === 2) this.error = (msg && msg.message) || 'Discord hat die Verbindung abgelehnt';
      else if (msg.evt === 'READY') {
        this.ready = true;
        this.error = '';
        this.send();
      } else if (msg.evt === 'ERROR') this.error = (msg.data && msg.data.message) || 'Discord-Fehler';
    }
  }

  send() {
    if (!this.ready || !this.sock) return;
    this.sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: this.activity || undefined }, nonce: crypto.randomUUID() }));
  }

  setActivity(a) {
    this.activity = a;
    this.send();
  }

  status() {
    return { connected: this.ready, enabled: this.want, error: this.error };
  }
}

module.exports = { Rpc };
