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
} from '../utils/gameUtils';
import type { GameplayConfig } from '../../shared/gameConfig';

export type SessionKind = 'solo' | 'multiplayer';

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
  onAddMass: () => void;
  onSpawnVirus?: (x: number, y: number) => void;
  onMinimapTeleport?: () => void;
  onResetStarter?: () => void;
  onSpectateMove?: (x: number, y: number) => void;
  onPerfSample?: (fps: number) => void;
  isWPressed: boolean;
  config: GameplayConfig;
  skinUrl?: string | null;
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
  onAddMass,
  onSpawnVirus,
  onMinimapTeleport,
  onResetStarter,
  onSpectateMove,
  onPerfSample,
  isWPressed,
  config,
  skinUrl = null,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef({
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    scale: 1,
    targetScale: 1,
    userZoom: 1,
  });
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
  const onPerfSampleRef = useRef(onPerfSample);
  const configRef = useRef(config);
  const skinUrlRef = useRef(skinUrl);
  const skinImageRef = useRef<HTMLImageElement | null>(null);
  const lastSpectateDragRef = useRef<{ x: number; y: number } | null>(null);
  const cellVisualsRef = useRef(
    new Map<
      string,
      { x: number; y: number; r: number; color: string; name: string; isCurrentPlayer: boolean; lastSeen: number }
    >()
  );
  // Stable id->hash for deterministic z-order tie-breaking (prevents virus "flicker" when radii match)
  const idHashRef = useRef<Map<string, number>>(new Map());

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
    onPerfSampleRef.current = onPerfSample;
  }, [onPerfSample]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    skinUrlRef.current = skinUrl;
    if (!skinUrl) {
      skinImageRef.current = null;
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = skinUrl;
    skinImageRef.current = img;
  }, [skinUrl]);

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

    // Seed mouse to canvas center so first pan works immediately after entering spectate
    const canvas = canvasRef.current;
    if (canvas && !mouseScreenRef.current.valid) {
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

    const computeAutoZoom = (player: Player, width: number, height: number): number => {
      let sumR = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (const cell of player.cells) {
        const r = cell.visualRadius > 0 ? cell.visualRadius : cell.radius;
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

    const clampCameraToWorld = (
      x: number,
      y: number,
      scale: number,
      width: number,
      height: number,
      worldW: number,
      worldH: number
    ) => {
      const halfW = width / Math.max(scale, 0.001) / 2;
      const halfH = height / Math.max(scale, 0.001) / 2;
      let cx = x;
      let cy = y;
      if (worldW <= halfW * 2) cx = worldW / 2;
      else cx = Math.max(halfW, Math.min(worldW - halfW, cx));
      if (worldH <= halfH * 2) cy = worldH / 2;
      else cy = Math.max(halfH, Math.min(worldH - halfH, cy));
      return { x: cx, y: cy };
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
          const clampedTarget = clampCameraToWorld(st.x, st.y, scaled, width, height, worldW, worldH);
          st.x = clampedTarget.x;
          st.y = clampedTarget.y;
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
      }

      // Smooth camera — snappier while spectating so mouse look feels immediate
      const follow = spectating ? 0.45 : 0.18;
      cameraRef.current.x += (targetX - cameraRef.current.x) * follow;
      cameraRef.current.y += (targetY - cameraRef.current.y) * follow;
      cameraRef.current.scale += (cameraRef.current.targetScale - cameraRef.current.scale) * 0.05;

      // Clamp view to map ONLY while spectating (gameplay can look past walls)
      if (spectating) {
        const clampedCam = clampCameraToWorld(
          cameraRef.current.x,
          cameraRef.current.y,
          cameraRef.current.scale,
          width,
          height,
          worldW,
          worldH
        );
        cameraRef.current.x = clampedCam.x;
        cameraRef.current.y = clampedCam.y;
      }
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
      const viewR = getEntityViewRadius(worldW, worldH);
      const inView = (x: number, y: number) =>
        isWithinViewRadius(x, y, viewerCenter.x, viewerCenter.y, viewR);

      const pad = 50;
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
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
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

      for (const player of gameState.players) {
        const isMe = currentPlayer?.id === player.id;
        for (const cell of player.cells) {
          // Smooth visual stretch (moderate lerp — keeps FPS)
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
          visual.lastSeen = nowPerf;
          cellVisualsRef.current.set(cell.id, visual);
          seenCellIds.add(cell.id);

          const r = visual.r > 0 ? visual.r : targetR;
          if (!isMe && !inView(visual.x, visual.y)) continue;
          if (
            visual.x < viewLeft - r - cullPad ||
            visual.x > viewRight + r + cullPad ||
            visual.y < viewTop - r - cullPad ||
            visual.y > viewBottom + r + cullPad
          ) {
            continue;
          }
          drawItems.push({
            kind: 'cell',
            x: visual.x,
            y: visual.y,
            r,
            cell,
            playerName: visual.name,
            isCurrentPlayer: isMe,
          });
        }
      }

      for (const cellId of cellVisualsRef.current.keys()) {
        if (!seenCellIds.has(cellId)) cellVisualsRef.current.delete(cellId);
      }

      for (const virus of gameState.viruses) {
        const r = virus.radius;
        if (!inView(virus.x, virus.y)) continue;
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

      for (const item of drawItems) {
        if (item.kind === 'virus') {
          const { virus } = item;
          const colors = getVirusColor(virus.charge);
          ctx.fillStyle = colors.fill;
          ctx.strokeStyle = colors.stroke;
          ctx.lineWidth = 3;
          // Classic spiky virus (ИСХОДНИК) — only drawn for culled-visible set
          ctx.beginPath();
          const spikes = 18;
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

        const { cell, playerName, isCurrentPlayer, x, y, r } = item;

        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        const skinImg = isCurrentPlayer ? skinImageRef.current : null;
        if (skinImg && skinImg.complete && skinImg.naturalWidth > 0) {
          ctx.drawImage(skinImg, x - r, y - r, r * 2, r * 2);
        } else {
          ctx.fillStyle = cell.color;
          ctx.fill();
        }
        ctx.restore();

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = isCurrentPlayer ? '#ffffff' : 'rgba(0,0,0,0.3)';
        ctx.lineWidth = isCurrentPlayer ? 4 : 2;
        ctx.stroke();

        if (r > 16) {
          const fontSize = Math.max(12, r * 0.38);
          ctx.font = `bold ${fontSize}px Arial`;
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.strokeStyle = 'rgba(0,0,0,0.45)';
          ctx.lineWidth = 3;
          ctx.strokeText(playerName, x, y);
          ctx.fillText(playerName, x, y);
          if (r > 32) {
            const mass = Math.floor(getMass(cell.radius));
            const massFont = fontSize * 0.55;
            ctx.font = `${massFont}px Arial`;
            ctx.strokeText(String(mass), x, y + fontSize * 0.75);
            ctx.fillText(String(mass), x, y + fontSize * 0.75);
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
      if (
        !isSpectatingRef.current &&
        !inputBlockedRef.current &&
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
    e.preventDefault();
    const zoomSpeed = 0.08;
    const factor = e.deltaY > 0 ? 1 - zoomSpeed : 1 + zoomSpeed;
    const cfg = configRef.current;
    const minZoom = isSpectatingRef.current ? cfg.spectateMinZoom : 0.4;
    const maxZoom = isSpectatingRef.current ? cfg.spectateMaxZoom : 2.2;
    cameraRef.current.userZoom = Math.max(minZoom, Math.min(maxZoom, cameraRef.current.userZoom * factor));
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (inputBlockedRef.current) return;
      if (e.code === 'Space') {
        e.preventDefault();
        onSplit();
      } else if (e.code === 'KeyQ') {
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
      }
    },
    [onSplit, onAddMass]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [handleKeyDown, handleWheel]);

  const [lmbDown, setLmbDown] = useState(false);
  const lmbDownRef = useRef(false);

  useEffect(() => {
    const up = () => {
      lmbDownRef.current = false;
      setLmbDown(false);
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  useEffect(() => {
    if (isSpectating || inputBlocked) return;
    if (!isWPressed && !lmbDown) return;

    onEject();

    const interval = setInterval(() => {
      if (isWPressed || lmbDownRef.current) onEject();
    }, 100);

    return () => clearInterval(interval);
  }, [isWPressed, lmbDown, onEject, isSpectating, inputBlocked]);

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        if (isSpectatingRef.current) {
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
        if (inputBlockedRef.current) return;
        lmbDownRef.current = true;
        setLmbDown(true);
        onEject();
      }}
      onMouseUp={() => {
        lastSpectateDragRef.current = null;
      }}
      onMouseLeave={() => {
        lmbDownRef.current = false;
        setLmbDown(false);
        lastSpectateDragRef.current = null;
      }}
      className="block cursor-crosshair"
    />
  );
}
