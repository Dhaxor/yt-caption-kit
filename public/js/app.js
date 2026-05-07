(function () {
  "use strict";

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

  const el = {
    searchForm: $("#searchForm"),
    videoInput: $("#videoInput"),
    fetchBtn: $("#fetchBtn"),
    inputHint: $("#inputHint"),
    heroSection: $("#heroSection"),
    featuresSection: $("#featuresSection"),
    resultsSection: $("#resultsSection"),
    resultsError: $("#resultsError"),
    errorTitle: $("#errorTitle"),
    errorMessage: $("#errorMessage"),
    errorDismiss: $("#errorDismiss"),
    resultsLoading: $("#resultsLoading"),
    resultsContent: $("#resultsContent"),
    videoThumb: $("#videoThumb"),
    videoLink: $("#videoLink"),
    videoTitle: $("#videoTitle"),
    metaLang: $("#metaLang"),
    metaGen: $("#metaGen"),
    searchInput: $("#searchInput"),
    searchClear: $("#searchClear"),
    searchCount: $("#searchCount"),
    downloadDropdown: $("#downloadDropdown"),
    downloadMenu: $("#downloadMenu"),
    translateSelect: $("#translateSelect"),
    transcriptViewer: $("#transcriptViewer"),
    transcriptEmpty: $("#transcriptEmpty"),
    copyBtn: $("#copyBtn"),
    themeToggle: $("#themeToggle"),
    toastContainer: $("#toastContainer"),
  };

  let state = {
    videoId: null,
    transcripts: [],
    currentLang: null,
    snippets: [],
    filters: [],
    langLabels: {},
  };

  // ─── Theme ────────────────────────────────────

  const html = document.documentElement;
  const savedTheme = localStorage.getItem("yck-theme") || "dark";
  html.setAttribute("data-theme", savedTheme);

  el.themeToggle.addEventListener("click", () => {
    const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    localStorage.setItem("yck-theme", next);
  });

  // ─── Toast ────────────────────────────────────

  function showToast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    el.toastContainer.appendChild(t);
    setTimeout(() => {
      t.classList.add("toast-out");
      t.addEventListener("animationend", () => t.remove());
    }, 2500);
  }

  // ─── Helpers ──────────────────────────────────

  function extractVideoId(raw) {
    const trimmed = raw.trim();
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const p of patterns) {
      const m = trimmed.match(p);
      if (m) return m[1];
    }
    return null;
  }

  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function youtubeUrl(videoId, seconds) {
    return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(seconds)}s`;
  }

  function buildLangLabel(t) {
    const flags = { en: "🇬🇧", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪", it: "🇮🇹", pt: "🇵🇹", ru: "🇷🇺", ja: "🇯🇵", ko: "🇰🇷", zh: "🇨🇳", ar: "🇸🇦", hi: "🇮🇳", nl: "🇳🇱", pl: "🇵🇱", tr: "🇹🇷", vi: "🇻🇳", th: "🇹🇭", id: "🇮🇩", sv: "🇸🇪", da: "🇩🇰", fi: "🇫🇮", no: "🇳🇴", cs: "🇨🇿", ro: "🇷🇴", hu: "🇭🇺", el: "🇬🇷", he: "🇮🇱" };
    const flag = flags[t.languageCode] || "🌐";
    const type = t.isGenerated ? " (auto)" : "";
    return `${flag} ${t.language}${type}`;
  }

  // ─── State Management ─────────────────────────

  function showSection(section) {
    [el.resultsError, el.resultsLoading, el.resultsContent].forEach((s) => {
      s.hidden = true;
    });
    if (section) section.hidden = false;
  }

  function resetResults() {
    showSection(null);
    el.resultsSection.classList.remove("visible");
    el.videoThumb.src = "";
    el.videoLink.href = "#";
    el.videoTitle.textContent = "Transcript";
    el.metaLang.textContent = "";
    el.metaGen.hidden = true;
    el.transcriptViewer.innerHTML = "";
    el.searchInput.value = "";
    el.searchClear.hidden = true;
    el.searchCount.hidden = true;
    el.translateSelect.innerHTML = '<option value="">🌐 Translate…</option>';
    state = { ...state, videoId: null, transcripts: [], currentLang: null, snippets: [], langLabels: {} };
  }

  // ─── API ──────────────────────────────────────

  async function apiList(videoId) {
    const res = await fetch(`/api/captions/${videoId}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  async function apiFetch(videoId, lang, preserveFormatting) {
    const params = new URLSearchParams();
    if (lang) params.set("lang", lang);
    if (preserveFormatting) params.set("preserveFormatting", "true");
    const res = await fetch(`/api/captions/${videoId}/fetch?${params}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  // ─── Fetch Flow ───────────────────────────────

  async function handleFetch(raw) {
    const videoId = extractVideoId(raw);
    if (!videoId) {
      el.inputHint.textContent = "Please enter a valid YouTube URL or video ID.";
      el.videoInput.focus();
      return;
    }
    el.inputHint.textContent = "";

    resetResults();
    el.resultsSection.classList.add("visible");
    showSection(el.resultsLoading);

    try {
      const listData = await apiList(videoId);
      state.videoId = videoId;
      state.transcripts = listData.transcripts || [];
      state.langLabels = {};

      el.videoThumb.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      el.videoLink.href = `https://www.youtube.com/watch?v=${videoId}`;

      if (state.transcripts.length === 0) {
        showError("No transcripts found", "This video does not have any captions available.");
        return;
      }

      const chosen = state.transcripts.find((t) => !t.isGenerated) || state.transcripts[0];
      await loadTranscript(chosen.languageCode);

      showSection(null);
      el.resultsContent.hidden = false;

      el.heroSection.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      showError("Error", err.message);
    }
  }

  async function loadTranscript(langCode) {
    state.currentLang = langCode;
    showSection(el.resultsLoading);

    try {
      const data = await apiFetch(state.videoId, langCode, true);
      state.snippets = data.snippets || [];

      el.videoTitle.textContent = data.language ? `Transcript · ${data.language}` : "Transcript";
      el.metaLang.textContent = data.languageCode || "";
      el.metaGen.hidden = !data.isGenerated;

      buildTranslateOptions();

      renderTranscript();
      showSection(null);
      el.resultsContent.hidden = false;
    } catch (err) {
      showError("Error", err.message);
    }
  }

  // ─── Translate Options ────────────────────────

  function buildTranslateOptions() {
    const unique = [];
    const seen = new Set();
    for (const t of state.transcripts) {
      const key = t.languageCode;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(t);
      }
    }

    el.translateSelect.innerHTML = '<option value="">🌐 Translate…</option>';
    for (const t of unique) {
      if (t.languageCode === state.currentLang) continue;
      const opt = document.createElement("option");
      opt.value = t.languageCode;
      opt.textContent = buildLangLabel(t);
      el.translateSelect.appendChild(opt);
    }
  }

  el.translateSelect.addEventListener("change", () => {
    const code = el.translateSelect.value;
    if (!code) return;
    loadTranscript(code);
  });

  // ─── Render Transcript ────────────────────────

  function renderTranscript() {
    const frag = document.createDocumentFragment();

    if (state.snippets.length === 0) {
      el.transcriptViewer.innerHTML =
        '<div class="transcript-empty"><p>No transcript content available.</p></div>';
      return;
    }

    for (const s of state.snippets) {
      const row = document.createElement("div");
      row.className = "snippet";

      const time = document.createElement("a");
      time.className = "snippet-time";
      time.href = youtubeUrl(state.videoId, s.start);
      time.target = "_blank";
      time.rel = "noopener";
      time.textContent = formatTime(s.start);

      const text = document.createElement("span");
      text.className = "snippet-text";
      text.textContent = s.text;

      row.appendChild(time);
      row.appendChild(text);
      frag.appendChild(row);
    }

    el.transcriptViewer.innerHTML = "";
    el.transcriptViewer.appendChild(frag);

    if (el.searchInput.value.trim()) {
      applySearch(el.searchInput.value);
    }
  }

  // ─── Search ───────────────────────────────────

  el.searchInput.addEventListener("input", () => {
    const q = el.searchInput.value.trim();
    if (q) {
      el.searchClear.hidden = false;
      applySearch(q);
    } else {
      el.searchClear.hidden = true;
      el.searchCount.hidden = true;
      clearSearch();
    }
  });

  el.searchClear.addEventListener("click", () => {
    el.searchInput.value = "";
    el.searchInput.focus();
    el.searchClear.hidden = true;
    el.searchCount.hidden = true;
    clearSearch();
  });

  function applySearch(q) {
    const lower = q.toLowerCase();
    let count = 0;
    const rows = $$(".snippet", el.transcriptViewer);

    for (const row of rows) {
      const text = $(".snippet-text", row);
      if (!text) continue;
      const original = text.textContent;
      const match = original.toLowerCase().includes(lower);

      if (match) {
        row.classList.remove("dim");
        count++;
        const regex = new RegExp(`(${escapeRegex(lower)})`, "gi");
        text.innerHTML = original.replace(regex, "<mark>$1</mark>");
      } else {
        row.classList.add("dim");
        text.textContent = original;
      }
    }

    el.searchCount.hidden = false;
    el.searchCount.textContent = `${count} / ${rows.length}`;
  }

  function clearSearch() {
    const rows = $$(".snippet", el.transcriptViewer);
    for (const row of rows) {
      row.classList.remove("dim");
      const text = $(".snippet-text", row);
      if (text) text.textContent = text.textContent;
    }
    el.searchCount.hidden = true;
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ─── Copy ─────────────────────────────────────

  el.copyBtn.addEventListener("click", () => {
    const text = state.snippets.map((s) => s.text).join(" ");
    navigator.clipboard.writeText(text).then(
      () => showToast("Transcript copied to clipboard"),
      () => showToast("Failed to copy")
    );
  });

  // ─── Download ─────────────────────────────────

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function formatTimestampSrt(start) {
    const h = Math.floor(start / 3600);
    const m = Math.floor((start % 3600) / 60);
    const s = Math.floor(start % 60);
    const ms = Math.floor((start % 1) * 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  }

  function toSrt(snippets) {
    return snippets
      .map((s, i) => {
        const end = s.start + (s.duration || 3);
        return `${i + 1}\n${formatTimestampSrt(s.start)} --> ${formatTimestampSrt(end)}\n${s.text}\n`;
      })
      .join("\n");
  }

  function toWebVTT(snippets) {
    return (
      "WEBVTT\n\n" +
      snippets
        .map((s) => {
          const end = s.start + (s.duration || 3);
          return `${formatTimestampSrt(s.start).replace(",", ".")} --> ${formatTimestampSrt(end).replace(",", ".")}\n${s.text}\n`;
        })
        .join("\n")
    );
  }

  async function downloadFormat(format) {
    if (!state.snippets.length) return;

    let content, filename, mime;
    const base = state.videoId + "_" + (state.currentLang || "en");

    switch (format) {
      case "json":
        content = JSON.stringify(state.snippets, null, 2);
        filename = base + ".json";
        mime = "application/json";
        break;
      case "srt":
        content = toSrt(state.snippets);
        filename = base + ".srt";
        mime = "text/plain";
        break;
      case "webvtt":
        content = toWebVTT(state.snippets);
        filename = base + ".vtt";
        mime = "text/plain";
        break;
      case "text":
        content = state.snippets.map((s) => s.text).join("\n");
        filename = base + ".txt";
        mime = "text/plain";
        break;
      default:
        return;
    }

    downloadFile(content, filename, mime);
    el.downloadDropdown.classList.remove("open");
    showToast(`Downloaded as ${format.toUpperCase()}`);
  }

  el.downloadMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".dropdown-item");
    if (!item) return;
    downloadFormat(item.dataset.format);
  });

  document.addEventListener("click", (e) => {
    if (!el.downloadDropdown.contains(e.target)) {
      el.downloadDropdown.classList.remove("open");
    }
  });

  $("#downloadBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    el.downloadDropdown.classList.toggle("open");
  });

  // ─── Error Display ────────────────────────────

  function showError(title, message) {
    showSection(null);
    el.resultsError.hidden = false;
    el.errorTitle.textContent = title;
    el.errorMessage.textContent = message;
  }

  el.errorDismiss.addEventListener("click", () => {
    resetResults();
    el.videoInput.focus();
  });

  // ─── Form Submit ──────────────────────────────

  el.searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = el.videoInput.value.trim();
    if (!val) return;
    handleFetch(val);
  });

  // ─── Keyboard Shortcuts ───────────────────────

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      el.searchInput.focus();
    }
    if (e.key === "Escape") {
      el.downloadDropdown.classList.remove("open");
    }
  });

  // ─── URL-based loading ────────────────────────

  const urlParams = new URLSearchParams(window.location.search);
  const urlV = urlParams.get("v");
  if (urlV) {
    el.videoInput.value = urlV;
    handleFetch(urlV);
  }
})();
