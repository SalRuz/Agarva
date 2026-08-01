import { ADMIN_MASS_BOOST } from './constants';

export interface GameplayConfig {
  worldWidth: number;
  worldHeight: number;
  /** Solo Fight map edge length (square). Classic physics; SF uses this for world size. */
  soloFightWorldSize: number;
  initialMass: number;
  minSplitMass: number;
  maxCellsPerPlayer: number;
  maxCellMass: number;
  speedCoeff: number;
  speedExponent: number;
  speedSmallBoost: number;
  speedMin: number;
  speedProgressionSoften: number;
  speedGlobalMult: number;
  moveLerp: number;
  boostSteer: number;
  moveStopBase: number;
  moveStopRadiusFrac: number;
  splitBoost: number;
  /** Global launch sharpness (1 = default; >1 sharper/faster start, <1 softer) */
  splitLaunchSharpness: number;
  /** Sharpness bias for smaller split pieces (multiplies global) */
  splitLaunchSharpnessSmall: number;
  /** Sharpness bias for larger split pieces (multiplies global) */
  splitLaunchSharpnessLarge: number;
  /**
   * 1 = a cursor held at the player center keeps one stable split direction,
   * creating the classic in-place split chain. 0 = legacy per-cell targeting.
   */
  centerCursorSplitChainEnabled: number;
  /** 1 = split pieces keep the parent launch velocity; 0 = launch impulse only. */
  splitInheritVelocityEnabled: number;
  /**
   * Nick font size as a fraction of cell radius (e.g. 0.38).
   * Clamped per-draw so names stay readable without filling the ball.
   */
  nameScale: number;
  /** Outline thickness relative to font size (e.g. 0.08 = thin). */
  nameStrokeWidth: number;
  splitFriction: number;
  splitSpawnOffset: number;
  boostPassMult: number;
  mergeBaseMs: number;
  mergeMassFactor: number;
  mergeCoverage: number;
  eatMassMult: number;
  eatCoverage: number;
  separationStiffness: number;
  separationIterations: number;
  foodMass: number;
  foodCountSolo: number;
  foodCountMp: number;
  foodRespawnThreshold: number;
  foodRespawnBatch: number;
  foodViewRadius: number;
  foodViewPerSumRadius: number;
  foodViewPerMaxRadius: number;
  foodViewMax: number;
  foodNetMax: number;
  virusMass: number;
  virusBonusMass: number;
  virusMinEatMass: number;
  virusMaxCharge: number;
  virusCount: number;
  virusPopSpeed: number;
  /** Extra launch sharpness for smaller virus-pop fragments (multiplies virusPopSpeed) */
  virusPopSharpnessSmall: number;
  /** Extra launch sharpness for larger virus-pop fragments */
  virusPopSharpnessLarge: number;
  /** Spawn/spread distance mult for smaller virus-pop fragments */
  virusPopRangeSmall: number;
  /** Spawn/spread distance mult for larger virus-pop fragments */
  virusPopRangeLarge: number;
  virusSplitSpeed: number;
  virusFriction: number;
  virusEjectCoverage: number;
  /** Coverage fraction required for a player cell to absorb/pop a virus */
  virusAbsorbCoverage: number;
  /** 1 = flying virus bounces off ejected mass (W); 0 = W ignored while flying */
  virusBounceFromEject: number;
  ejectLoss: number;
  ejectGain: number;
  ejectPickupMinMass: number;
  ejectPickupCoverage: number;
  ejectSpeed: number;
  ejectMinMass: number;
  ejectCooldown: number;
  ejectGracePeriod: number;
  ejectFriction: number;
  ejectMaxCount: number;
  ejectNetMax: number;
  massDecayPerSec: number;
  massDecayMin: number;
  botAiIntervalMs: number;
  botCountSolo: number;
  botCountMp: number;
  serverTickHz: number;
  adminMassBoost: number;
  visualGrowLerp: number;
  visualShrinkLerp: number;
  cameraZoomRef: number;
  cameraZoomPower: number;
  cameraBaseScale: number;
  /** Spectate: world units/frame toward mouse at screen edge */
  spectatePanSpeed: number;
  spectateMinZoom: number;
  spectateMaxZoom: number;
  /** Multiplier on sector-based entity FOV while playing (cells/viruses sync+draw) */
  playViewRadiusMult: number;
  /** Multiplier on sector-based entity FOV while spectating */
  spectateViewRadiusMult: number;
  /**
   * 1 = on: smaller own cells can gradually squeeze through gaps between larger
   * own cells (gentle parting). 0 = hard solid separation only.
   */
  squeezeThroughEnabled: number;
  /** 1 = on, 0 = off — auto-split when player mass exceeds threshold */
  autoSplitEnabled: number;
  autoSplitMassThreshold: number;
  /**
   * 1 = on: when the cursor is on/near an own cell, that piece creeps slower
   * toward the cursor (stealth). 0 = off.
   */
  cursorSlowdownEnabled: number;
  /** Speed multiplier while cursor is near the cell center (0–1, e.g. 0.55). */
  cursorSlowdownFactor: number;
  /** Distance in cell radii within which slowdown applies (e.g. 1.05 = just past edge). */
  cursorSlowdownRadiusMult: number;
}

/** Spawn mass for Solo Fight duelists only — not used in physics config. */
export const SOLO_FIGHT_START_MASS = 5000;

export const defaultGameplayConfig: GameplayConfig = {
  worldWidth: 20000,
  worldHeight: 20000,
  soloFightWorldSize: 10000,
  initialMass: 15,
  minSplitMass: 40,
  maxCellsPerPlayer: 16,
  maxCellMass: 22500,
  speedCoeff: 8.5,
  speedExponent: 0.439,
  speedSmallBoost: 2,
  speedMin: 0.55,
  speedProgressionSoften: 10,
  speedGlobalMult: 2.5,
  moveLerp: 0.5,
  boostSteer: 0.025,
  moveStopBase: 10,
  moveStopRadiusFrac: 0.06,
  splitBoost: 57,
  splitLaunchSharpness: 1,
  splitLaunchSharpnessSmall: 1,
  splitLaunchSharpnessLarge: 2.5,
  centerCursorSplitChainEnabled: 1,
  splitInheritVelocityEnabled: 0,
  nameScale: 0.28,
  nameStrokeWidth: 0.02,
  splitFriction: 0.93,
  splitSpawnOffset: 1.15,
  boostPassMult: 1.25,
  mergeBaseMs: 30000,
  mergeMassFactor: 20,
  mergeCoverage: 0.7,
  eatMassMult: 1.2666666666666666,
  eatCoverage: 0.7,
  separationStiffness: 1,
  separationIterations: 1,
  foodMass: 5,
  foodCountSolo: 1800,
  foodCountMp: 5400,
  foodRespawnThreshold: 1000,
  foodRespawnBatch: 60,
  foodViewRadius: 1600,
  foodViewPerSumRadius: 5.5,
  foodViewPerMaxRadius: 4,
  foodViewMax: 9000,
  // Capped snapshots: enough density to navigate, without sending hundreds of
  // repeated JSON food records on every remote state update.
  foodNetMax: 75,
  virusMass: 130,
  virusBonusMass: 100,
  virusMinEatMass: 130,
  virusMaxCharge: 7,
  virusCount: 64,
  virusPopSpeed: 15,
  virusPopSharpnessSmall: 1,
  virusPopSharpnessLarge: 100,
  virusPopRangeSmall: 1,
  virusPopRangeLarge: 300,
  virusSplitSpeed: 25,
  virusFriction: 0.956,
  virusEjectCoverage: 0.7,
  virusAbsorbCoverage: 0.6,
  virusBounceFromEject: 1,
  ejectLoss: 16,
  ejectGain: 15,
  ejectPickupMinMass: 1,
  ejectPickupCoverage: 0.7,
  ejectSpeed: 28,
  ejectMinMass: 30,
  ejectCooldown: 53,
  ejectGracePeriod: 200,
  ejectFriction: 0.945,
  ejectMaxCount: 3000,
  ejectNetMax: 200,
  massDecayPerSec: 0.002,
  massDecayMin: 50,
  botAiIntervalMs: 250,
  botCountSolo: 16,
  botCountMp: 20,
  serverTickHz: 30,
  /** Admin-only setting — kept from project defaults, not overridden by shared presets */
  adminMassBoost: ADMIN_MASS_BOOST,
  visualGrowLerp: 0.006,
  visualShrinkLerp: 0.1,
  cameraZoomRef: 40,
  cameraZoomPower: 0.4,
  cameraBaseScale: 0.9,
  spectatePanSpeed: 28,
  spectateMinZoom: 0.05,
  spectateMaxZoom: 250,
  playViewRadiusMult: 1.2,
  spectateViewRadiusMult: 1.2,
  squeezeThroughEnabled: 0,
  autoSplitEnabled: 1,
  autoSplitMassThreshold: 22500,
  cursorSlowdownEnabled: 1,
  cursorSlowdownFactor: 0.55,
  cursorSlowdownRadiusMult: 1.05,
};

const CONFIG_KEYS = Object.keys(defaultGameplayConfig) as (keyof GameplayConfig)[];

export function cloneGameplayConfig(config: GameplayConfig = defaultGameplayConfig): GameplayConfig {
  return { ...config };
}

export function sanitizeGameplayConfig(input: Partial<GameplayConfig> | GameplayConfig): GameplayConfig {
  const merged = { ...defaultGameplayConfig, ...input } as GameplayConfig;
  const out = { ...merged } as GameplayConfig;
  for (const key of CONFIG_KEYS) {
    const raw = Number(out[key]);
    out[key] = (Number.isFinite(raw) ? raw : defaultGameplayConfig[key]) as never;
  }

  out.worldWidth = Math.max(2000, Math.round(out.worldWidth));
  out.worldHeight = Math.max(2000, Math.round(out.worldHeight));
  out.soloFightWorldSize = Math.max(2000, Math.round(out.soloFightWorldSize));
  out.initialMass = Math.max(1, out.initialMass);
  out.minSplitMass = Math.max(2, out.minSplitMass);
  out.maxCellsPerPlayer = Math.max(2, Math.round(out.maxCellsPerPlayer));
  out.maxCellMass = Math.max(100, out.maxCellMass);
  out.speedCoeff = Math.max(0.1, out.speedCoeff);
  out.speedExponent = Math.max(0.01, out.speedExponent);
  out.speedSmallBoost = Math.max(0.1, out.speedSmallBoost);
  out.speedMin = Math.max(0.01, out.speedMin);
  out.speedProgressionSoften = Math.max(0.1, out.speedProgressionSoften);
  out.speedGlobalMult = Math.max(0.01, out.speedGlobalMult);
  out.moveLerp = clamp01(out.moveLerp);
  out.boostSteer = clamp01(out.boostSteer);
  out.moveStopBase = Math.max(0, out.moveStopBase);
  out.moveStopRadiusFrac = Math.max(0, out.moveStopRadiusFrac);
  out.splitBoost = Math.max(0, out.splitBoost);
  out.splitLaunchSharpness = Math.max(0, out.splitLaunchSharpness);
  out.splitLaunchSharpnessSmall = Math.max(0, out.splitLaunchSharpnessSmall);
  out.splitLaunchSharpnessLarge = Math.max(0, out.splitLaunchSharpnessLarge);
  out.centerCursorSplitChainEnabled = out.centerCursorSplitChainEnabled >= 0.5 ? 1 : 0;
  out.splitInheritVelocityEnabled = out.splitInheritVelocityEnabled >= 0.5 ? 1 : 0;
  out.nameScale = clampRange(out.nameScale, 0.1, 1.2);
  out.nameStrokeWidth = clampRange(out.nameStrokeWidth, 0, 0.5);
  out.splitFriction = clampRange(out.splitFriction, 0, 0.9999);
  out.splitSpawnOffset = Math.max(0, out.splitSpawnOffset);
  out.boostPassMult = Math.max(0.1, out.boostPassMult);
  out.mergeBaseMs = Math.max(0, Math.round(out.mergeBaseMs));
  out.mergeMassFactor = Math.max(0, out.mergeMassFactor);
  out.mergeCoverage = clamp01(out.mergeCoverage);
  out.eatMassMult = Math.max(0.01, out.eatMassMult);
  out.eatCoverage = clamp01(out.eatCoverage);
  out.separationStiffness = Math.max(0, out.separationStiffness);
  out.separationIterations = Math.max(1, Math.round(out.separationIterations));
  out.foodMass = Math.max(0.1, out.foodMass);
  out.foodCountSolo = Math.max(0, Math.round(out.foodCountSolo));
  out.foodCountMp = Math.max(0, Math.round(out.foodCountMp));
  out.foodRespawnThreshold = Math.max(0, Math.round(out.foodRespawnThreshold));
  out.foodRespawnBatch = Math.max(0, Math.round(out.foodRespawnBatch));
  out.foodViewRadius = Math.max(100, out.foodViewRadius);
  out.foodViewPerSumRadius = Math.max(0, out.foodViewPerSumRadius);
  out.foodViewPerMaxRadius = Math.max(0, out.foodViewPerMaxRadius);
  out.foodViewMax = Math.max(out.foodViewRadius, out.foodViewMax);
  out.foodNetMax = Math.max(1, Math.round(out.foodNetMax));
  out.virusMass = Math.max(1, out.virusMass);
  out.virusBonusMass = Math.max(0, out.virusBonusMass);
  out.virusMinEatMass = Math.max(1, out.virusMinEatMass);
  out.virusMaxCharge = Math.max(1, Math.round(out.virusMaxCharge));
  out.virusCount = Math.max(0, Math.round(out.virusCount));
  out.virusPopSpeed = Math.max(0, out.virusPopSpeed);
  out.virusPopSharpnessSmall = Math.max(0, out.virusPopSharpnessSmall);
  out.virusPopSharpnessLarge = Math.max(0, out.virusPopSharpnessLarge);
  out.virusPopRangeSmall = Math.max(0, out.virusPopRangeSmall);
  out.virusPopRangeLarge = Math.max(0, out.virusPopRangeLarge);
  out.virusSplitSpeed = Math.max(0, out.virusSplitSpeed);
  out.virusFriction = clampRange(out.virusFriction, 0, 0.9999);
  out.virusEjectCoverage = clamp01(out.virusEjectCoverage);
  out.virusAbsorbCoverage = clamp01(out.virusAbsorbCoverage);
  out.virusBounceFromEject = out.virusBounceFromEject >= 0.5 ? 1 : 0;
  out.ejectLoss = Math.max(0.1, out.ejectLoss);
  out.ejectGain = Math.max(0.1, out.ejectGain);
  out.ejectPickupMinMass = Math.max(0, out.ejectPickupMinMass);
  out.ejectPickupCoverage = clamp01(out.ejectPickupCoverage);
  out.ejectSpeed = Math.max(0, out.ejectSpeed);
  out.ejectMinMass = Math.max(1, out.ejectMinMass);
  out.ejectCooldown = Math.max(0, Math.round(out.ejectCooldown));
  out.ejectGracePeriod = Math.max(0, Math.round(out.ejectGracePeriod));
  out.ejectFriction = clampRange(out.ejectFriction, 0, 0.9999);
  out.ejectMaxCount = Math.max(1, Math.round(out.ejectMaxCount));
  out.ejectNetMax = clampRange(Math.round(out.ejectNetMax), 1, 200);
  out.massDecayPerSec = Math.max(0, out.massDecayPerSec);
  out.massDecayMin = Math.max(0, out.massDecayMin);
  out.botAiIntervalMs = Math.max(10, Math.round(out.botAiIntervalMs));
  out.botCountSolo = Math.max(0, Math.round(out.botCountSolo));
  out.botCountMp = Math.max(0, Math.round(out.botCountMp));
  out.serverTickHz = Math.max(1, Math.round(out.serverTickHz));
  out.adminMassBoost = Math.max(1, out.adminMassBoost);
  out.visualGrowLerp = clamp01(out.visualGrowLerp);
  out.visualShrinkLerp = clamp01(out.visualShrinkLerp);
  out.cameraZoomRef = Math.max(1, out.cameraZoomRef);
  out.cameraZoomPower = Math.max(0.01, out.cameraZoomPower);
  out.cameraBaseScale = Math.max(0.01, out.cameraBaseScale);
  out.spectatePanSpeed = Math.max(0, out.spectatePanSpeed);
  out.spectateMinZoom = Math.max(0.05, out.spectateMinZoom);
  out.spectateMaxZoom = Math.max(out.spectateMinZoom, out.spectateMaxZoom);
  out.playViewRadiusMult = Math.max(0.2, Math.min(4, out.playViewRadiusMult));
  out.spectateViewRadiusMult = Math.max(0.2, Math.min(4, out.spectateViewRadiusMult));
  out.squeezeThroughEnabled = out.squeezeThroughEnabled >= 0.5 ? 1 : 0;
  out.autoSplitEnabled = out.autoSplitEnabled >= 0.5 ? 1 : 0;
  out.autoSplitMassThreshold = Math.max(out.minSplitMass * 2, out.autoSplitMassThreshold);
  out.cursorSlowdownEnabled = out.cursorSlowdownEnabled >= 0.5 ? 1 : 0;
  out.cursorSlowdownFactor = clampRange(out.cursorSlowdownFactor, 0.05, 1);
  out.cursorSlowdownRadiusMult = Math.max(0.2, out.cursorSlowdownRadiusMult);
  return out;
}

/**
 * Derive Solo Fight config from classic: same physics (including initialMass),
 * square map from `soloFightWorldSize`, no bots, food/virus scaled by map area.
 */
export function syncSoloFightFromClassic(classic: GameplayConfig): GameplayConfig {
  const size = Math.max(2000, Math.round(classic.soloFightWorldSize || 10000));
  const classicArea = Math.max(1, classic.worldWidth * classic.worldHeight);
  const density = (size * size) / classicArea;
  return sanitizeGameplayConfig({
    ...classic,
    worldWidth: size,
    worldHeight: size,
    botCountMp: 0,
    botCountSolo: 0,
    foodCountMp: Math.max(0, Math.round(classic.foodCountMp * density)),
    foodCountSolo: Math.max(0, Math.round(classic.foodCountSolo * density)),
    foodRespawnThreshold: Math.max(0, Math.round(classic.foodRespawnThreshold * density)),
    virusCount: Math.max(0, Math.round(classic.virusCount * density)),
  });
}

/** Defaults for «Соло файт» — classic physics + SF world size / no bots. */
export const defaultSoloFightConfig: GameplayConfig = syncSoloFightFromClassic(defaultGameplayConfig);

function clamp01(value: number): number {
  return clampRange(value, 0, 1);
}

function clampRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
