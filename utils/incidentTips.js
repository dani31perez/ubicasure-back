function detectedTypes(analysis) {
  const detected = new Map();
  function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const type = value.type || value.class;
    const confidence = value.max_confidence ?? value.confidence;
    if (typeof type === "string" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) {
      detected.set(type, Math.max(detected.get(type) || 0, confidence));
    }
    // Python serializes summarize() as [objects, damage]. Also accept named groups.
    for (const key of ["detections", "objects", "damage"]) visit(value[key]);
  }
  for (const result of analysis) {
    if (result?.incident_detected !== true || result.review_required === true) continue;
    visit(result.incident);
    visit(result.analysis);
  }
  return detected;
}

async function getIncidentTips(db, analysis) {
  const detected = detectedTypes(analysis);
  const types = [...detected.keys()];
  if (!types.length) return [];
  const refs = types.map(type => db.collection("incidentTips").doc(type));
  const snapshots = await db.getAll(...refs);
  const tips = snapshots.map(snapshot => snapshot.exists ? snapshot.data() : null);
  const grouped = new Map();
  tips.forEach((tip, i) => {
    const type = types[i];
    if (!tip || tip.enabled !== true || typeof tip.text !== "string" || !tip.text.trim() ||
        typeof tip.title !== "string" || typeof tip.tipId !== "string" ||
        !Number.isFinite(tip.minConfidence) || detected.get(type) < tip.minConfidence) return;
    const previous = grouped.get(tip.tipId);
    if (previous) { previous.matchedTypes.push(type); return; }
    grouped.set(tip.tipId, {
      id: tip.tipId, title: tip.title, text: tip.text,
      priority: Number.isFinite(tip.priority) ? tip.priority : 0,
      matchedTypes: [type], sources: Array.isArray(tip.sources) ? tip.sources : [],
    });
  });
  return [...grouped.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

module.exports = { detectedTypes, getIncidentTips };
