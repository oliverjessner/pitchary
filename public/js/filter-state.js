export function readFilters(view) {
  try {
    const value = JSON.parse(localStorage.getItem(`pitchary.${view}.filters`));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

export function saveFilters(view, value) {
  try {
    localStorage.setItem(`pitchary.${view}.filters`, JSON.stringify(value));
  } catch {
    // Filters remain usable when browser storage is unavailable.
  }
}

export function restoreParams(view, params) {
  if (!params.size) {
    const saved = readFilters(view);
    for (const [key, value] of Object.entries(saved))
      if (typeof value === "string") params.set(key, value);
  }
  saveFilters(view, Object.fromEntries(params));
  return params;
}

export function selectedTags(tags, saved) {
  const ids = new Set(Array.isArray(saved.tagIds) ? saved.tagIds : []);
  return tags.filter((tag) => ids.has(tag.id)).map((tag) => tag.id);
}
