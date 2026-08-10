"use strict";

const SHAPE_OPTIONS = [
  ["all", "全部形态"],
  ["serif", "衬线体"],
  ["sans", "非衬线体"],
  ["mono", "等宽字体"],
  ["handwriting", "手写 / 书法"],
  ["display", "展示 / 装饰"],
  ["symbol", "符号 / 抽象"],
  ["bold", "粗体"],
  ["italic", "斜体"],
  ["unknown", "待识别"],
];

const LANGUAGE_OPTIONS = [
  ["all", "全部语言"],
  ["zh", "中文 / CJK"],
  ["latin", "拉丁 / 英文"],
  ["cyrillic", "西里尔 / 俄文"],
  ["ja", "日文"],
  ["ko", "韩文"],
  ["arabic", "阿拉伯文"],
  ["symbol", "符号字符"],
  ["other", "其他文字"],
];

const SHAPE_LABELS = Object.fromEntries(SHAPE_OPTIONS);
const LANGUAGE_LABELS = Object.fromEntries(LANGUAGE_OPTIONS);
const PAGE_SIZE = 48;
const IS_STATIC_HOSTED = ["http:", "https:"].includes(location.protocol)
  && !["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);

const state = {
  fonts: [],
  fontById: new Map(),
  families: [],
  familyByKey: new Map(),
  filtered: [],
  registeredFaces: new Map(),
  activeFaces: new Map(),
  view: localStorage.getItem("localType.view") || "families",
  previewText: localStorage.getItem("localType.preview") ?? "爱l",
  fontSize: Number(localStorage.getItem("localType.size")) || 58,
  search: "",
  shape: "all",
  language: "all",
  sort: "name-asc",
  displayLimit: PAGE_SIZE,
  scanToken: 0,
  analysisDone: 0,
  analysisTotal: 0,
  scanned: false,
  scanning: false,
  inventoryVerified: false,
  inventoryFileCount: 0,
};

const dom = {};
let toastTimer = 0;
let cardObserver = null;
let renderQueued = false;

document.addEventListener("DOMContentLoaded", init);

function init() {
  Object.assign(dom, {
    scanButton: document.querySelector("#scanButton"),
    emptyScanButton: document.querySelector("#emptyScanButton"),
    scanStateText: document.querySelector("#scanStateText"),
    statusDot: document.querySelector("#statusDot"),
    previewInput: document.querySelector("#previewInput"),
    fontSize: document.querySelector("#fontSize"),
    fontSizeValue: document.querySelector("#fontSizeValue"),
    familyCount: document.querySelector("#familyCount"),
    faceCount: document.querySelector("#faceCount"),
    boldCount: document.querySelector("#boldCount"),
    cjkCount: document.querySelector("#cjkCount"),
    lastScan: document.querySelector("#lastScan"),
    fontSearch: document.querySelector("#fontSearch"),
    resetFilters: document.querySelector("#resetFilters"),
    shapeFilters: document.querySelector("#shapeFilters"),
    languageFilters: document.querySelector("#languageFilters"),
    analysisPercent: document.querySelector("#analysisPercent"),
    analysisProgress: document.querySelector("#analysisProgress"),
    resultCount: document.querySelector("#resultCount"),
    sortSelect: document.querySelector("#sortSelect"),
    emptyState: document.querySelector("#emptyState"),
    fontGrid: document.querySelector("#fontGrid"),
    loadMoreButton: document.querySelector("#loadMoreButton"),
    loadMoreCount: document.querySelector("#loadMoreCount"),
    browserSupport: document.querySelector("#browserSupport"),
    fontDialog: document.querySelector("#fontDialog"),
    dialogContent: document.querySelector("#dialogContent"),
    toast: document.querySelector("#toast"),
  });

  dom.previewInput.value = state.previewText;
  dom.fontSize.value = String(state.fontSize);
  dom.fontSizeValue.value = `${state.fontSize} px`;
  document.documentElement.style.setProperty("--preview-size", `${state.fontSize}px`);
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });

  bindEvents();
  renderFilterOptions();
  updateSupportMessage();
  updateStats();
  updateAnalysisProgress();
  attemptAutomaticScan();
}

function bindEvents() {
  dom.scanButton.addEventListener("click", () => scanFonts());
  dom.emptyScanButton.addEventListener("click", () => scanFonts());

  dom.previewInput.addEventListener("input", () => {
    state.previewText = dom.previewInput.value;
    localStorage.setItem("localType.preview", state.previewText);
    document.querySelectorAll(".preview-text, .dialog-face-preview, .dialog-hero-preview").forEach((node) => {
      setPreviewText(node);
    });
  });

  dom.fontSize.addEventListener("input", () => {
    state.fontSize = Number(dom.fontSize.value);
    dom.fontSizeValue.value = `${state.fontSize} px`;
    document.documentElement.style.setProperty("--preview-size", `${state.fontSize}px`);
    localStorage.setItem("localType.size", String(state.fontSize));
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      state.displayLimit = PAGE_SIZE;
      localStorage.setItem("localType.view", state.view);
      document.querySelectorAll("[data-view]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      applyFilters();
    });
  });

  dom.fontSearch.addEventListener("input", () => {
    state.search = normalizeText(dom.fontSearch.value);
    state.displayLimit = PAGE_SIZE;
    applyFilters();
  });

  dom.resetFilters.addEventListener("click", () => {
    state.search = "";
    state.shape = "all";
    state.language = "all";
    state.sort = "name-asc";
    state.displayLimit = PAGE_SIZE;
    dom.fontSearch.value = "";
    dom.sortSelect.value = state.sort;
    applyFilters();
  });

  dom.sortSelect.addEventListener("change", () => {
    state.sort = dom.sortSelect.value;
    state.displayLimit = PAGE_SIZE;
    applyFilters();
  });

  dom.loadMoreButton.addEventListener("click", () => {
    state.displayLimit += PAGE_SIZE;
    renderCatalog();
  });

  dom.fontGrid.addEventListener("click", (event) => {
    const chip = event.target.closest(".variant-chip[data-face-id]");
    if (chip) {
      activateVariant(chip);
      return;
    }
    const details = event.target.closest(".detail-button[data-family-key]");
    if (details) openFamilyDialog(details.dataset.familyKey);
  });

  document.querySelectorAll(".filter-section-title").forEach((button) => {
    button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      button.lastElementChild.textContent = expanded ? "+" : "−";
      button.nextElementSibling.hidden = expanded;
    });
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      dom.fontSearch.focus();
      dom.fontSearch.select();
    }
  });

  dom.fontDialog.addEventListener("click", (event) => {
    if (event.target === dom.fontDialog) dom.fontDialog.close();
  });
}

async function attemptAutomaticScan() {
  if (!("queryLocalFonts" in window)) return;
  if (!("permissions" in navigator)) return;
  try {
    const permission = await navigator.permissions.query({ name: "local-fonts" });
    if (permission.state === "granted") scanFonts({ automatic: true });
  } catch {
    // Some Chromium builds expose the font API without exposing this permission query.
  }
}

async function scanFonts({ automatic = false } = {}) {
  if (state.scanning) return;
  if (!("queryLocalFonts" in window)) {
    showUnsupportedState();
    return;
  }

  state.scanning = true;
  const token = ++state.scanToken;
  setStatus("working", automatic ? "正在同步字体" : "正在读取本机字体");
  setScanButtonBusy(true);

  try {
    const [availableFonts, inventory] = await Promise.all([
      window.queryLocalFonts(),
      fetchLiveFontInventory(),
    ]);
    if (token !== state.scanToken) return;

    clearRegisteredFaces();
    const unique = new Map();
    for (const fontData of availableFonts) {
      const key = [fontData.postscriptName, fontData.family, fontData.fullName, fontData.style]
        .map((value) => String(value || ""))
        .join("\u0001");
      if (!unique.has(key)) unique.set(key, fontData);
    }

    const browserFonts = [...unique.values()];
    const liveFonts = inventory
      ? browserFonts.filter((fontData) => fontExistsInInventory(fontData, inventory))
      : browserFonts;
    const excludedCount = browserFonts.length - liveFonts.length;

    state.fonts = liveFonts.map((fontData, index) => createFontRecord(fontData, index, token));
    state.fontById = new Map(state.fonts.map((font) => [font.id, font]));
    state.analysisDone = 0;
    state.analysisTotal = state.fonts.length;
    state.scanned = true;
    state.inventoryVerified = Boolean(inventory);
    state.inventoryFileCount = inventory?.fileCount || 0;
    state.activeFaces.clear();
    buildFamilies();
    updateStats();
    updateAnalysisProgress();
    applyFilters();

    const time = new Date();
    dom.lastScan.textContent = time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    dom.scanButton.querySelector("span").textContent = "重新扫描";
    if (inventory) {
      const verificationText = excludedCount
        ? ` · 排除 ${excludedCount.toLocaleString("zh-CN")} 个失效缓存`
        : " · 文件已校验";
      setStatus("ready", `${state.fonts.length.toLocaleString("zh-CN")} 个字面已同步${verificationText}`);
      dom.browserSupport.textContent = `已通过 ${inventory.fileCount.toLocaleString("zh-CN")} 个本机字体文件校验 · 数据不上传`;
      showToast(
        `已读取 ${state.families.length} 个家族、${state.fonts.length} 个字面${excludedCount ? `，排除 ${excludedCount} 个无对应文件的缓存字面` : ""}`,
        4600,
      );
    } else {
      const modeText = IS_STATIC_HOSTED ? "静态托管模式" : "文件未校验";
      setStatus("ready", `${state.fonts.length.toLocaleString("zh-CN")} 个字面已同步 · ${modeText}`);
      dom.browserSupport.textContent = IS_STATIC_HOSTED
        ? "GitHub Pages 静态模式 · 字体数据不上传"
        : "仅浏览器字体缓存 · 未校验本机文件";
      showToast(IS_STATIC_HOSTED
        ? `已读取 ${state.families.length} 个家族、${state.fonts.length} 个字面。静态网页无法直接核对磁盘文件。`
        : "直接打开无法核对已删除字体；建议通过 GitHub Pages 的 HTTPS 地址访问。", 6200);
    }
    analyzeInBackground(token);
  } catch (error) {
    if (token !== state.scanToken) return;
    const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
    setStatus("error", denied ? "未获得字体访问权限" : "读取失败");
    showToast(
      denied
        ? "需要允许浏览器访问本机字体。请检查地址栏左侧的网站权限后重试。"
        : `读取字体失败：${error?.message || "未知错误"}`,
      5200,
    );
  } finally {
    if (token === state.scanToken) {
      state.scanning = false;
      setScanButtonBusy(false);
    }
  }
}

function createFontRecord(fontData, index, token) {
  const family = String(fontData.family || fontData.fullName || "未命名字体").trim();
  const fullName = String(fontData.fullName || family).trim();
  const postscriptName = String(fontData.postscriptName || fullName).trim();
  const style = String(fontData.style || "Regular").trim();
  const styleInfo = parseStyle(style, fullName);
  const nameClass = classifyFromName(`${family} ${fullName} ${postscriptName}`);
  const id = `font-${token}-${index}`;

  return {
    id,
    alias: `local-type-${token}-${index}`,
    family,
    familyKey: normalizeText(family),
    fullName,
    postscriptName,
    style,
    searchText: normalizeText(`${family} ${fullName} ${postscriptName} ${style}`),
    weight: styleInfo.weight,
    italic: styleInfo.italic,
    stretch: styleInfo.stretch,
    bold: styleInfo.weight >= 600,
    shape: nameClass.shape,
    languages: nameClass.languages,
    analyzed: false,
    analysisError: false,
    fontData,
  };
}

function parseStyle(style, fullName = "") {
  const text = normalizeText(`${style} ${fullName}`);
  const weights = [
    [/\b(thin|hairline)\b|极细|纤细/, 100],
    [/\b(extra\s*light|ultra\s*light)\b|超细/, 200],
    [/\b(light|demi\s*light|semi\s*light)\b|细体/, 300],
    [/\b(book|regular|normal|roman)\b|常规|正文/, 400],
    [/\bmedium\b|中等|中黑/, 500],
    [/\b(semi\s*bold|demi\s*bold)\b|半粗|中粗/, 600],
    [/\bbold\b|粗体/, 700],
    [/\b(extra\s*bold|ultra\s*bold)\b|超粗/, 800],
    [/\b(black|heavy|poster)\b|特粗|黑体/, 900],
  ];
  let weight = 400;
  for (const [pattern, value] of weights) {
    if (pattern.test(text)) weight = value;
  }
  const italic = /\b(italic|oblique|slanted)\b|斜体/.test(text);
  let stretch = "100%";
  if (/\b(extra\s*condensed|ultra\s*condensed)\b|特窄/.test(text)) stretch = "62.5%";
  else if (/\b(condensed|narrow|compressed)\b|窄体/.test(text)) stretch = "75%";
  else if (/\b(expanded|extended|wide)\b|宽体/.test(text)) stretch = "125%";
  return { weight, italic, stretch };
}

function classifyFromName(value) {
  const text = normalizeText(value);
  let shape = "unknown";

  if (/symbol|symbols|dingbat|emoji|icon|awesome|material icons|pictograph|webdings|wingdings|符号|图标/.test(text)) {
    shape = "symbol";
  } else if (/mono|monospace|code|console|courier|fixed|terminal|等宽/.test(text)) {
    shape = "mono";
  } else if (/script|hand|cursive|callig|brush|signature|kaiti|kaishu|xing|cao|楷|行书|草书|手写|书法/.test(text)) {
    shape = "handwriting";
  } else if (/sans|gothic|grotesk|hei|heiti|雅黑|黑体|等线|方正兰亭|思源黑|苹方|arial|helvetica|verdana|tahoma|calibri/.test(text)) {
    shape = "sans";
  } else if (/serif|roman|times|mincho|ming|song|sung|宋|明朝|仿宋|思源宋|衬线/.test(text)) {
    shape = "serif";
  } else if (/display|decor|poster|stencil|fancy|ornament|banner|标题|海报|艺术/.test(text)) {
    shape = "display";
  }

  const languages = new Set();
  if (shape === "symbol") languages.add("symbol");
  else languages.add("latin");
  if (/cjk|sc\b|tc\b|gb|hans|hant|chinese|china|song|sung|hei|ming|han|中文|汉字|漢字|简体|繁体|宋|黑体|楷|仿宋|明朝/.test(text) || /[\u3400-\u9fff]/.test(value)) {
    languages.add("zh");
  }
  if (/japan|japanese|jp\b|mincho|gothic|hiragana|katakana|日本|明朝/.test(text)) languages.add("ja");
  if (/korean|hangul|kr\b|韩国|韓國|한글/.test(text)) languages.add("ko");
  if (/cyrillic|russian|slavic|кирил|рус/.test(text)) languages.add("cyrillic");
  if (/arabic|arab|عرب/.test(text)) languages.add("arabic");
  return { shape, languages: [...languages] };
}

function buildFamilies() {
  const map = new Map();
  for (const font of state.fonts) {
    if (!map.has(font.familyKey)) {
      map.set(font.familyKey, { key: font.familyKey, name: font.family, faces: [] });
    }
    map.get(font.familyKey).faces.push(font);
  }

  state.families = [...map.values()].map((family) => {
    family.faces.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic) || a.style.localeCompare(b.style));
    const activeId = state.activeFaces.get(family.key);
    family.activeFace = family.faces.find((face) => face.id === activeId)
      || family.faces.find((face) => face.weight === 400 && !face.italic)
      || family.faces.reduce((best, face) => Math.abs(face.weight - 400) < Math.abs(best.weight - 400) ? face : best, family.faces[0]);
    family.searchText = normalizeText(family.faces.map((face) => face.searchText).join(" "));
    family.languages = [...new Set(family.faces.flatMap((face) => face.languages))];
    family.shape = dominantShape(family.faces);
    family.bold = family.faces.some((face) => face.bold);
    family.italic = family.faces.some((face) => face.italic);
    family.maxWeight = Math.max(...family.faces.map((face) => face.weight));
    family.analyzed = family.faces.every((face) => face.analyzed);
    return family;
  });
  state.familyByKey = new Map(state.families.map((family) => [family.key, family]));
}

function dominantShape(faces) {
  const counts = new Map();
  for (const face of faces) counts.set(face.shape, (counts.get(face.shape) || 0) + 1);
  const priority = ["symbol", "mono", "handwriting", "serif", "sans", "display", "unknown"];
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || priority.indexOf(a[0]) - priority.indexOf(b[0]))[0]?.[0] || "unknown";
}

function applyFilters({ preserveLimit = false } = {}) {
  if (!preserveLimit) state.displayLimit = PAGE_SIZE;
  const source = state.view === "families" ? state.families : state.fonts;
  const query = state.search;

  state.filtered = source.filter((item) => {
    if (query && !item.searchText.includes(query)) return false;
    if (state.shape !== "all") {
      if (state.shape === "bold" && !item.bold) return false;
      else if (state.shape === "italic" && !item.italic) return false;
      else if (!["bold", "italic"].includes(state.shape) && item.shape !== state.shape) return false;
    }
    if (state.language !== "all" && !item.languages.includes(state.language)) return false;
    return true;
  });

  const direction = state.sort === "name-desc" ? -1 : 1;
  state.filtered.sort((a, b) => {
    if (state.sort === "faces-desc") {
      return (b.faces?.length || 1) - (a.faces?.length || 1) || aName(a).localeCompare(aName(b), "zh-CN");
    }
    if (state.sort === "weight-desc") {
      return (b.maxWeight || b.weight) - (a.maxWeight || a.weight) || aName(a).localeCompare(aName(b), "zh-CN");
    }
    return direction * aName(a).localeCompare(aName(b), "zh-CN", { sensitivity: "base", numeric: true });
  });

  renderFilterOptions();
  renderCatalog();
}

function aName(item) {
  return item.name || item.family || "";
}

function renderFilterOptions() {
  const source = state.view === "families" ? state.families : state.fonts;
  const shapeCounts = countOptions(source, "shape");
  const languageCounts = countOptions(source, "language");

  dom.shapeFilters.replaceChildren(...SHAPE_OPTIONS.map(([value, label]) => {
    const button = makeFilterButton(value, label, value === "all" ? source.length : shapeCounts.get(value) || 0, state.shape === value);
    button.addEventListener("click", () => {
      state.shape = value;
      state.displayLimit = PAGE_SIZE;
      applyFilters();
    });
    return button;
  }));

  dom.languageFilters.replaceChildren(...LANGUAGE_OPTIONS.map(([value, label]) => {
    const button = makeFilterButton(value, label, value === "all" ? source.length : languageCounts.get(value) || 0, state.language === value);
    button.addEventListener("click", () => {
      state.language = value;
      state.displayLimit = PAGE_SIZE;
      applyFilters();
    });
    return button;
  }));
}

function countOptions(source, kind) {
  const counts = new Map();
  for (const item of source) {
    if (kind === "shape") {
      counts.set(item.shape, (counts.get(item.shape) || 0) + 1);
      if (item.bold) counts.set("bold", (counts.get("bold") || 0) + 1);
      if (item.italic) counts.set("italic", (counts.get("italic") || 0) + 1);
    } else {
      for (const language of item.languages) counts.set(language, (counts.get(language) || 0) + 1);
    }
  }
  return counts;
}

function makeFilterButton(value, label, count, active) {
  const button = document.createElement("button");
  button.className = `filter-option${active ? " is-active" : ""}`;
  button.type = "button";
  button.dataset.value = value;
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const countNode = document.createElement("span");
  countNode.className = "filter-count";
  countNode.textContent = count.toLocaleString("zh-CN");
  button.append(labelNode, countNode);
  return button;
}

function renderCatalog() {
  dom.resultCount.textContent = state.filtered.length.toLocaleString("zh-CN");
  dom.fontGrid.replaceChildren();

  if (!state.scanned || state.filtered.length === 0) {
    dom.emptyState.hidden = false;
    dom.emptyState.querySelector("h3").textContent = state.scanned ? "没有匹配的字体" : "让浏览器认识你的字体";
    dom.emptyState.querySelector("p").textContent = state.scanned
      ? "换一个关键词，或重置形态与语言筛选。"
      : "点击“读取本机字体”，并在浏览器提示中允许访问。字体数据只在本机处理。";
    dom.emptyScanButton.hidden = state.scanned;
    dom.loadMoreButton.hidden = true;
    return;
  }

  dom.emptyState.hidden = true;
  const visible = state.filtered.slice(0, state.displayLimit);
  const fragment = document.createDocumentFragment();
  visible.forEach((item, index) => fragment.append(createFontCard(item, index)));
  dom.fontGrid.append(fragment);

  const remaining = state.filtered.length - visible.length;
  dom.loadMoreButton.hidden = remaining <= 0;
  dom.loadMoreCount.textContent = remaining > 0 ? `还有 ${remaining.toLocaleString("zh-CN")} 个` : "";
  observeCards();
}

function createFontCard(item, index) {
  const family = state.view === "families" ? item : state.familyByKey.get(item.familyKey);
  const face = state.view === "families" ? item.activeFace : item;
  const card = document.createElement("article");
  card.className = "font-card";
  card.dataset.faceId = face.id;
  card.dataset.familyKey = face.familyKey;

  const top = document.createElement("div");
  top.className = "card-top";
  top.innerHTML = `<span class="card-index">${String(index + 1).padStart(3, "0")}</span><span class="card-kind">${escapeHtml(SHAPE_LABELS[family?.shape || face.shape] || "待识别")}</span>`;

  const familyName = document.createElement("h3");
  familyName.className = "family-name";
  familyName.title = face.family;
  familyName.textContent = face.family;

  const faceName = document.createElement("p");
  faceName.className = "face-name";
  faceName.textContent = state.view === "families"
    ? `${face.style} · ${family.faces.length} 个字面`
    : `${face.style} · ${face.postscriptName}`;

  const preview = document.createElement("div");
  preview.className = "preview-text";
  preview.dataset.faceId = face.id;
  setPreviewText(preview);
  applyFallbackFont(preview, face);

  const variants = document.createElement("div");
  variants.className = "variant-row";
  if (state.view === "families") {
    const shown = family.faces.slice(0, 4);
    for (const variant of shown) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `variant-chip${variant.id === face.id ? " is-active" : ""}`;
      chip.dataset.faceId = variant.id;
      chip.dataset.familyKey = family.key;
      chip.title = variant.fullName;
      chip.textContent = compactStyleName(variant.style);
      variants.append(chip);
    }
    if (family.faces.length > shown.length) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "variant-chip detail-button";
      more.dataset.familyKey = family.key;
      more.textContent = `+${family.faces.length - shown.length}`;
      variants.append(more);
    }
  } else {
    const weightTag = document.createElement("span");
    weightTag.className = "variant-chip";
    weightTag.textContent = `W${face.weight}`;
    variants.append(weightTag);
  }

  const bottom = document.createElement("div");
  bottom.className = "card-bottom";
  const tags = document.createElement("div");
  tags.className = "tags";
  getDisplayTags(family || face).slice(0, 3).forEach(({ label, accent }) => {
    const tag = document.createElement("span");
    tag.className = `tag${accent ? " is-accent" : ""}`;
    tag.textContent = label;
    tags.append(tag);
  });
  const detail = document.createElement("button");
  detail.type = "button";
  detail.className = "detail-button";
  detail.dataset.familyKey = face.familyKey;
  detail.textContent = "查看家族";
  bottom.append(tags, detail);

  card.append(top, familyName, faceName, preview, variants, bottom);
  return card;
}

function activateVariant(chip) {
  const face = state.fontById.get(chip.dataset.faceId);
  const family = state.familyByKey.get(chip.dataset.familyKey);
  const card = chip.closest(".font-card");
  if (!face || !family || !card) return;
  state.activeFaces.set(family.key, face.id);
  family.activeFace = face;
  card.dataset.faceId = face.id;
  card.querySelectorAll(".variant-chip[data-face-id]").forEach((item) => item.classList.toggle("is-active", item === chip));
  card.querySelector(".face-name").textContent = `${face.style} · ${family.faces.length} 个字面`;
  const preview = card.querySelector(".preview-text");
  preview.dataset.faceId = face.id;
  applyFallbackFont(preview, face);
  ensureExactFace(face).then((fontFamily) => {
    if (preview.dataset.faceId === face.id) preview.style.fontFamily = fontFamily;
  });
}

function observeCards() {
  cardObserver?.disconnect();
  cardObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const preview = entry.target.querySelector(".preview-text");
      const face = state.fontById.get(preview?.dataset.faceId);
      if (preview && face) {
        ensureExactFace(face).then((fontFamily) => {
          if (preview.dataset.faceId === face.id) preview.style.fontFamily = fontFamily;
        });
      }
      cardObserver.unobserve(entry.target);
    }
  }, { rootMargin: "220px" });
  document.querySelectorAll(".font-card").forEach((card) => cardObserver.observe(card));
}

function applyFallbackFont(element, face) {
  element.style.fontFamily = `${quoteCssFamily(face.family)}, sans-serif`;
  element.style.fontWeight = String(face.weight);
  element.style.fontStyle = face.italic ? "italic" : "normal";
  element.style.fontStretch = face.stretch;
}

async function ensureExactFace(face) {
  if (state.registeredFaces.has(face.id)) return state.registeredFaces.get(face.id).promise;
  const fallback = `${quoteCssFamily(face.family)}, sans-serif`;
  if (!("FontFace" in window)) return fallback;

  const sourceName = face.postscriptName || face.fullName || face.family;
  const promise = (async () => {
    try {
      const fontFace = new FontFace(
        face.alias,
        `local(${quoteCssFamily(sourceName)})`,
        { weight: String(face.weight), style: face.italic ? "italic" : "normal", stretch: face.stretch },
      );
      await fontFace.load();
      if (!state.fontById.has(face.id)) return fallback;
      document.fonts.add(fontFace);
      const record = state.registeredFaces.get(face.id);
      if (record) record.fontFace = fontFace;
      return `${quoteCssFamily(face.alias)}, ${fallback}`;
    } catch {
      return fallback;
    }
  })();
  state.registeredFaces.set(face.id, { promise, fontFace: null });
  return promise;
}

function clearRegisteredFaces() {
  for (const record of state.registeredFaces.values()) {
    if (record.fontFace) document.fonts.delete(record.fontFace);
  }
  state.registeredFaces.clear();
}

function openFamilyDialog(familyKey) {
  const family = state.familyByKey.get(familyKey);
  if (!family) return;
  const face = family.activeFace;
  dom.dialogContent.replaceChildren();

  const kicker = document.createElement("div");
  kicker.className = "dialog-kicker";
  kicker.textContent = `FONT FAMILY · ${family.faces.length} FACES`;
  const title = document.createElement("h2");
  title.className = "dialog-title";
  title.textContent = family.name;
  const tags = document.createElement("div");
  tags.className = "dialog-tags";
  getDisplayTags(family).forEach(({ label, accent }) => {
    const tag = document.createElement("span");
    tag.className = `tag${accent ? " is-accent" : ""}`;
    tag.textContent = label;
    tags.append(tag);
  });
  const hero = document.createElement("div");
  hero.className = "dialog-hero-preview";
  hero.dataset.faceId = face.id;
  setPreviewText(hero);
  applyFallbackFont(hero, face);
  ensureExactFace(face).then((fontFamily) => { hero.style.fontFamily = fontFamily; });

  const list = document.createElement("div");
  list.className = "dialog-faces";
  for (const variant of family.faces) {
    const row = document.createElement("article");
    row.className = "dialog-face";
    const meta = document.createElement("div");
    const name = document.createElement("div");
    name.className = "dialog-face-name";
    name.textContent = variant.style;
    const info = document.createElement("div");
    info.className = "dialog-face-info";
    info.textContent = `${variant.postscriptName} · W${variant.weight}${variant.italic ? " · Italic" : ""}`;
    meta.append(name, info);
    const preview = document.createElement("div");
    preview.className = "dialog-face-preview";
    preview.dataset.faceId = variant.id;
    setPreviewText(preview);
    applyFallbackFont(preview, variant);
    ensureExactFace(variant).then((fontFamily) => {
      if (preview.dataset.faceId === variant.id) preview.style.fontFamily = fontFamily;
    });
    row.append(meta, preview);
    list.append(row);
  }

  dom.dialogContent.append(kicker, title, tags, hero, list);
  dom.fontDialog.showModal();
}

function getDisplayTags(item) {
  const tags = [];
  const shape = item.shape || "unknown";
  tags.push({ label: SHAPE_LABELS[shape] || "待识别", accent: shape === "symbol" });
  if (item.bold) tags.push({ label: "含粗体", accent: false });
  const languages = item.languages || [];
  const order = ["zh", "latin", "cyrillic", "ja", "ko", "arabic", "symbol", "other"];
  for (const key of order) {
    if (languages.includes(key)) tags.push({ label: LANGUAGE_LABELS[key], accent: key === "zh" });
  }
  return tags;
}

async function analyzeInBackground(token) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, state.fonts.length) }, async () => {
    while (cursor < state.fonts.length && token === state.scanToken) {
      const index = cursor++;
      const font = state.fonts[index];
      try {
        const metadata = await readOpenTypeMetadata(font.fontData);
        if (token !== state.scanToken) return;
        applyOpenTypeMetadata(font, metadata);
      } catch {
        font.analysisError = true;
      } finally {
        font.analyzed = true;
        state.analysisDone++;
        if (state.analysisDone % 18 === 0 || state.analysisDone === state.analysisTotal) {
          updateAnalysisProgress();
        }
        if (state.analysisDone % 54 === 0 || state.analysisDone === state.analysisTotal) {
          buildFamilies();
          updateStats();
          queueAnalysisRender();
        }
      }
    }
  });
  await Promise.all(workers);
  if (token === state.scanToken) {
    buildFamilies();
    updateStats();
    updateAnalysisProgress();
    applyFilters({ preserveLimit: true });
  }
}

function queueAnalysisRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    applyFilters({ preserveLimit: true });
  });
}

async function readOpenTypeMetadata(fontData) {
  const blob = await fontData.blob();
  if (!blob || blob.size < 12) return null;
  let sfntOffset = 0;
  const first = new DataView(await blob.slice(0, 16).arrayBuffer());
  if (tagAt(first, 0) === "ttcf" && first.byteLength >= 16) sfntOffset = first.getUint32(12, false);
  if (sfntOffset < 0 || sfntOffset + 12 > blob.size) return null;

  const header = new DataView(await blob.slice(sfntOffset, sfntOffset + 12).arrayBuffer());
  const numTables = header.getUint16(4, false);
  if (!numTables || numTables > 256) return null;
  const directorySize = numTables * 16;
  const directory = new DataView(await blob.slice(sfntOffset + 12, sfntOffset + 12 + directorySize).arrayBuffer());
  let os2 = null;
  for (let i = 0; i < numTables; i++) {
    const offset = i * 16;
    if (tagAt(directory, offset) === "OS/2") {
      os2 = { offset: directory.getUint32(offset + 8, false), length: directory.getUint32(offset + 12, false) };
      break;
    }
  }
  if (!os2 || os2.length < 42 || os2.offset + Math.min(os2.length, 96) > blob.size) return null;
  const table = new DataView(await blob.slice(os2.offset, os2.offset + Math.min(os2.length, 96)).arrayBuffer());
  const panose = Array.from({ length: 10 }, (_, i) => table.getUint8(32 + i));
  const ranges = table.byteLength >= 58
    ? [table.getUint32(42, false), table.getUint32(46, false), table.getUint32(50, false), table.getUint32(54, false)]
    : [0, 0, 0, 0];
  return {
    weight: table.getUint16(4, false),
    widthClass: table.getUint16(6, false),
    panose,
    ranges,
  };
}

function tagAt(view, offset) {
  if (offset + 4 > view.byteLength) return "";
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

function applyOpenTypeMetadata(font, metadata) {
  if (!metadata) return;
  const [familyType, serifStyle, , proportion] = metadata.panose;
  if (proportion === 9) font.shape = "mono";
  else if (familyType === 2 && serifStyle >= 2 && serifStyle <= 10) font.shape = "serif";
  else if (familyType === 2 && serifStyle >= 11 && serifStyle <= 15) font.shape = "sans";
  else if (familyType === 3) font.shape = "handwriting";
  else if (familyType === 4) font.shape = "display";
  else if (familyType === 5) font.shape = "symbol";

  if (metadata.weight >= 1 && metadata.weight <= 1000) {
    font.weight = metadata.weight;
    font.bold = metadata.weight >= 600;
  }

  const hasBit = (bit) => ((metadata.ranges[Math.floor(bit / 32)] >>> (bit % 32)) & 1) === 1;
  if (metadata.ranges.some(Boolean)) {
    const languages = new Set();
    if ([0, 1, 2, 3].some(hasBit)) languages.add("latin");
    if (hasBit(9)) languages.add("cyrillic");
    if (hasBit(13) || hasBit(63)) languages.add("arabic");
    if (hasBit(59) || hasBit(61) || hasBit(52)) languages.add("zh");
    if (hasBit(50) || hasBit(51)) languages.add("ja");
    if (hasBit(28) || hasBit(53) || hasBit(56)) languages.add("ko");
    if (familyType === 5 || font.shape === "symbol") languages.add("symbol");
    if ([7, 10, 11, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26].some(hasBit)) languages.add("other");
    if (languages.size) font.languages = [...languages];
  }
}

function updateStats() {
  dom.familyCount.textContent = state.scanned ? state.families.length.toLocaleString("zh-CN") : "—";
  dom.faceCount.textContent = state.scanned ? state.fonts.length.toLocaleString("zh-CN") : "—";
  dom.boldCount.textContent = state.scanned ? state.fonts.filter((font) => font.bold).length.toLocaleString("zh-CN") : "—";
  dom.cjkCount.textContent = state.scanned ? state.families.filter((family) => family.languages.includes("zh")).length.toLocaleString("zh-CN") : "—";
}

function updateAnalysisProgress() {
  const percent = state.analysisTotal ? Math.round((state.analysisDone / state.analysisTotal) * 100) : 0;
  dom.analysisPercent.textContent = `${percent}%`;
  dom.analysisProgress.style.width = `${percent}%`;
}

function updateSupportMessage() {
  if ("queryLocalFonts" in window) {
    dom.browserSupport.textContent = IS_STATIC_HOSTED
      ? "GitHub Pages 静态模式 · 字体数据不上传"
      : location.protocol === "file:"
      ? "直接打开模式 · 请用启动脚本校验已删除字体"
      : "本地字体 API 可用 · 数据不上传";
  } else {
    dom.browserSupport.textContent = "请使用桌面版 Edge 或 Chrome";
    showUnsupportedState();
  }
}

function showUnsupportedState() {
  dom.emptyState.hidden = false;
  dom.emptyState.querySelector("h3").textContent = "当前浏览器不支持本地字体读取";
  dom.emptyState.querySelector("p").textContent = "请通过 GitHub Pages 的 HTTPS 地址，在桌面版 Microsoft Edge 或 Google Chrome 中打开。";
  dom.emptyScanButton.hidden = true;
  setStatus("error", "浏览器不支持");
}

function setStatus(kind, text) {
  dom.statusDot.className = `status-dot${kind ? ` is-${kind}` : ""}`;
  dom.scanStateText.textContent = text;
}

function setScanButtonBusy(busy) {
  dom.scanButton.disabled = busy;
  dom.emptyScanButton.disabled = busy;
  dom.scanButton.querySelector("span").textContent = busy ? "正在扫描" : state.scanned ? "重新扫描" : "读取本机字体";
}

function setPreviewText(node) {
  const hasText = state.previewText.length > 0;
  node.textContent = hasText ? state.previewText : "输入一些文字…";
  node.classList.toggle("is-placeholder", !hasText);
}

function compactStyleName(style) {
  return String(style || "Regular").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
}

function inventoryKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, "")
    .trim();
}

function prepareInventory(rawInventory) {
  if (!rawInventory || rawInventory.error || !rawInventory.parsed_face_count) return null;

  return {
    fileCount: Number(rawInventory.file_count || 0),
    parsedFaceCount: Number(rawInventory.parsed_face_count || 0),
    postscript: new Set(rawInventory.postscript_keys || []),
    fullNames: new Set(rawInventory.full_name_keys || []),
    familyStyles: new Set(rawInventory.family_style_keys || []),
    variableFamilies: new Set(rawInventory.variable_family_keys || []),
    fileStems: new Set(rawInventory.file_stem_keys || []),
    registryNames: new Set(rawInventory.live_registry_name_keys || []),
  };
}

async function fetchLiveFontInventory() {
  if (IS_STATIC_HOSTED) return null;
  const endpoints = location.protocol === "file:"
    ? ["http://127.0.0.1:8787/api/font-inventory"]
    : ["/api/font-inventory"];

  for (const endpoint of endpoints) {
    try {
      const separator = endpoint.includes("?") ? "&" : "?";
      const response = await fetch(`${endpoint}${separator}t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) continue;
      const inventory = prepareInventory(await response.json());
      if (inventory) return inventory;
    } catch {
      // Direct-file mode can only reach the helper when the launcher is running.
    }
  }

  return null;
}

function fontExistsInInventory(fontData, inventory) {
  const postscript = inventoryKey(fontData.postscriptName);
  const fullName = inventoryKey(fontData.fullName);
  const family = inventoryKey(fontData.family);
  const familyStyle = inventoryKey(`${fontData.family}|${fontData.style}`);
  const registryStyleName = inventoryKey(`${fontData.family} ${fontData.style}`);

  if (postscript && inventory.postscript.has(postscript)) return true;
  if (fullName && inventory.fullNames.has(fullName)) return true;
  if (familyStyle && inventory.familyStyles.has(familyStyle)) return true;
  if (postscript && inventory.fileStems.has(postscript)) return true;
  if (fullName && inventory.fileStems.has(fullName)) return true;
  if (fullName && inventory.registryNames.has(fullName)) return true;
  if (registryStyleName && inventory.registryNames.has(registryStyleName)) return true;
  if (family && [...inventory.variableFamilies].some((liveFamily) => family === liveFamily || family.startsWith(liveFamily))) return true;
  return false;
}

function quoteCssFamily(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ")}"`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function showToast(message, duration = 3300) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), duration);
}
