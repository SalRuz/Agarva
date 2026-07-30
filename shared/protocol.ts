/** Simple JSON WebSocket protocol */
import type { GameplayConfig } from './gameConfig';

export interface JoinMessage {
  type: 'join';
  name: string;
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
}

export interface AdminGetSettingsMessage {
  type: 'adminGetSettings';
}

export interface AdminUpdateSettingsMessage {
  type: 'adminUpdateSettings';
  settings: GameplayConfig;
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

export interface ResetStarterMessage {
  type: 'resetStarter';
}

export interface RenameMessage {
  type: 'rename';
  name: string;
}

export interface ChatSendMessage {
  type: 'chat';
  text: string;
}

export type ClientMessage =
  | JoinMessage
  | InputMessage
  | SplitMessage
  | EjectMessage
  | PingMessage
  | AdminAuthMessage
  | AdminIdentifyMessage
  | AdminAddMassMessage
  | AdminGetSettingsMessage
  | AdminUpdateSettingsMessage
  | AdminSpawnVirusMessage
  | AdminTeleportMessage
  | ResetStarterMessage
  | RenameMessage
  | ChatSendMessage;

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
  leaderboard: LeaderboardEntry[];
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
  | ChatBroadcastMessage;
