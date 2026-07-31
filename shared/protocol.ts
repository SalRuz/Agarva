/** Simple JSON WebSocket protocol */
import type { GameplayConfig } from './gameConfig';

export interface JoinMessage {
  type: 'join';
  name: string;
  /** Required when joining as an admin nickname */
  password?: string;
  /** Equipped skin id (filename), optional */
  skin?: string;
  /** Room mode (default classic) */
  mode?: 'classic' | 'soloFight';
}

export interface InputMessage {
  type: 'input';
  mx: number;
  my: number;
}

export interface SplitMessage {
  type: 'split';
}

export interface EjectMessage {
  type: 'eject';
}

export interface FreezeMessage {
  type: 'freeze';
  /** If omitted, server toggles */
  frozen?: boolean;
}

export interface SpectateMessage {
  type: 'spectate';
  mode?: 'classic' | 'soloFight';
}

export interface PingMessage {
  type: 'ping';
  t: number;
}

export interface AdminAuthMessage {
  type: 'adminAuth';
  token: string;
}

export interface AdminAddMassMessage {
  type: 'adminAddMass';
  amount?: number;
}

export interface AdminIdentifyMessage {
  type: 'adminIdentify';
  name: string;
  password?: string;
}

export interface AdminGetSettingsMessage {
  type: 'adminGetSettings';
  mode?: 'classic' | 'soloFight';
}

export interface AdminUpdateSettingsMessage {
  type: 'adminUpdateSettings';
  settings: GameplayConfig;
  mode?: 'classic' | 'soloFight';
}

export interface AdminSpawnVirusMessage {
  type: 'adminSpawnVirus';
  x: number;
  y: number;
}

export interface AdminTeleportMessage {
  type: 'adminTeleport';
  x: number;
  y: number;
}

export interface AdminForceMergeMessage {
  type: 'adminForceMerge';
}

export interface AdminKickAtMessage {
  type: 'adminKickAt';
  x: number;
  y: number;
}

export interface AdminSpawnBotMessage {
  type: 'adminSpawnBot';
  x: number;
  y: number;
  mass?: number;
}

export interface ResetStarterMessage {
  type: 'resetStarter';
}

export interface RenameMessage {
  type: 'rename';
  name: string;
  password?: string;
  /** Equipped skin id (filename), optional */
  skin?: string;
}

export interface MultiboxSpawnMessage {
  type: 'multiboxSpawn';
}

export interface MultiboxSwitchMessage {
  type: 'multiboxSwitch';
}

export interface ChatSendMessage {
  type: 'chat';
  text: string;
}

export interface LobbyMessage {
  type: 'lobby';
  mode?: 'classic' | 'soloFight';
}

export type ClientMessage =
  | JoinMessage
  | InputMessage
  | SplitMessage
  | EjectMessage
  | FreezeMessage
  | SpectateMessage
  | PingMessage
  | AdminAuthMessage
  | AdminIdentifyMessage
  | AdminAddMassMessage
  | AdminGetSettingsMessage
  | AdminUpdateSettingsMessage
  | AdminSpawnVirusMessage
  | AdminTeleportMessage
  | AdminForceMergeMessage
  | AdminKickAtMessage
  | AdminSpawnBotMessage
  | ResetStarterMessage
  | RenameMessage
  | MultiboxSpawnMessage
  | MultiboxSwitchMessage
  | ChatSendMessage
  | LobbyMessage;

export interface WelcomeMessage {
  type: 'welcome';
  id: string;
  world: { w: number; h: number };
  isAdmin?: boolean;
}

export interface NetCell {
  id: string;
  x: number;
  y: number;
  r: number;
  c: string;
}

export interface NetPlayer {
  id: string;
  name: string;
  color: string;
  score: number;
  cells: NetCell[];
  /** 1 = frozen in place */
  fr?: number;
  /** Equipped skin id */
  skin?: string;
}

export interface NetFood {
  id: string;
  x: number;
  y: number;
  c: string;
}

export interface NetVirus {
  id: string;
  x: number;
  y: number;
  r: number;
  ch: number;
}

export interface NetEjected {
  id: string;
  x: number;
  y: number;
  r: number;
  c: string;
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  isBot: boolean;
}

export interface StateMessage {
  type: 'state';
  t: number;
  you: NetPlayer | null;
  players: NetPlayer[];
  food: NetFood[];
  viruses: NetVirus[];
  ejected: NetEjected[];
  /** Omitted on some ticks — client should keep last leaderboard */
  leaderboard?: LeaderboardEntry[];
  /** All player ids owned by this session (multibox); active is `you` */
  ownedIds?: string[];
}

export interface DiedMessage {
  type: 'died';
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface PongMessage {
  type: 'pong';
  t: number;
}

export interface WorldMessage {
  type: 'world';
  w: number;
  h: number;
}

export interface AdminStatusMessage {
  type: 'adminStatus';
  ok: boolean;
}

export interface ChatBroadcastMessage {
  type: 'chat';
  name: string;
  text: string;
  t: number;
  color?: string;
}

export interface SettingsMessage {
  type: 'settings';
  settings: GameplayConfig;
  mode?: 'classic' | 'soloFight';
}

export interface RoomInfoMessage {
  type: 'roomInfo';
  /** Human players currently alive in the match */
  players: number;
  /** Connected clients in menu / spectating / dead (not actively playing) */
  lobby: number;
  mode?: 'classic' | 'soloFight';
}

export interface SoloFightHudMessage {
  type: 'soloFightHud';
  phase: 'waiting' | 'countdown' | 'fighting' | 'between';
  /** Seconds left in countdown (ceil), or 0 */
  countdown: number;
  a: { name: string; score: number };
  b: { name: string; score: number };
}

export type ServerMessage =
  | WelcomeMessage
  | StateMessage
  | DiedMessage
  | ErrorMessage
  | PongMessage
  | WorldMessage
  | AdminStatusMessage
  | SettingsMessage
  | ChatBroadcastMessage
  | RoomInfoMessage
  | SoloFightHudMessage;
