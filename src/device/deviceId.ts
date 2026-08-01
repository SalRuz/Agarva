const DEVICE_KEY = 'agarvaDeviceId';
const FP_KEY = 'agarvaFingerprint';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function simpleHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Best-effort device fingerprint (survives IP change; weak across browsers). */
export function buildDeviceFingerprint(): string {
  try {
    const parts = [
      navigator.platform || '',
      navigator.language || '',
      String(screen.width),
      String(screen.height),
      String(screen.colorDepth),
      String(window.devicePixelRatio || 1),
      String(navigator.hardwareConcurrency || 0),
      String((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0),
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      String(new Date().getTimezoneOffset()),
    ];
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 64, 24);
      ctx.fillStyle = '#069';
      ctx.fillText('agarva', 2, 2);
      parts.push(canvas.toDataURL().slice(-64));
    }
    return simpleHash(parts.join('|'));
  } catch {
    return simpleHash('unknown');
  }
}

/** Stable id for this browser profile; linked to fingerprint for soft recovery. */
export function getOrCreateDeviceId(): { deviceId: string; fingerprint: string } {
  let fingerprint = '';
  try {
    fingerprint = localStorage.getItem(FP_KEY) || buildDeviceFingerprint();
    localStorage.setItem(FP_KEY, fingerprint);
  } catch {
    fingerprint = buildDeviceFingerprint();
  }

  let deviceId = '';
  try {
    deviceId = localStorage.getItem(DEVICE_KEY) || '';
  } catch {
    deviceId = '';
  }
  if (!deviceId) {
    deviceId = randomId();
    try {
      localStorage.setItem(DEVICE_KEY, deviceId);
    } catch {
      /* ignore */
    }
  }
  return { deviceId, fingerprint };
}
