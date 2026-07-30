/** World — former "very large" (12000) ×2; single fixed size, 5×5 sectors */
export const WORLD_WIDTH = 24000;
export const WORLD_HEIGHT = 24000;

/** Cell / player limits — start mass 15 for players & bots */
export const INITIAL_MASS = 15;
/** One formula for all entities: radius = sqrt(mass * 100) */
export const INITIAL_RADIUS = Math.sqrt(INITIAL_MASS * 100);
export const MIN_SPLIT_MASS = 40;
export const MAX_CELLS_PER_PLAYER = 16;
export const MAX_CELL_MASS = 22500;

/** Food — each pellet gives 5 mass; radius from same mass formula */
export const FOOD_MASS = 5;
export const FOOD_RADIUS = Math.sqrt(FOOD_MASS * 100);
export const FOOD_COUNT_SOLO = 1800;
export const FOOD_COUNT_MP = 1400;
export const FOOD_RESPAWN_THRESHOLD = 1000;
/** Base view radius; grows with player size (see getPlayerViewRadius) */
export const FOOD_VIEW_RADIUS = 1600;
export const FOOD_VIEW_PER_SUM_RADIUS = 5.5;
export const FOOD_VIEW_PER_MAX_RADIUS = 4;
export const FOOD_VIEW_MAX = 9000;
/** Max food pellets per network snapshot (nearest-first) */
export const FOOD_NET_MAX = 320;
export const FOOD_RESPAWN_BATCH = 60;

/**
 * Virus — same visual/physical size as a cell with 130 mass.
 * radius = sqrt(130 * 100) ≈ 114. Player spawn 15 → clearly smaller.
 * Eat/pop still requires ≥130 mass (same size or larger).
 */
export const VIRUS_MASS = 130;
export const VIRUS_RADIUS = Math.sqrt(VIRUS_MASS * 100);
export const VIRUS_BONUS_MASS = 100;
/** Absolute min mass to eat / explode on a virus */
export const VIRUS_MIN_EAT_MASS = 130;
export const VIRUS_MAX_CHARGE = 7;
export const VIRUS_COUNT = 32;
export const VIRUS_POP_SPEED = 9;
/** Shot virus — faster and sharper than before */
export const VIRUS_SPLIT_SPEED = 22;
/** Per-frame friction tuned for travel ≈500 */
export const VIRUS_FRICTION = 1 - 22 / 500;
/** W eject absorbed at ≥70% visually inside the virus */
export const VIRUS_EJECT_COVERAGE = 0.7;

/**
 * Movement — classic curve, softened growth slowdown, then ×SPEED_GLOBAL_MULT.
 */
export const SPEED_COEFF = 8.5;
export const SPEED_EXPONENT = 0.439;
export const SPEED_SMALL_BOOST = 1.5;
export const SPEED_MIN = 0.55;
/** 10 = slowdown-with-growth is 10× gentler than classic exponent */
export const SPEED_PROGRESSION_SOFTEN = 10;
/** Global speed scale (2.5× vs previous feel) */
export const SPEED_GLOBAL_MULT = 2.5;
/** 0..1 per ~16ms — softer steer (smooth, not twitchy) */
export const MOVE_LERP = 0.1;
/** While split-boosting, weaker steer toward mouse */
export const BOOST_STEER = 0.025;
/** Soft stop near cursor center (world units + fraction of radius) */
export const MOVE_STOP_BASE = 10;
export const MOVE_STOP_RADIUS_FRAC = 0.06;

/** Visual radius ease — smooth stretch, moderate (avoids old lag) */
// Visual-only smoothing: make mass inflow/outflow look "inflated" and not abrupt.
// Physics remains unchanged (logical radius updates are still instant).
export const VISUAL_GROW_LERP = 0.06;
export const VISUAL_SHRINK_LERP = 0.1;

/** Camera — zoom pulls back with player size (restored) */
export const CAMERA_ZOOM_REF = 40;
export const CAMERA_ZOOM_POWER = 0.4;
export const CAMERA_BASE_SCALE = 0.9;

/** Split — jump distance ≈ SPLIT_BOOST / (1 - SPLIT_FRICTION) = 48/0.08 = 600 */
export const SPLIT_BOOST = 48;
export const SPLIT_FRICTION = 0.92;
export const SPLIT_SPAWN_OFFSET = 0.45;

/**
 * Merge (classic agar.io / Ogar):
 * 30 seconds + 2% of cell mass in seconds
 * = 30000 ms + mass × 20 ms
 * Examples: mass 50 → 31s; mass 100 → 32s; mass 500 → 40s
 */
export const MERGE_BASE_MS = 30000;
export const MERGE_MASS_FACTOR = 20;
/** After timer: merge when this much of the smaller cell is inside the larger */
export const MERGE_COVERAGE = 0.7;

/** Soft body — full hard resolve so own cells never nest / squeeze through each other */
export const SEPARATION_STIFFNESS = 1;
/** Extra separation passes per tick (multi-cell piles need more than one) */
export const SEPARATION_ITERATIONS = 3;
/** Speed above cruise×this counts as split/boost (can pass through lighter own cells) */
export const BOOST_PASS_MULT = 1.25;

/**
 * Eject W — flight halved vs previous (was 56)
 */
export const EJECT_LOSS = 16;
export const EJECT_GAIN = 15;
export const EJECT_PICKUP_MIN_MASS = 1;
/** W must be mostly inside the cell before pickup (avoids vanishing on the rim) */
export const EJECT_PICKUP_COVERAGE = 0.7;
export const EJECT_SPEED = 28;
export const EJECT_MIN_MASS = 30;
/** Faster W cadence (~1.5×) */
export const EJECT_COOLDOWN = 53;
export const EJECT_GRACE_PERIOD = 200;
export const EJECT_FRICTION = 0.945;
/** Soft cap — oldest W blobs despawn when over limit (anti-lag) */
export const EJECT_MAX_COUNT = 3000;
/** Max ejected blobs sent per client state snapshot */
export const EJECT_NET_MAX = 140;

/** Decay — ~0.2% of mass per second */
export const MASS_DECAY_PER_SEC = 0.002;
export const MASS_DECAY_MIN = 50;

/**
 * Eat — from example: 750 vs 950 are equal; 951 eats 750.
 * Ratio = 950/750 ≈ 1.2667; need strictly more than that.
 */
export const EAT_MASS_MULT = 950 / 750;
export const EAT_COVERAGE = 0.7;

/** Spatial hash cell size (world units) */
export const SPATIAL_CELL_SIZE = 80;

/** Bot AI decision cadence (ms) */
export const BOT_AI_INTERVAL_MS = 250;

/** Default bot counts */
export const BOT_COUNT_SOLO = 16;
export const BOT_COUNT_MP = 8;

/** Network */
export const SERVER_TICK_HZ = 30;
export const DEFAULT_SERVER_PORT = 3001;
/**
 * Dev/local fallback when no env, localStorage, or same-origin URL applies.
 * Production (HTTPS behind nginx): client prefers same-origin `wss://host/ws`
 * or build-time `VITE_WS_URL`. Override anytime via `localStorage.agarServerUrl`.
 */
export const DEFAULT_WS_URL = 'ws://127.0.0.1:3001';
/** Path nginx proxies to the Node WS server (see deploy/nginx.conf) */
export const WS_PATH = '/ws';

/** Admin — nickname "салруз" (or latin salruz). Key 2 is for everyone. */
export const ADMIN_NAMES = ['салруз', 'salruz'] as const;
/** Password required to join / use admin nicknames */
export const ADMIN_PASSWORD = 'ыфдкгя';
export const ADMIN_TOKEN = 'salruz'; // legacy; admin is nickname-based now
export const ADMIN_MASS_BOOST = 100;

/** Chat */
export const CHAT_MAX_LENGTH = 100;
export const CHAT_RATE_LIMIT_MS = 800;
export const CHAT_HISTORY_MAX = 80;

/** Client HUD / leaderboard refresh */
export const HUD_HZ = 8;
