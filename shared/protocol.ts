/** Simple JSON WebSocket protocol */
import type { GameplayConfig } from './gameConfig';

export type FightRoomMode = 'soloFight' | 'duoFight' | 'trioFight';
export type RoomMode = 'classic' | FightRoomMode;
export type FightTeam = 'blue' | 'red';

export interface JoinMessage {
  type: 'join';
  name: string;
  /** Required when joining as an admin nickname */
  password?: string;
  /** Equipped skin id (filename), optional */
  skin?: string;
  /** Room mode (default classic) */
  mode: RoomMode;
  /** Required for team fight rooms; selected before joining the match. */
  team?: FightTeam;
  /** Stable browser/device id for profile persistence */
  deviceId?: string;
  /** Soft fingerprint for recovery if localStorage cleared */
  fingerprint?: string;
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
  mode?: RoomMode;
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

export interface AdminSkipQuestMessage {
  type: 'adminSkipQuest';
}

export interface AdminIdentifyMessage {
  type: 'adminIdentify';
  name: string;
  password?: string;
}

export interface AdminGetSettingsMessage {
  type: 'adminGetSettings';
  mode?: RoomMode;
}

export interface AdminUpdateSettingsMessage {
  type: 'adminUpdateSettings';
  settings: GameplayConfig;
  mode?: RoomMode;
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

export interface PrivateMessage {
  type: 'privateMessage';
  to: string;
  text: string;
}

export interface LobbyMessage {
  type: 'lobby';
  mode?: RoomMode;
}

export interface SyncProfileMessage {
  type: 'syncProfile';
  deviceId: string;
  fingerprint?: string;
  lastNick?: string;
  skinId?: string | null;
  prefs?: Record<string, unknown>;
}

export interface RegisterAccountMessage {
  type: 'registerAccount';
  deviceId: string;
  fingerprint?: string;
  login: string;
  password: string;
}

export interface LoginAccountMessage {
  type: 'loginAccount';
  deviceId: string;
  fingerprint?: string;
  login: string;
  password: string;
}

export interface RequestPasswordResetMessage {
  type: 'requestPasswordReset';
  login: string;
  deviceId?: string;
}

export interface ConfirmPasswordResetMessage {
  type: 'confirmPasswordReset';
  login: string;
  code: string;
  newPassword: string;
}

export interface AdminDownloadDbMessage {
  type: 'adminDownloadDb';
}

export interface AdminUploadDbMessage {
  type: 'adminUploadDb';
  json: string;
}

export interface AdminWipeDatabaseMessage {
  type: 'adminWipeDatabase';
  confirmation: string;
}

export interface AdminGetBotLogsMessage {
  type: 'adminGetBotLogs';
}

export interface AdminRestartClassicMessage {
  type: 'adminRestartClassic';
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
  | AdminSkipQuestMessage
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
  | PrivateMessage
  | LobbyMessage
  | SyncProfileMessage
  | RegisterAccountMessage
  | LoginAccountMessage
  | RequestPasswordResetMessage
  | ConfirmPasswordResetMessage
  | AdminDownloadDbMessage
  | AdminUploadDbMessage
  | AdminWipeDatabaseMessage
  | AdminGetBotLogsMessage
  | AdminRestartClassicMessage;

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
  /** Account level for badge (humans only). */
  level?: number;
  /** The player chose not to expose their level. */
  hideLevel?: boolean;
}

export interface StateMessage {
  type: 'state';
  t: number;
  you: NetPlayer | null;
  players: NetPlayer[];
  /**
   * Omitted on intermediate low-traffic snapshots. The client keeps its last
   * full food view until the next food snapshot.
   */
  food?: NetFood[];
  viruses: NetVirus[];
  ejected: NetEjected[];
  /** Entity ids that existed in an earlier snapshot but were destroyed server-side. */
  removedFoodIds?: string[];
  removedVirusIds?: string[];
  removedEjectedIds?: string[];
  /**
   * When 1, `food` contains only newly visible pellets; client merges into its
   * food cache. Removals use removedFoodIds (destroyed or left FOV).
   */
  foodDelta?: 1;
  /** Omitted on some ticks — client should keep last leaderboard */
  leaderboard?: LeaderboardEntry[];
  /** All player ids owned by this session (multibox); active is `you` */
  ownedIds?: string[];
  /** Weekly-mode leader used by the map-center emblem. */
  centerLeader?: { name: string; skin?: string; score: number };
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
  level?: number;
  hideLevel?: boolean;
  /** Message was injected from the linked Telegram bot. */
  fromTg?: boolean;
}

export interface PrivateChatMessage {
  type: 'privateChat';
  name: string;
  text: string;
  t: number;
  color?: string;
  level?: number;
  hideLevel?: boolean;
}

export interface SettingsMessage {
  type: 'settings';
  settings: GameplayConfig;
  mode?: RoomMode;
}

export interface RoomInfoMessage {
  type: 'roomInfo';
  /** Human players currently alive in the match */
  players: number;
  /** Spectators only (not lobbyOnly menu watchers, not playing) */
  lobby: number;
  mode?: RoomMode;
  /** Team lobby occupancy for Duo/Trio Fight. */
  blue?: number;
  red?: number;
  /** Live team roster for the mode-preview menu. */
  blueMembers?: string[];
  redMembers?: string[];
}

/** Complete lobby state. Sent to the single menu observer once per second and
 * immediately after every room/team membership change. */
export interface LobbySnapshotMessage {
  type: 'lobbySnapshot';
  rooms: Record<RoomMode, Omit<RoomInfoMessage, 'type' | 'mode'>>;
  /** Current weekly rankings shown in the menu for every mode. */
  tops?: Record<RoomMode, { name: string; score: number }[]>;
  /** Server-authoritative weekly reset deadlines (Unix milliseconds). */
  weeklyTopEndsAt?: Record<RoomMode, number>;
}

export interface SoloFightHudMessage {
  type: 'soloFightHud';
  phase: 'waiting' | 'countdown' | 'fighting' | 'ended' | 'resetting' | 'between';
  /** Seconds left in countdown (ceil), or 0 */
  countdown: number;
  /** Seconds left in the 5-minute fight timer while fighting */
  fightSecondsLeft?: number;
  /** Current consecutive wins, not career total. */
  a: { name: string; score: number };
  b: { name: string; score: number };
}

export interface SoloFightTopMessage {
  type: 'soloFightTop';
  entries: { name: string; score: number }[];
}

export interface TeamFightHudMessage {
  type: 'teamFightHud';
  mode: 'duoFight' | 'trioFight';
  phase: 'waiting' | 'countdown' | 'fighting' | 'ended' | 'resetting' | 'between';
  countdown: number;
  fightSecondsLeft?: number;
  /** `streaks` contains current consecutive wins by member name. */
  blue: { alive: number; total: number; members: string[]; streaks: Record<string, number> };
  red: { alive: number; total: number; members: string[]; streaks: Record<string, number> };
  spectators?: number;
}

export interface TeamFightTopMessage {
  type: 'teamFightTop';
  mode: FightRoomMode;
  entries: { name: string; score: number }[];
}

export interface PlayerProfileMessage {
  type: 'playerProfile';
  deviceId: string;
  lastNick?: string;
  skinId?: string;
  prefs?: Record<string, unknown>;
  accountLogin?: string | null;
  quest?: {
    level: number;
    xp: number;
    xpIntoLevel: number;
    xpPerLevel: number;
    agarviki: number;
    taskId: string;
    title: string;
    progress: number;
    requirement: number;
    unit: 'mass' | 'minutes' | 'count';
    remainingMs?: number;
    condition: string;
    timeRunning?: boolean;
    hint?: string;
    followerOnly?: boolean;
    claimedLevelRewards: number[];
    unlockedSkinIds: string[];
    pendingLevelRewards?: number[];
  };
}

export interface RegisterAccountResultMessage {
  type: 'registerAccountResult';
  ok: boolean;
  message: string;
  accountLogin?: string;
}

export interface LoginAccountResultMessage {
  type: 'loginAccountResult';
  ok: boolean;
  message: string;
  accountLogin?: string;
}

export interface PasswordResetResultMessage {
  type: 'passwordResetResult';
  action: 'request' | 'confirm';
  ok: boolean;
  message: string;
}

export interface AdminDbExportMessage {
  type: 'adminDbExport';
  json: string;
}

export interface AdminDbResultMessage {
  type: 'adminDbResult';
  ok: boolean;
  message: string;
}

export interface AdminBotLogsMessage {
  type: 'adminBotLogs';
  text: string;
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
  | PrivateChatMessage
  | RoomInfoMessage
  | LobbySnapshotMessage
  | SoloFightHudMessage
  | SoloFightTopMessage
  | TeamFightHudMessage
  | TeamFightTopMessage
  | PlayerProfileMessage
  | RegisterAccountResultMessage
  | LoginAccountResultMessage
  | PasswordResetResultMessage
  | AdminDbExportMessage
  | AdminDbResultMessage
  | AdminBotLogsMessage;
