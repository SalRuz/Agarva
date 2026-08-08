/**
 * Compact binary encoding for state snapshots (low-traffic / net-optimize mode).
 * Layout is little-endian. Colors are packed as RGB uint8 triples.
 */
import type { LeaderboardEntry, NetEjected, NetFood, NetPlayer, NetVirus, StateMessage } from './protocol';

const MAGIC = 0x4153; // 'AS'
const VERSION = 1;

function parseHexColor(c: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(c.trim());
  if (!m) return [78, 205, 196];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function writeString(view: DataView, offset: number, text: string): number {
  const bytes = new TextEncoder().encode(text.slice(0, 255));
  view.setUint8(offset, bytes.length);
  offset += 1;
  new Uint8Array(view.buffer, view.byteOffset + offset, bytes.length).set(bytes);
  return offset + bytes.length;
}

function readString(view: DataView, offset: number): { value: string; offset: number } {
  const len = view.getUint8(offset);
  offset += 1;
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, len);
  return { value: new TextDecoder().decode(bytes), offset: offset + len };
}

function writePlayer(view: DataView, offset: number, p: NetPlayer): number {
  offset = writeString(view, offset, p.id);
  offset = writeString(view, offset, p.name || '');
  const [r, g, b] = parseHexColor(p.color || '#4ECDC4');
  view.setUint8(offset++, r);
  view.setUint8(offset++, g);
  view.setUint8(offset++, b);
  view.setUint16(offset, Math.max(0, Math.min(65535, Math.round(p.score || 0))), true);
  offset += 2;
  view.setUint8(offset++, p.fr ? 1 : 0);
  const skin = p.skin || '';
  offset = writeString(view, offset, skin);
  const cells = p.cells || [];
  view.setUint8(offset++, Math.min(255, cells.length));
  for (const cell of cells) {
    offset = writeString(view, offset, cell.id);
    view.setInt32(offset, Math.round(cell.x), true);
    offset += 4;
    view.setInt32(offset, Math.round(cell.y), true);
    offset += 4;
    view.setUint16(offset, Math.max(0, Math.min(65535, Math.round(cell.r * 2))), true);
    offset += 2;
    const [cr, cg, cb] = parseHexColor(cell.c || p.color || '#4ECDC4');
    view.setUint8(offset++, cr);
    view.setUint8(offset++, cg);
    view.setUint8(offset++, cb);
  }
  return offset;
}

function readPlayer(view: DataView, offset: number): { player: NetPlayer; offset: number } {
  let id: string;
  ({ value: id, offset } = readString(view, offset));
  let name: string;
  ({ value: name, offset } = readString(view, offset));
  const r = view.getUint8(offset++);
  const g = view.getUint8(offset++);
  const b = view.getUint8(offset++);
  const score = view.getUint16(offset, true);
  offset += 2;
  const fr = view.getUint8(offset++);
  let skin: string;
  ({ value: skin, offset } = readString(view, offset));
  const cellCount = view.getUint8(offset++);
  const cells: NetPlayer['cells'] = [];
  for (let i = 0; i < cellCount; i++) {
    let cellId: string;
    ({ value: cellId, offset } = readString(view, offset));
    const x = view.getInt32(offset, true);
    offset += 4;
    const y = view.getInt32(offset, true);
    offset += 4;
    const r2 = view.getUint16(offset, true);
    offset += 2;
    const cr = view.getUint8(offset++);
    const cg = view.getUint8(offset++);
    const cb = view.getUint8(offset++);
    cells.push({ id: cellId, x, y, r: r2 / 2, c: colorToHex(cr, cg, cb) });
  }
  const player: NetPlayer = {
    id,
    name,
    color: colorToHex(r, g, b),
    score,
    cells,
    fr: fr ? 1 : 0,
  };
  if (skin) player.skin = skin;
  return { player, offset };
}

function estimateSize(msg: StateMessage): number {
  // Generous upper bound; buffer is sliced to actual length.
  let n = 64;
  const players = [...(msg.you ? [msg.you] : []), ...msg.players];
  for (const p of players) {
    n += 64 + (p.name?.length || 0) + (p.skin?.length || 0) + p.cells.length * 48;
  }
  n += (msg.food?.length || 0) * 48;
  n += msg.viruses.length * 32;
  n += msg.ejected.length * 40;
  n += (msg.removedFoodIds?.length || 0) * 16;
  n += (msg.removedVirusIds?.length || 0) * 16;
  n += (msg.removedEjectedIds?.length || 0) * 16;
  n += (msg.ownedIds?.length || 0) * 16;
  n += (msg.leaderboard?.length || 0) * 48;
  return Math.max(256, n);
}

function writeIdList(view: DataView, offset: number, ids: string[] | undefined): number {
  const list = ids || [];
  view.setUint16(offset, list.length, true);
  offset += 2;
  for (const id of list) offset = writeString(view, offset, id);
  return offset;
}

function readIdList(view: DataView, offset: number): { ids: string[]; offset: number } {
  const count = view.getUint16(offset, true);
  offset += 2;
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    let id: string;
    ({ value: id, offset } = readString(view, offset));
    ids.push(id);
  }
  return { ids, offset };
}

export function encodeStateBinary(msg: StateMessage): ArrayBuffer {
  // Binary snapshots are not used by the live server. Treat an omitted
  // low-traffic food update as empty here solely to preserve this legacy codec.
  const food = msg.food ?? [];
  const buf = new ArrayBuffer(estimateSize(msg));
  const view = new DataView(buf);
  let o = 0;
  view.setUint16(o, MAGIC, true);
  o += 2;
  view.setUint8(o++, VERSION);
  let flags = 0;
  if (msg.you) flags |= 1;
  if (msg.foodDelta) flags |= 2;
  if (msg.leaderboard) flags |= 4;
  if (msg.ownedIds) flags |= 8;
  view.setUint8(o++, flags);
  view.setUint32(o, msg.t >>> 0, true);
  o += 4;

  if (msg.you) o = writePlayer(view, o, msg.you);

  view.setUint8(o++, Math.min(255, msg.players.length));
  for (const p of msg.players) o = writePlayer(view, o, p);

  view.setUint16(o, food.length, true);
  o += 2;
  for (const f of food) {
    o = writeString(view, o, f.id);
    view.setInt32(o, Math.round(f.x), true);
    o += 4;
    view.setInt32(o, Math.round(f.y), true);
    o += 4;
    const [r, g, b] = parseHexColor(f.c);
    view.setUint8(o++, r);
    view.setUint8(o++, g);
    view.setUint8(o++, b);
  }

  view.setUint16(o, msg.viruses.length, true);
  o += 2;
  for (const v of msg.viruses) {
    o = writeString(view, o, v.id);
    view.setInt32(o, Math.round(v.x), true);
    o += 4;
    view.setInt32(o, Math.round(v.y), true);
    o += 4;
    view.setUint16(o, Math.max(0, Math.min(65535, Math.round(v.r))), true);
    o += 2;
    view.setUint8(o++, Math.max(0, Math.min(255, v.ch | 0)));
  }

  view.setUint16(o, msg.ejected.length, true);
  o += 2;
  for (const e of msg.ejected) {
    o = writeString(view, o, e.id);
    view.setInt32(o, Math.round(e.x), true);
    o += 4;
    view.setInt32(o, Math.round(e.y), true);
    o += 4;
    view.setUint16(o, Math.max(0, Math.min(65535, Math.round(e.r * 2))), true);
    o += 2;
    const [r, g, b] = parseHexColor(e.c);
    view.setUint8(o++, r);
    view.setUint8(o++, g);
    view.setUint8(o++, b);
  }

  o = writeIdList(view, o, msg.removedFoodIds);
  o = writeIdList(view, o, msg.removedVirusIds);
  o = writeIdList(view, o, msg.removedEjectedIds);

  if (msg.ownedIds) o = writeIdList(view, o, msg.ownedIds);

  if (msg.leaderboard) {
    view.setUint8(o++, Math.min(255, msg.leaderboard.length));
    for (const row of msg.leaderboard) {
      o = writeString(view, o, row.name || '');
      view.setUint32(o, Math.max(0, Math.round(row.score || 0)) >>> 0, true);
      o += 4;
    }
  }

  return buf.slice(0, o);
}

export function decodeStateBinary(buffer: ArrayBuffer): StateMessage | null {
  if (buffer.byteLength < 8) return null;
  const view = new DataView(buffer);
  let o = 0;
  if (view.getUint16(o, true) !== MAGIC) return null;
  o += 2;
  if (view.getUint8(o++) !== VERSION) return null;
  const flags = view.getUint8(o++);
  const t = view.getUint32(o, true);
  o += 4;

  let you: NetPlayer | null = null;
  if (flags & 1) {
    ({ player: you, offset: o } = readPlayer(view, o));
  }

  const playerCount = view.getUint8(o++);
  const players: NetPlayer[] = [];
  for (let i = 0; i < playerCount; i++) {
    let player: NetPlayer;
    ({ player, offset: o } = readPlayer(view, o));
    players.push(player);
  }

  const foodCount = view.getUint16(o, true);
  o += 2;
  const food: NetFood[] = [];
  for (let i = 0; i < foodCount; i++) {
    let id: string;
    ({ value: id, offset: o } = readString(view, o));
    const x = view.getInt32(o, true);
    o += 4;
    const y = view.getInt32(o, true);
    o += 4;
    const r = view.getUint8(o++);
    const g = view.getUint8(o++);
    const b = view.getUint8(o++);
    food.push({ id, x, y, c: colorToHex(r, g, b) });
  }

  const virusCount = view.getUint16(o, true);
  o += 2;
  const viruses: NetVirus[] = [];
  for (let i = 0; i < virusCount; i++) {
    let id: string;
    ({ value: id, offset: o } = readString(view, o));
    const x = view.getInt32(o, true);
    o += 4;
    const y = view.getInt32(o, true);
    o += 4;
    const radius = view.getUint16(o, true);
    o += 2;
    const ch = view.getUint8(o++);
    viruses.push({ id, x, y, r: radius, ch });
  }

  const ejectCount = view.getUint16(o, true);
  o += 2;
  const ejected: NetEjected[] = [];
  for (let i = 0; i < ejectCount; i++) {
    let id: string;
    ({ value: id, offset: o } = readString(view, o));
    const x = view.getInt32(o, true);
    o += 4;
    const y = view.getInt32(o, true);
    o += 4;
    const r2 = view.getUint16(o, true);
    o += 2;
    const r = view.getUint8(o++);
    const g = view.getUint8(o++);
    const b = view.getUint8(o++);
    ejected.push({ id, x, y, r: r2 / 2, c: colorToHex(r, g, b) });
  }

  let removedFoodIds: string[];
  ({ ids: removedFoodIds, offset: o } = readIdList(view, o));
  let removedVirusIds: string[];
  ({ ids: removedVirusIds, offset: o } = readIdList(view, o));
  let removedEjectedIds: string[];
  ({ ids: removedEjectedIds, offset: o } = readIdList(view, o));

  let ownedIds: string[] | undefined;
  if (flags & 8) {
    ({ ids: ownedIds, offset: o } = readIdList(view, o));
  }

  let leaderboard: LeaderboardEntry[] | undefined;
  if (flags & 4) {
    const n = view.getUint8(o++);
    leaderboard = [];
    for (let i = 0; i < n; i++) {
      let name: string;
      ({ value: name, offset: o } = readString(view, o));
      const score = view.getUint32(o, true);
      o += 4;
      leaderboard.push({ name, score, isBot: false });
    }
  }

  return {
    type: 'state',
    t,
    you,
    players,
    food,
    viruses,
    ejected,
    removedFoodIds: removedFoodIds.length ? removedFoodIds : undefined,
    removedVirusIds: removedVirusIds.length ? removedVirusIds : undefined,
    removedEjectedIds: removedEjectedIds.length ? removedEjectedIds : undefined,
    foodDelta: flags & 2 ? 1 : undefined,
    ownedIds,
    leaderboard,
  };
}

export function isBinaryStateBuffer(data: ArrayBuffer): boolean {
  if (data.byteLength < 2) return false;
  return new DataView(data).getUint16(0, true) === MAGIC;
}
