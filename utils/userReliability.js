const INITIAL_RELIABILITY = 30;

function normalizeReliability(value) {
  const number = value == null ? INITIAL_RELIABILITY : Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.trunc(number))) : INITIAL_RELIABILITY;
}

function reliabilityLevel(value) {
  const score = normalizeReliability(value);
  if (score < 25) return "Baja";
  if (score < 50) return "Media";
  if (score < 75) return "Alta";
  return "Muy alta";
}

function alertHasImages(value) {
  let images = value;
  if (typeof images === "string") {
    try { images = JSON.parse(images); } catch { return false; }
  }
  return Array.isArray(images) && images.some(image => typeof image === "string" && image.trim().length > 0);
}

function evaluateReliability(current, { isTruthful, hasImages }) {
  const before = normalizeReliability(current);
  if (!isTruthful) return { before, after: 0, change: -before };
  const after = Math.min(100, before + (hasImages ? 20 : 10));
  return { before, after, change: after - before };
}

module.exports = { INITIAL_RELIABILITY, normalizeReliability, reliabilityLevel, alertHasImages, evaluateReliability };
