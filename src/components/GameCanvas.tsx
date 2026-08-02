import { useRef, useEffect, useCallback, useState, type MutableRefObject } from 'react';
import type { GameState, Player } from '../types/game';
import type { GameEngine } from '../engine/GameEngine';
import {
  getPlayerCenter,
  getVirusColor,
  getMass,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  getEntityViewRadius,
  isWithinViewRadius,
  isEntityNearView,
} from '../utils/gameUtils';
import type { GameplayConfig } from '../../shared/gameConfig';
import type { PlayerPrefs } from '../settings/playerPrefs';
import {
  DEFAULT_PLAYER_PREFS,
  isMouseBind,
  mouseButtonCode,
  parseMouseButton,
} from '../settings/playerPrefs';
import { resolveSkinUrl } from '../skins/loadSkins';

export type SessionKind = 'solo' | 'multiplayer';

function matchesBind(code: string, primary: string, secondary: string): boolean {
  return code === primary || (!!secondary && code === secondary);
}

function matchesKeyboardBind(code: string, primary: string, secondary: string): boolean {
  return matchesBind(code, primary, secondary) && !isMouseBind(code);
}

interface GameCanvasProps {
  engineRef: MutableRefObject<GameEngine | null>;
  gameStateRef: MutableRefObject<GameState | null>;
  currentPlayerRef: MutableRefObject<Player | undefined>;
  playerIdRef: MutableRefObject<string | null>;
  sessionKindRef: MutableRefObject<SessionKind>;
  /** Multiplayer: sample interpolated state every frame */
  mpRenderRef?: MutableRefObject<
    (() => { state: GameState; you: Player | undefined } | null) | null
  >;
  spectateTargetRef?: MutableRefObject<{ x: number; y: number } | null>;
  isSpectating: boolean;
  isPaused: boolean;
  /** When true, Space/W/Q/1/2/3 game keys are ignored (chat focused) */
  inputBlocked?: boolean;
  onMouseMove: (x: number, y: number) => void;
  onSplit: () => void;
  onEject: () => void;
  onFreeze?: () => void;
  onAddMass: () => void;
  onSpawnVirus?: (x: number, y: number) => void;
  onMinimapTeleport?: () => void;
  onResetStarter?: () => void;
  onForceMerge?: () => void;
  onKickAt?: (x: number, y: number) => void;
  onSpawnBot?: (x: number, y: number) => void;
  /** Admin hotkeys (1–6, Q) only when true — must be in-game as salruz */
  adminKeysEnabled?: boolean;
  /** Gameplay keys (Space split) only when actively playing */
  gameplayKeysEnabled?: boolean;
  onSpectateMove?: (x: number, y: number) => void;
  onPerfSample?: (fps: number) => void;
  config: GameplayConfig;
  skinUrl?: string | null;
  prefs?: PlayerPrefs;
  frozen?: boolean;
  /** Player ids owned by local session (multibox) */
  ownedIdsRef?: MutableRefObject<string[]>;
  onMultibox?: () => void;
  onSendCoords?: () => void;
  /** Clicking the world dismisses chat compose mode. */
  onWorldPointerDown?: () => void;
}

export function GameCanvas({
  engineRef,
  gameStateRef,
  currentPlayerRef,
  playerIdRef,
  sessionKindRef,
  mpRenderRef,
  spectateTargetRef,
  isSpectating,
  isPaused,
  inputBlocked = false,
  onMouseMove,
  onSplit,
  onEject,
  onFreeze,
  onAddMass,
  onSpawnVirus,
  onMinimapTeleport,
  onResetStarter,
  onForceMerge,
  onKickAt,
  onSpawnBot,
  adminKeysEnabled = false,
  gameplayKeysEnabled = false,
  onSpectateMove,
  onPerfSample,
  config,
  skinUrl = null,
  prefs = DEFAULT_PLAYER_PREFS,
  frozen = false,
  ownedIdsRef,
  onMultibox,
  onSendCoords,
  onWorldPointerDown,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef({
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    scale: 1,
    targetScale: 1,
    userZoom: 1,
  });
  /** The active owned player is allowed to change only on a multibox switch. */
  const cameraPlayerIdRef = useRef<string | null>(null);
  const mouseWorldRef = useRef({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 });
  /** Last mouse position in canvas pixels — recomputed to world every frame */
  const mouseScreenRef = useRef({ x: 0, y: 0, valid: false });
  const isSpectatingRef = useRef(isSpectating);
  const isPausedRef = useRef(isPaused);
  const inputBlockedRef = useRef(inputBlocked);
  // Keep in sync during render so spectate controls work the same frame mode flips
  isSpectatingRef.current = isSpectating;
  isPausedRef.current = isPaused;
  inputBlockedRef.current = inputBlocked;
  const onMouseMoveRef = useRef(onMouseMove);
  const onSpectateMoveRef = useRef(onSpectateMove);
  const onSpawnVirusRef = useRef(onSpawnVirus);
  const onMinimapTeleportRef = useRef(onMinimapTeleport);
  const onResetStarterRef = useRef(onResetStarter);
  const onForceMergeRef = useRef(onForceMerge);
  const onKickAtRef = useRef(onKickAt);
  const onSpawnBotRef = useRef(onSpawnBot);
  const onFreezeRef = useRef(onFreeze);
  const adminKeysEnabledRef = useRef(adminKeysEnabled);
  const gameplayKeysEnabledRef = useRef(gameplayKeysEnabled);
  const onPerfSampleRef = useRef(onPerfSample);
  const configRef = useRef(config);
  const prefsRef = useRef(prefs);
  const skinUrlRef = useRef(skinUrl);
  const skinImageRef = useRef<HTMLImageElement | null>(null);
  /** Cache remote skins by id for other players */
  const skinCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const onMultiboxRef = useRef(onMultibox);
  const onSendCoordsRef = useRef(onSendCoords);
  const onEjectRef = useRef(onEject);
  const lastSpectateDragRef = useRef<{ x: number; y: number } | null>(null);
  const cellVisualsRef = useRef(
    new Map<
      string,
      { x: number; y: number; r: number; color: string; name: string; isCurrentPlayer: boolean; isBot: boolean; lastSeen: number }
    >()
  );
  // Stable id->hash for deterministic z-order tie-breaking (prevents virus "flicker" when radii match)
  const idHashRef = useRef<Map<string, number>>(new Map());
  const ejectHeldKeysRef = useRef<Set<string>>(new Set());
  const lastEjectAtRef = useRef(0);
  /** Held mouse button for eject bind (null = none); LMB default uses lmbDownRef */
  const ejectMouseBtnRef = useRef<number | null>(null);
  const lmbDownRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const pinchDistanceRef = useRef<number | null>(null);
  const [touchControls] = useState(
    () => typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
  );

  useEffect(() => {
    onMouseMoveRef.current = onMouseMove;
  }, [onMouseMove]);

  useEffect(() => {
    onSpectateMoveRef.current = onSpectateMove;
  }, [onSpectateMove]);

  useEffect(() => {
    onSpawnVirusRef.current = onSpawnVirus;
  }, [onSpawnVirus]);

  useEffect(() => {
    onMinimapTeleportRef.current = onMinimapTeleport;
  }, [onMinimapTeleport]);

  useEffect(() => {
    onResetStarterRef.current = onResetStarter;
  }, [onResetStarter]);

  useEffect(() => {
    onForceMergeRef.current = onForceMerge;
  }, [onForceMerge]);

  useEffect(() => {
    onKickAtRef.current = onKickAt;
  }, [onKickAt]);

  useEffect(() => {
    onSpawnBotRef.current = onSpawnBot;
  }, [onSpawnBot]);

  useEffect(() => {
    onFreezeRef.current = onFreeze;
  }, [onFreeze]);

  useEffect(() => {
    adminKeysEnabledRef.current = adminKeysEnabled;
  }, [adminKeysEnabled]);

  useEffect(() => {
    gameplayKeysEnabledRef.current = gameplayKeysEnabled;
  }, [gameplayKeysEnabled]);

  useEffect(() => {
    onPerfSampleRef.current = onPerfSample;
  }, [onPerfSample]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    skinUrlRef.current = skinUrl;
    if (!skinUrl || prefs.disableSkins) {
      skinImageRef.current = null;
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = skinUrl;
    skinImageRef.current = img;
  }, [skinUrl, prefs.disableSkins]);

  useEffect(() => {
    onMultiboxRef.current = onMultibox;
    onSendCoordsRef.current = onSendCoords;
  }, [onMultibox, onSendCoords]);

  useEffect(() => {
    onEjectRef.current = onEject;
  }, [onEject]);

  // Leaving spectate: reset wheel zoom so gameplay isn't stuck at ultra-zoom
  useEffect(() => {
    if (!isSpectating) {
      cameraRef.current.userZoom = 1;
    }
  }, [isSpectating]);

  // Spectate: track mouse on window so view pans even after death / UI clicks
  useEffect(() => {
    if (!isSpectating) {
      lastSpectateDragRef.current = null;
      return;
    }

    if (spectateTargetRef && !spectateTargetRef.current) {
      spectateTargetRef.current = { x: cameraRef.current.x, y: cameraRef.current.y };
    }
    lastSpectateDragRef.current = null;

    // Always re-seed mouse so pan works immediately after death → spectate
    const canvas = canvasRef.current;
    if (canvas) {
      mouseScreenRef.current = {
        x: canvas.width / 2,
        y: canvas.height / 2,
        valid: true,
      };
    }

    const toCanvasPos = (clientX: number, clientY: number) => {
      const c = canvasRef.current;
      if (!c) return null;
      const rect = c.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const onMove = (e: MouseEvent) => {
      const pos = toCanvasPos(e.clientX, e.clientY);
      if (!pos) return;
      mouseScreenRef.current = { x: pos.x, y: pos.y, valid: true };

      if ((e.buttons & 1) === 1) {
        const cam = cameraRef.current;
        const prev = lastSpectateDragRef.current;
        if (prev) {
          const dx = pos.x - prev.x;
          const dy = pos.y - prev.y;
          const st = spectateTargetRef?.current ?? { x: cam.x, y: cam.y };
          st.x -= dx / Math.max(cam.scale, 0.001);
          st.y -= dy / Math.max(cam.scale, 0.001);
          if (spectateTargetRef) spectateTargetRef.current = st;
        }
        lastSpectateDragRef.current = { x: pos.x, y: pos.y };
      } else {
        lastSpectateDragRef.current = null;
      }
    };

    const onUp = () => {
      lastSpectateDragRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      lastSpectateDragRef.current = null;
    };
  }, [isSpectating, spectateTargetRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId = 0;
    let fpsFrames = 0;
    let fpsLastAt = performance.now();

    const computeAutoZoom = (
      player: Player,
      width: number,
      height: number,
      useVisualRadius = true
    ): number => {
      let sumR = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (const cell of player.cells) {
        const r = useVisualRadius && cell.visualRadius > 0 ? cell.visualRadius : cell.radius;
        sumR += r;
        minX = Math.min(minX, cell.x - r);
        maxX = Math.max(maxX, cell.x + r);
        minY = Math.min(minY, cell.y - r);
        maxY = Math.max(maxY, cell.y + r);
      }

      const sizeScale = Math.pow(configRef.current.cameraZoomRef / Math.max(sumR, 1), configRef.current.cameraZoomPower);
      const pad = 120;
      const bboxW = Math.max(1, maxX - minX + pad);
      const bboxH = Math.max(1, maxY - minY + pad);
      const fitScale = Math.min(width / bboxW, height / bboxH) * 0.85;
      const auto = Math.min(sizeScale, fitScale);
      return Math.max(0.15, Math.min(1.5, auto));
    };

    const draw = (gameState: GameState, currentPlayer: Player | undefined) => {
      const width = canvas.width;
      const height = canvas.height;
      const spectating = isSpectatingRef.current;
      const worldW = gameState.worldWidth || WORLD_WIDTH;
      const worldH = gameState.worldHeight || WORLD_HEIGHT;
      const cfg = configRef.current;

      let targetX = worldW / 2;
      let targetY = worldH / 2;

      if (spectating) {
        if (spectateTargetRef && !spectateTargetRef.current) {
          spectateTargetRef.current = { x: cameraRef.current.x, y: cameraRef.current.y };
        }
        const st = spectateTargetRef?.current;
        if (st) {
          // Move view with mouse like playing: camera follows cursor direction from screen center.
          if (mouseScreenRef.current.valid && !lastSpectateDragRef.current) {
            const dx = mouseScreenRef.current.x - width / 2;
            const dy = mouseScreenRef.current.y - height / 2;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const dead = Math.min(width, height) * 0.06;
            if (dist > dead) {
              const edge = Math.max(1, Math.min(width, height) * 0.42);
              const strength = Math.min(1, (dist - dead) / Math.max(1, edge - dead));
              const step = Math.max(8, cfg.spectatePanSpeed) * strength;
              st.x += (dx / dist) * step;
              st.y += (dy / dist) * step;
            }
          }

          const scaled = cfg.cameraBaseScale * cameraRef.current.userZoom;
          cameraRef.current.targetScale = scaled;
          // Spectate: free pan past map edges (no world clamp)
          targetX = st.x;
          targetY = st.y;
        } else {
          cameraRef.current.targetScale = cfg.cameraBaseScale * cameraRef.current.userZoom;
        }
      } else if (currentPlayer && currentPlayer.cells.length > 0) {
        const center = getPlayerCenter(currentPlayer);
        targetX = center.x;
        targetY = center.y;
        const auto = computeAutoZoom(currentPlayer, width, height);
        cameraRef.current.targetScale = auto * cameraRef.current.userZoom;
        // Switching multibox ownership is a hard camera cut. Position updates for
        // the same player remain smooth below. Use physical radii here, not their
        // visual growth/shrink interpolation, so a small↔large switch cannot
        // inherit a zoom animation from the previously rendered cell.
        if (cameraPlayerIdRef.current !== currentPlayer.id) {
          cameraPlayerIdRef.current = currentPlayer.id;
          cameraRef.current.targetScale =
            computeAutoZoom(currentPlayer, width, height, false) * cameraRef.current.userZoom;
          cameraRef.current.x = targetX;
          cameraRef.current.y = targetY;
          cameraRef.current.scale = cameraRef.current.targetScale;
        }
      } else {
        cameraPlayerIdRef.current = null;
      }

      // Smooth camera — snappier while spectating so mouse look feels immediate
      const follow = spectating ? 0.45 : 0.18;
      cameraRef.current.x += (targetX - cameraRef.current.x) * follow;
      cameraRef.current.y += (targetY - cameraRef.current.y) * follow;
      cameraRef.current.scale += (cameraRef.current.targetScale - cameraRef.current.scale) * 0.05;

      // Gameplay may look past walls; spectate also unrestricted (no clamp)
      const camera = cameraRef.current;

      const viewHalfW = width / camera.scale / 2;
      const viewHalfH = height / camera.scale / 2;
      const viewLeft = camera.x - viewHalfW;
      const viewRight = camera.x + viewHalfW;
      const viewTop = camera.y - viewHalfH;
      const viewBottom = camera.y + viewHalfH;

      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(camera.scale, camera.scale);
      ctx.translate(-camera.x, -camera.y);

      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1;
      const gridSize = camera.scale < 0.5 ? 100 : 50;
      const startX = Math.floor(viewLeft / gridSize) * gridSize;
      const startY = Math.floor(viewTop / gridSize) * gridSize;

      for (let x = startX; x < viewRight; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, Math.max(0, startY));
        ctx.lineTo(x, Math.min(gameState.worldHeight, viewBottom));
        ctx.stroke();
      }
      for (let y = startY; y < viewBottom; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(Math.max(0, startX), y);
        ctx.lineTo(Math.min(gameState.worldWidth, viewRight), y);
        ctx.stroke();
      }

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 10;
      ctx.strokeRect(0, 0, gameState.worldWidth, gameState.worldHeight);

      const viewerCenter =
        !spectating && currentPlayer && currentPlayer.cells.length > 0
          ? getPlayerCenter(currentPlayer)
          : { x: camera.x, y: camera.y };
      const viewMult = spectating ? cfg.spectateViewRadiusMult : cfg.playViewRadiusMult;
      const viewR = getEntityViewRadius(worldW, worldH, viewMult);
      const inView = (x: number, y: number) =>
        isWithinViewRadius(x, y, viewerCenter.x, viewerCenter.y, viewR);
      const entityInView = (x: number, y: number, r: number) =>
        isEntityNearView(x, y, r, viewerCenter.x, viewerCenter.y, viewR);

      const pad = 50;
      // Use the entities' normal world radii instead of cosmetic screen-space
      // dots, so food density and scale match the classic renderer.
      for (const food of gameState.food) {
        if (!inView(food.x, food.y)) continue;
        if (
          food.x < viewLeft - pad ||
          food.x > viewRight + pad ||
          food.y < viewTop - pad ||
          food.y > viewBottom + pad
        ) {
          continue;
        }
        ctx.beginPath();
        ctx.arc(food.x, food.y, food.radius, 0, Math.PI * 2);
        ctx.fillStyle = food.color;
        ctx.fill();
      }

      // W uses its normal game radius too; snapshot selection already limits
      // this to real nearby ejects rather than cosmetic filler.
      for (const mass of gameState.ejectedMass) {
        if (!inView(mass.x, mass.y)) continue;
        if (
          mass.x < viewLeft - pad ||
          mass.x > viewRight + pad ||
          mass.y < viewTop - pad ||
          mass.y > viewBottom + pad
        ) {
          continue;
        }
        ctx.beginPath();
        ctx.arc(mass.x, mass.y, mass.radius, 0, Math.PI * 2);
        ctx.fillStyle = mass.color;
        ctx.fill();
      }

      // Draw cells + viruses sorted by radius (smaller first).
      // Virus sits on top of smaller player cells; larger cells cover viruses.
      type DrawItem =
        | {
            kind: 'cell';
            x: number;
            y: number;
            r: number;
            cell: (typeof gameState.players)[0]['cells'][0];
            playerName: string;
            isCurrentPlayer: boolean;
            isBot: boolean;
            skinId?: string;
          }
        | {
            kind: 'virus';
            x: number;
            y: number;
            r: number;
            virus: (typeof gameState.viruses)[0];
          };

      const drawItems: DrawItem[] = [];
      const cullPad = 80;
      const nowPerf = performance.now();
      const seenCellIds = new Set<string>();
      const prefs = prefsRef.current;
      let visibleCellCount = 0;
      const owned = ownedIdsRef?.current;
      const ownedSet =
        owned && owned.length > 0
          ? new Set(owned)
          : currentPlayer
            ? new Set([currentPlayer.id])
            : null;

      for (const player of gameState.players) {
        const isMe = !!(ownedSet?.has(player.id) || currentPlayer?.id === player.id);
        for (const cell of player.cells) {
          const approxR = cell.visualRadius > 0 ? cell.visualRadius : cell.radius;
          // Cheap screen+FOV cull BEFORE expensive visual lerp / map writes
          if (!isMe && !entityInView(cell.x, cell.y, approxR)) {
            cellVisualsRef.current.delete(cell.id);
            continue;
          }
          if (
            cell.x < viewLeft - approxR - cullPad ||
            cell.x > viewRight + approxR + cullPad ||
            cell.y < viewTop - approxR - cullPad ||
            cell.y > viewBottom + approxR + cullPad
          ) {
            cellVisualsRef.current.delete(cell.id);
            continue;
          }

          if (sessionKindRef.current === 'multiplayer') {
            const lerp =
              cell.visualRadius < cell.radius
                ? configRef.current.visualGrowLerp
                : configRef.current.visualShrinkLerp;
            cell.visualRadius += (cell.radius - cell.visualRadius) * lerp;
          }
          const targetR = cell.visualRadius > 0 ? cell.visualRadius : cell.radius;
          const visual = cellVisualsRef.current.get(cell.id) ?? {
            x: cell.x,
            y: cell.y,
            r: targetR,
            color: cell.color,
            name: player.name,
            isCurrentPlayer: isMe,
            isBot: !!player.isBot,
            lastSeen: nowPerf,
          };
          const posLerp = sessionKindRef.current === 'multiplayer' ? 0.35 : 0.28;
          const radiusLerp = sessionKindRef.current === 'multiplayer' ? 0.2 : 0.16;
          visual.x += (cell.x - visual.x) * posLerp;
          visual.y += (cell.y - visual.y) * posLerp;
          visual.r += (targetR - visual.r) * radiusLerp;
          visual.color = cell.color;
          visual.name = player.name;
          visual.isCurrentPlayer = isMe;
          visual.isBot = !!player.isBot;
          visual.lastSeen = nowPerf;
          cellVisualsRef.current.set(cell.id, visual);
          seenCellIds.add(cell.id);

          const r = visual.r > 0 ? visual.r : targetR;
          visibleCellCount++;
          drawItems.push({
            kind: 'cell',
            x: visual.x,
            y: visual.y,
            r,
            cell,
            playerName: visual.name,
            isCurrentPlayer: isMe,
            isBot: visual.isBot,
            skinId: player.skin,
          });
        }
      }

      for (const cellId of cellVisualsRef.current.keys()) {
        if (!seenCellIds.has(cellId)) cellVisualsRef.current.delete(cellId);
      }

      for (const virus of gameState.viruses) {
        const r = virus.radius;
        if (!entityInView(virus.x, virus.y, r)) continue;
        if (
          virus.x < viewLeft - r - cullPad ||
          virus.x > viewRight + r + cullPad ||
          virus.y < viewTop - r - cullPad ||
          virus.y > viewBottom + r + cullPad
        ) {
          continue;
        }
        drawItems.push({
          kind: 'virus',
          x: virus.x,
          y: virus.y,
          r,
          virus,
        });
      }

      const getHash = (id: string): number => {
        const cached = idHashRef.current.get(id);
        if (cached !== undefined) return cached;
        let h = 0;
        const n = Math.min(10, id.length);
        for (let i = 0; i < n; i++) {
          h = (h * 33 + id.charCodeAt(i)) | 0;
        }
        idHashRef.current.set(id, h);
        return h;
      };

      drawItems.sort((a, b) => {
        const dr = a.r - b.r;
        if (dr !== 0) return dr;

        const kindA = a.kind === 'virus' ? 1 : 0;
        const kindB = b.kind === 'virus' ? 1 : 0;
        if (kindA !== kindB) return kindA - kindB;

        const idA = a.kind === 'virus' ? a.virus.id : a.cell.id;
        const idB = b.kind === 'virus' ? b.virus.id : b.cell.id;
        return getHash(idA) - getHash(idB);
      });

      const heavyScene = visibleCellCount > 40;
      // Skins stay on whenever enabled — never thrash with cell-count thresholds.
      const allowSkins = !prefs.disableSkins;
      const getSkinImage = (skinId: string | undefined, isLocalOwned: boolean): HTMLImageElement | null => {
        if (!allowSkins) return null;
        if (isLocalOwned && skinImageRef.current) {
          const img = skinImageRef.current;
          if (img.complete && img.naturalWidth > 0) return img;
        }
        if (!skinId) return null;
        let img = skinCacheRef.current.get(skinId);
        if (!img) {
          const url = resolveSkinUrl(skinId);
          if (!url) return null;
          img = new Image();
          img.decoding = 'async';
          img.src = url;
          skinCacheRef.current.set(skinId, img);
        }
        return img.complete && img.naturalWidth > 0 ? img : null;
      };

      for (const item of drawItems) {
        if (item.kind === 'virus') {
          const { virus } = item;
          const colors = getVirusColor(virus.charge);
          ctx.fillStyle = colors.fill;
          ctx.strokeStyle = colors.stroke;
          ctx.lineWidth = 3;
          // Classic spiky virus — only drawn for culled-visible set
          ctx.beginPath();
          const spikes = heavyScene ? 12 : 18;
          for (let i = 0; i < spikes * 2; i++) {
            const angle = (i / (spikes * 2)) * Math.PI * 2;
            const rr = i % 2 === 0 ? virus.radius : virus.radius * 0.85;
            const x = virus.x + Math.cos(angle) * rr;
            const y = virus.y + Math.sin(angle) * rr;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          continue;
        }

        const { cell, playerName, isCurrentPlayer, x, y, r, skinId } = item;

        // Always paint base color first so skin load / clip never flickers to empty.
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = cell.color;
        ctx.fill();

        // Under a split-heavy crowd, clipping/drawing every remote skin costs
        // more than the circles themselves. Keep the local skin and restore all
        // remote skins as soon as the scene is lighter.
        const skinImg = (!heavyScene || isCurrentPlayer) ? getSkinImage(skinId, isCurrentPlayer) : null;
        if (skinImg && r > 8) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(skinImg, x - r, y - r, r * 2, r * 2);
          ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = isCurrentPlayer ? '#ffffff' : 'rgba(0,0,0,0.3)';
        ctx.lineWidth = isCurrentPlayer ? 3 : 1.5;
        ctx.stroke();

        // Nickname centered in cell; mass sits under the name (not shared center)
        const textMinR = 8;
        if (r > textMinR && (!heavyScene || isCurrentPlayer || r >= 18)) {
          const showMass = prefs.showMass;
          const nameScale = Math.max(0.15, Math.min(0.55, cfg.nameScale || 0.28));
          const strokeFrac = Math.max(0, cfg.nameStrokeWidth ?? 0.02);
          let fontSize = r * nameScale;
          fontSize = Math.min(fontSize, r * 0.42);
          fontSize = Math.max(fontSize, Math.min(r * 0.22, 14 / Math.max(camera.scale, 0.001)));
          // Quantize font size to cut canvas font churn with many cells
          fontSize = Math.max(8, Math.round(fontSize));
          ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.fillStyle = '#ffffff';
          const strokeW = fontSize * strokeFrac;
          // Name stays at cell center; mass is drawn below it
          if (strokeW > 0.35) {
            ctx.strokeStyle = 'rgba(0,0,0,0.35)';
            ctx.lineWidth = strokeW;
            ctx.strokeText(playerName, x, y);
          }
          ctx.fillText(playerName, x, y);
          if (showMass && r > 14 && (!heavyScene || isCurrentPlayer || r >= 30)) {
            const mass = Math.floor(getMass(cell.radius));
            const massFont = Math.max(8, Math.round(fontSize * 0.72));
            const massY = y + fontSize * 0.72;
            ctx.font = `${massFont}px Arial, Helvetica, sans-serif`;
            if (strokeW > 0.35) {
              ctx.lineWidth = Math.max(0.5, massFont * strokeFrac);
              ctx.strokeText(String(mass), x, massY);
            }
            ctx.fillText(String(mass), x, massY);
          }
        }
      }

      ctx.restore();
    };

    const animate = () => {
      fpsFrames++;
      const nowPerf = performance.now();
      if (nowPerf - fpsLastAt >= 500) {
        onPerfSampleRef.current?.(Math.round((fpsFrames * 1000) / (nowPerf - fpsLastAt)));
        fpsFrames = 0;
        fpsLastAt = nowPerf;
      }
      // Keep aiming at the screen cursor even if the mouse isn't moving
      // (otherwise world target is fixed and the cell stops under it).
      // Aim continues while chat is open — inputBlocked only gates keys/clicks.
      if (
        !isSpectatingRef.current &&
        !isPausedRef.current &&
        mouseScreenRef.current.valid
      ) {
        const canvas = canvasRef.current;
        if (canvas) {
          const cam = cameraRef.current;
          const sx = mouseScreenRef.current.x;
          const sy = mouseScreenRef.current.y;
          const worldX = (sx - canvas.width / 2) / cam.scale + cam.x;
          const worldY = (sy - canvas.height / 2) / cam.scale + cam.y;
          mouseWorldRef.current = { x: worldX, y: worldY };
          onMouseMoveRef.current(worldX, worldY);
        }
      } else if (isSpectatingRef.current && spectateTargetRef?.current) {
        // Tell server our spectate FOV center (also works after death)
        const st = spectateTargetRef.current;
        onMouseMoveRef.current(st.x, st.y);
        onSpectateMoveRef.current?.(st.x, st.y);
      }

      // Poll held binds in the render loop instead of relying on OS key-repeat.
      // This gives keyboard eject the same immediate, steady cadence as held LMB.
      const ejectHeld =
        ejectHeldKeysRef.current.size > 0 ||
        lmbDownRef.current ||
        ejectMouseBtnRef.current !== null;
      if (
        ejectHeld &&
        gameplayKeysEnabledRef.current &&
        !isSpectatingRef.current &&
        !isPausedRef.current &&
        !inputBlockedRef.current &&
        nowPerf - lastEjectAtRef.current >= 100
      ) {
        lastEjectAtRef.current = nowPerf;
        onEjectRef.current();
      }

      // Solo: GameCanvas owns update + draw (no React setState per frame)
      if (
        sessionKindRef.current === 'solo' &&
        engineRef.current &&
        !isPausedRef.current
      ) {
        engineRef.current.update();
        const state = engineRef.current.getState();
        gameStateRef.current = state;
        if (playerIdRef.current) {
          currentPlayerRef.current = state.players.find((p) => p.id === playerIdRef.current);
        } else {
          currentPlayerRef.current = undefined;
        }
      } else if (sessionKindRef.current === 'multiplayer' && mpRenderRef?.current) {
        const sample = mpRenderRef.current();
        if (sample) {
          gameStateRef.current = sample.state;
          currentPlayerRef.current = sample.you;
        }
      }

      const state = gameStateRef.current;
      if (state) {
        draw(state, currentPlayerRef.current);
      }

      animationId = requestAnimationFrame(animate);
    };
    animationId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, [engineRef, gameStateRef, currentPlayerRef, playerIdRef, sessionKindRef, mpRenderRef]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      mouseScreenRef.current = { x: mouseX, y: mouseY, valid: true };

      if (isSpectatingRef.current) {
        const cam = cameraRef.current;
        // Drag-to-pan: move view by mouse delta (map grab)
        if ((e.buttons & 1) === 1) {
          const prev = lastSpectateDragRef.current;
          if (prev) {
            const dx = mouseX - prev.x;
            const dy = mouseY - prev.y;
            const st = spectateTargetRef?.current ?? { x: cam.x, y: cam.y };
            st.x -= dx / Math.max(cam.scale, 0.001);
            st.y -= dy / Math.max(cam.scale, 0.001);
            if (spectateTargetRef) spectateTargetRef.current = st;
            onSpectateMoveRef.current?.(st.x, st.y);
          }
          lastSpectateDragRef.current = { x: mouseX, y: mouseY };
        } else {
          lastSpectateDragRef.current = null;
        }
        return;
      }

      const camera = cameraRef.current;
      const worldX = (mouseX - canvas.width / 2) / camera.scale + camera.x;
      const worldY = (mouseY - canvas.height / 2) / camera.scale + camera.y;
      mouseWorldRef.current = { x: worldX, y: worldY };

      onMouseMove(worldX, worldY);
    },
    [onMouseMove, spectateTargetRef]
  );

  const handleWheel = useCallback((e: WheelEvent) => {
    // Don't steal wheel from settings / menus / other UI overlays
    if (inputBlockedRef.current) return;
    e.preventDefault();
    const zoomSpeed = 0.08;
    const factor = e.deltaY > 0 ? 1 - zoomSpeed : 1 + zoomSpeed;
    const cfg = configRef.current;
    // Spectate: very wide range (min ≈ unlimited zoom-out for huge cells; max ≈ unlimited zoom-in)
    const minZoom = isSpectatingRef.current ? cfg.spectateMinZoom : 0.4;
    const maxZoom = isSpectatingRef.current ? cfg.spectateMaxZoom : 2.2;
    cameraRef.current.userZoom = Math.max(minZoom, Math.min(maxZoom, cameraRef.current.userZoom * factor));
  }, []);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLCanvasElement>) => {
    if (inputBlockedRef.current || isSpectatingRef.current) return;
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      pinchDistanceRef.current = null;
    } else if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      pinchDistanceRef.current = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      touchStartRef.current = null;
    }
  }, []);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLCanvasElement>) => {
    if (inputBlockedRef.current || isSpectatingRef.current) return;
    event.preventDefault();
    if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const previous = pinchDistanceRef.current;
      if (previous && previous > 0) {
        const factor = Math.max(0.85, Math.min(1.15, distance / previous));
        cameraRef.current.userZoom = Math.max(0.4, Math.min(2.2, cameraRef.current.userZoom * factor));
      }
      pinchDistanceRef.current = distance;
      return;
    }
    const start = touchStartRef.current;
    const touch = event.touches[0];
    const player = currentPlayerRef.current;
    if (!start || !touch || !player?.cells.length) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 8) return;
    const center = getPlayerCenter(player);
    const reach = 3500;
    onMouseMoveRef.current(center.x + (dx / length) * reach, center.y + (dy / length) * reach);
  }, [currentPlayerRef]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (inputBlockedRef.current) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      const p = prefsRef.current;
      if (
        gameplayKeysEnabledRef.current &&
        matchesKeyboardBind(e.code, p.keySplit, p.keySplitSecondary)
      ) {
        e.preventDefault();
        onSplit();
        return;
      }

      if (
        gameplayKeysEnabledRef.current &&
        matchesKeyboardBind(e.code, p.keyEject, p.keyEjectSecondary)
      ) {
        e.preventDefault();
        const wasHeld = ejectHeldKeysRef.current.has(e.code);
        ejectHeldKeysRef.current.add(e.code);
        if (!wasHeld) {
          lastEjectAtRef.current = performance.now();
          onEject();
        }
        return;
      }

      if (
        gameplayKeysEnabledRef.current &&
        matchesKeyboardBind(e.code, p.keyFreeze, p.keyFreezeSecondary)
      ) {
        e.preventDefault();
        onFreezeRef.current?.();
        return;
      }

      if (
        gameplayKeysEnabledRef.current &&
        matchesKeyboardBind(e.code, p.keyMultibox, p.keyMultiboxSecondary)
      ) {
        e.preventDefault();
        onMultiboxRef.current?.();
        return;
      }

      if (
        gameplayKeysEnabledRef.current &&
        matchesKeyboardBind(e.code, p.keyCoords, p.keyCoordsSecondary)
      ) {
        e.preventDefault();
        onSendCoordsRef.current?.();
        return;
      }

      if (!adminKeysEnabledRef.current) return;

      if (e.code === 'KeyQ') {
        e.preventDefault();
        onAddMass();
      } else if (e.code === 'Digit1' || e.code === 'Numpad1') {
        e.preventDefault();
        onMinimapTeleportRef.current?.();
      } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
        e.preventDefault();
        onResetStarterRef.current?.();
      } else if (e.code === 'Digit3' || e.code === 'Numpad3') {
        e.preventDefault();
        const m = mouseWorldRef.current;
        onSpawnVirusRef.current?.(m.x, m.y);
      } else if (e.code === 'Digit4' || e.code === 'Numpad4') {
        e.preventDefault();
        onForceMergeRef.current?.();
      } else if (e.code === 'Digit5' || e.code === 'Numpad5') {
        e.preventDefault();
        const m = mouseWorldRef.current;
        onKickAtRef.current?.(m.x, m.y);
      } else if (e.code === 'Digit6' || e.code === 'Numpad6') {
        e.preventDefault();
        const m = mouseWorldRef.current;
        onSpawnBotRef.current?.(m.x, m.y);
      }
    },
    [onSplit, onEject, onAddMass]
  );

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    ejectHeldKeysRef.current.delete(e.code);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('wheel', handleWheel, { passive: false });
    const releaseHeldInputs = () => {
      ejectHeldKeysRef.current.clear();
      ejectMouseBtnRef.current = null;
      lmbDownRef.current = false;
    };
    window.addEventListener('blur', releaseHeldInputs);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('blur', releaseHeldInputs);
    };
  }, [handleKeyDown, handleKeyUp, handleWheel]);

  useEffect(() => {
    const up = (e: MouseEvent) => {
      if (e.button === 0) {
        lmbDownRef.current = false;
      }
      if (ejectMouseBtnRef.current !== null && e.button === ejectMouseBtnRef.current) {
        ejectMouseBtnRef.current = null;
      }
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // Prevent browser context menu when RMB is a gameplay bind
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      if (inputBlockedRef.current || isSpectatingRef.current || !gameplayKeysEnabledRef.current) {
        return;
      }
      const p = prefsRef.current;
      const usesRmb =
        [p.keySplit, p.keySplitSecondary, p.keyEject, p.keyEjectSecondary, p.keyFreeze, p.keyFreezeSecondary]
          .some((bind) => parseMouseButton(bind) === 2);
      if (usesRmb) {
        e.preventDefault();
      }
    };
    window.addEventListener('contextmenu', onCtx);
    return () => window.removeEventListener('contextmenu', onCtx);
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={(e) => {
          onWorldPointerDown?.();
          if (isSpectatingRef.current) {
            if (e.button !== 0) return;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            mouseScreenRef.current = { x: mx, y: my, valid: true };
            lastSpectateDragRef.current = { x: mx, y: my };
            const cam = cameraRef.current;
            const wx = (mx - canvas.width / 2) / cam.scale + cam.x;
            const wy = (my - canvas.height / 2) / cam.scale + cam.y;
            onSpectateMoveRef.current?.(wx, wy);
            return;
          }
          if (inputBlockedRef.current || !gameplayKeysEnabledRef.current) return;

          const p = prefsRef.current;
          const code = mouseButtonCode(e.button);

          if (matchesBind(code, p.keySplit, p.keySplitSecondary)) {
            e.preventDefault();
            onSplit();
            return;
          }
          if (matchesBind(code, p.keyFreeze, p.keyFreezeSecondary)) {
            e.preventDefault();
            onFreezeRef.current?.();
            return;
          }

          // Explicit mouse eject bind (including Mouse0)
          if (matchesBind(code, p.keyEject, p.keyEjectSecondary)) {
            e.preventDefault();
            ejectMouseBtnRef.current = e.button;
            if (e.button === 0) {
              lmbDownRef.current = true;
            }
            lastEjectAtRef.current = performance.now();
            onEject();
            return;
          }

          // Default LMB eject (always available unless LMB is bound to split/freeze)
          if (e.button === 0) {
            lmbDownRef.current = true;
            lastEjectAtRef.current = performance.now();
            onEject();
          }
        }}
        onMouseUp={() => {
          lastSpectateDragRef.current = null;
        }}
        onMouseLeave={() => {
          lmbDownRef.current = false;
          ejectMouseBtnRef.current = null;
          lastSpectateDragRef.current = null;
        }}
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => {
          touchStartRef.current = null;
          pinchDistanceRef.current = null;
        }}
        className="block cursor-crosshair touch-none"
      />
      {touchControls && gameplayKeysEnabled && !isSpectating && !inputBlocked && (
        <div className="absolute inset-x-0 bottom-5 z-30 flex items-end justify-between px-5 pointer-events-none">
          <div className="h-24 w-24 rounded-full border-2 border-white/30 bg-black/25" aria-label="Сенсорный джойстик" />
          <div className="flex gap-3 pointer-events-auto">
            <button type="button" onTouchStart={(e) => { e.preventDefault(); onSplit(); }} className="h-16 w-16 rounded-full border border-white/35 bg-blue-600/80 text-xs font-bold text-white active:bg-blue-500">ДЕЛ</button>
            <button type="button" onTouchStart={(e) => { e.preventDefault(); onEject(); }} className="h-16 w-16 rounded-full border border-white/35 bg-emerald-600/80 text-xs font-bold text-white active:bg-emerald-500">W</button>
          </div>
        </div>
      )}
      {frozen && !isSpectating && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20">
          <div className="text-white text-4xl font-bold tracking-wide drop-shadow-lg select-none">
            Остановлено
          </div>
        </div>
      )}
    </>
  );
}
