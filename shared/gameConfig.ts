import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  INITIAL_MASS,
  MIN_SPLIT_MASS,
  MAX_CELLS_PER_PLAYER,
  MAX_CELL_MASS,
  FOOD_MASS,
  FOOD_COUNT_SOLO,
  FOOD_COUNT_MP,
  FOOD_RESPAWN_THRESHOLD,
  FOOD_VIEW_RADIUS,
  FOOD_VIEW_PER_SUM_RADIUS,
  FOOD_VIEW_PER_MAX_RADIUS,
  FOOD_VIEW_MAX,
  FOOD_NET_MAX,
  FOOD_RESPAWN_BATCH,
  VIRUS_MASS,
  VIRUS_BONUS_MASS,
  VIRUS_MIN_EAT_MASS,
  VIRUS_MAX_CHARGE,
  VIRUS_COUNT,
  VIRUS_POP_SPEED,
  VIRUS_SPLIT_SPEED,
  VIRUS_FRICTION,
  VIRUS_EJECT_COVERAGE,
  SPEED_COEFF,
  SPEED_EXPONENT,
  SPEED_SMALL_BOOST,
  SPEED_MIN,
  SPEED_PROGRESSION_SOFTEN,
  SPEED_GLOBAL_MULT,
  MOVE_LERP,
  BOOST_STEER,
  MOVE_STOP_BASE,
  MOVE_STOP_RADIUS_FRAC,
  VISUAL_GROW_LERP,
  VISUAL_SHRINK_LERP,
  CAMERA_ZOOM_REF,
  CAMERA_ZOOM_POWER,
  CAMERA_BASE_SCALE,
  SPLIT_BOOST,
  SPLIT_FRICTION,
  SPLIT_SPAWN_OFFSET,
  MERGE_BASE_MS,
  MERGE_MASS_FACTOR,
  MERGE_COVERAGE,
  EAT_MASS_MULT,
  EAT_COVERAGE,
  SEPARATION_STIFFNESS,
  SEPARATION_ITERATIONS,
  BOOST_PASS_MULT,
  EJECT_LOSS,
  EJECT_GAIN,
  EJECT_PICKUP_MIN_MASS,
  EJECT_PICKUP_COVERAGE,
  EJECT_SPEED,
  EJECT_MIN_MASS,
  EJECT_COOLDOWN,
  EJECT_GRACE_PERIOD,
  EJECT_FRICTION,
  EJECT_MAX_COUNT,
  EJECT_NET_MAX,
  MASS_DECAY_PER_SEC,
  MASS_DECAY_MIN,
  BOT_AI_INTERVAL_MS,
  BOT_COUNT_SOLO,
  BOT_COUNT_MP,
  SERVER_TICK_HZ,
  ADMIN_MASS_BOOST,
} from './constants';

export interface GameplayConfig {
  worldWidth: number;
  worldHeight: number;
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
  virusSplitSpeed: number;
  virusFriction: number;
  virusEjectCoverage: number;
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
  /** 1 = on, 0 = off — auto-split when player mass exceeds threshold */
  autoSplitEnabled: number;
  autoSplitMassThreshold: number;
}

export const defaultGameplayConfig: GameplayConfig = {
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
  initialMass: INITIAL_MASS,
  minSplitMass: MIN_SPLIT_MASS,
  maxCellsPerPlayer: MAX_CELLS_PER_PLAYER,
  maxCellMass: MAX_CELL_MASS,
  speedCoeff: SPEED_COEFF,
  speedExponent: SPEED_EXPONENT,
  speedSmallBoost: SPEED_SMALL_BOOST,
  speedMin: SPEED_MIN,
  speedProgressionSoften: SPEED_PROGRESSION_SOFTEN,
  speedGlobalMult: SPEED_GLOBAL_MULT,
  moveLerp: MOVE_LERP,
  boostSteer: BOOST_STEER,
  moveStopBase: MOVE_STOP_BASE,
  moveStopRadiusFrac: MOVE_STOP_RADIUS_FRAC,
  splitBoost: SPLIT_BOOST,
  splitFriction: SPLIT_FRICTION,
  splitSpawnOffset: SPLIT_SPAWN_OFFSET,
  boostPassMult: BOOST_PASS_MULT,
  mergeBaseMs: MERGE_BASE_MS,
  mergeMassFactor: MERGE_MASS_FACTOR,
  mergeCoverage: MERGE_COVERAGE,
  eatMassMult: EAT_MASS_MULT,
  eatCoverage: EAT_COVERAGE,
  separationStiffness: SEPARATION_STIFFNESS,
  separationIterations: SEPARATION_ITERATIONS,
  foodMass: FOOD_MASS,
  foodCountSolo: FOOD_COUNT_SOLO,
  foodCountMp: FOOD_COUNT_MP,
  foodRespawnThreshold: FOOD_RESPAWN_THRESHOLD,
  foodRespawnBatch: FOOD_RESPAWN_BATCH,
  foodViewRadius: FOOD_VIEW_RADIUS,
  foodViewPerSumRadius: FOOD_VIEW_PER_SUM_RADIUS,
  foodViewPerMaxRadius: FOOD_VIEW_PER_MAX_RADIUS,
  foodViewMax: FOOD_VIEW_MAX,
  foodNetMax: FOOD_NET_MAX,
  virusMass: VIRUS_MASS,
  virusBonusMass: VIRUS_BONUS_MASS,
  virusMinEatMass: VIRUS_MIN_EAT_MASS,
  virusMaxCharge: VIRUS_MAX_CHARGE,
  virusCount: VIRUS_COUNT,
  virusPopSpeed: VIRUS_POP_SPEED,
  virusSplitSpeed: VIRUS_SPLIT_SPEED,
  virusFriction: VIRUS_FRICTION,
  virusEjectCoverage: VIRUS_EJECT_COVERAGE,
  ejectLoss: EJECT_LOSS,
  ejectGain: EJECT_GAIN,
  ejectPickupMinMass: EJECT_PICKUP_MIN_MASS,
  ejectPickupCoverage: EJECT_PICKUP_COVERAGE,
  ejectSpeed: EJECT_SPEED,
  ejectMinMass: EJECT_MIN_MASS,
  ejectCooldown: EJECT_COOLDOWN,
  ejectGracePeriod: EJECT_GRACE_PERIOD,
  ejectFriction: EJECT_FRICTION,
  ejectMaxCount: EJECT_MAX_COUNT,
  ejectNetMax: EJECT_NET_MAX,
  massDecayPerSec: MASS_DECAY_PER_SEC,
  massDecayMin: MASS_DECAY_MIN,
  botAiIntervalMs: BOT_AI_INTERVAL_MS,
  botCountSolo: BOT_COUNT_SOLO,
  botCountMp: BOT_COUNT_MP,
  serverTickHz: SERVER_TICK_HZ,
  adminMassBoost: ADMIN_MASS_BOOST,
  visualGrowLerp: VISUAL_GROW_LERP,
  visualShrinkLerp: VISUAL_SHRINK_LERP,
  cameraZoomRef: CAMERA_ZOOM_REF,
  cameraZoomPower: CAMERA_ZOOM_POWER,
  cameraBaseScale: CAMERA_BASE_SCALE,
  spectatePanSpeed: 28,
  spectateMinZoom: 0.25,
  spectateMaxZoom: 7,
  autoSplitEnabled: 0,
  autoSplitMassThreshold: MAX_CELL_MASS,
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
  out.virusSplitSpeed = Math.max(0, out.virusSplitSpeed);
  out.virusFriction = clampRange(out.virusFriction, 0, 0.9999);
  out.virusEjectCoverage = clamp01(out.virusEjectCoverage);
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
  out.ejectNetMax = Math.max(1, Math.round(out.ejectNetMax));
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
  out.autoSplitEnabled = out.autoSplitEnabled >= 0.5 ? 1 : 0;
  out.autoSplitMassThreshold = Math.max(out.minSplitMass * 2, out.autoSplitMassThreshold);
  return out;
}

function clamp01(value: number): number {
  return clampRange(value, 0, 1);
}

function clampRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
