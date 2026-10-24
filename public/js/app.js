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
    playerMount: $("#playerMount"),
    videoThumb: $("#videoThumb"),
    videoLink: $("#videoLink"),
    videoTitle: $("#videoTitle"),
    metaLang: $("#metaLang"),
    metaGen: $("#metaGen"),
    searchInput: $("#searchInput"),
    searchClear: $("#searchClear"),
    searchCount: $("#searchCount"),
    searchPrev: $("#searchPrev"),
    searchNext: $("#searchNext"),
    downloadDropdown: $("#downloadDropdown"),
    downloadBtn: $("#downloadBtn"),
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
    translationLanguages: [],
    currentLang: null,
    snippets: [],
    rows: [],
    matches: [],
    matchIndex: -1,
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
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
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

  function buildLangLabel(code, language, isGenerated) {
    const flags = { en: "🇬🇧", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪", it: "🇮🇹", pt: "🇵🇹", ru: "🇷🇺", ja: "🇯🇵", ko: "🇰🇷", zh: "🇨🇳", ar: "🇸🇦", hi: "🇮🇳", nl: "🇳🇱", pl: "🇵🇱", tr: "🇹🇷", vi: "🇻🇳", th: "🇹🇭", id: "🇮🇩", sv: "🇸🇪", da: "🇩🇰", fi: "🇫🇮", no: "🇳🇴", cs: "🇨🇿", ro: "🇷🇴", hu: "🇭🇺", el: "🇬🇷", he: "🇮🇱" };
    const flag = flags[(code || "").split("-")[0]] || "🌐";
    const type = isGenerated ? " (auto)" : "";
    return `${flag} ${language}${type}`;
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
    destroyPlayer();
    el.videoThumb.src = "";
    el.videoLink.href = "#";
    el.videoTitle.textContent = "Transcript";
    el.metaLang.textContent = "";
    el.metaGen.hidden = true;
    el.transcriptViewer.innerHTML = "";
    el.searchInput.value = "";
    el.searchClear.hidden = true;
    el.searchCount.hidden = true;
    setMatchNavVisible(false);
    el.translateSelect.innerHTML = '<option value="">🌐 Translate…</option>';
    state = {
      ...state,
      videoId: null,
      transcripts: [],
      translationLanguages: [],
      currentLang: null,
      snippets: [],
      rows: [],
      matches: [],
      matchIndex: -1,
    };
  }

  // ─── API ──────────────────────────────────────

  async function apiList(videoId) {
    const res = await fetch(`/api/captions/${videoId}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `Request failed (${res.status})`);
      err.code = body.name || "Error";
      throw err;
    }
    return body;
  }

  async function apiFetch(videoId, { lang, preserveFormatting, translateTo } = {}) {
    const params = new URLSearchParams();
    if (lang) params.set("lang", lang);
    if (preserveFormatting) params.set("preserveFormatting", "true");
    if (translateTo) params.set("translateTo", translateTo);
    const res = await fetch(`/api/captions/${videoId}/fetch?${params}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `Request failed (${res.status})`);
      err.code = body.name || "Error";
      throw err;
    }
    return body;
  }

  function friendlyError(err) {
    const msg = err.message || "";
    const code = err.code || "";
    const map = {
      RequestBlocked: {
        title: "Request Blocked by YouTube",
        message: "YouTube is temporarily blocking requests from this server. Please try again shortly.",
      },
      RateLimited: {
        title: "Slow Down",
        message: "You've made too many requests in a short time. Please wait a moment and try again.",
      },
      VideoUnavailable: { title: "Video Not Found", message: "This video is unavailable or has been removed." },
      InvalidVideoId: { title: "Invalid Link", message: "That doesn't look like a valid YouTube URL or video ID." },
      TranscriptsDisabled: { title: "Transcripts Disabled", message: "This video has captions disabled by the uploader." },
      AgeRestricted: { title: "Age Restricted", message: "This video is age-restricted and can't be fetched." },
      NoTranscriptFound: { title: "No Transcript Found", message: "No captions are available for this video in the requested language." },
      VideoUnplayable: { title: "Video Unplayable", message: "This video can't be played, so its transcript can't be fetched." },
      PoTokenRequired: { title: "Protected Video", message: "YouTube requires extra verification to fetch this transcript." },
      RequestTimeout: { title: "Timed Out", message: "The request to YouTube took too long. Please try again." },
      YouTubeRequestFailed: { title: "YouTube Error", message: "YouTube returned an unexpected response. Please try again." },
    };
    return map[code] || { title: "Error", message: msg || "An unexpected error occurred. Please try again." };
  }

  // ─── Fetch Flow ───────────────────────────────

  async function handleFetch(raw, { lang, translateTo } = {}) {
    const videoId = extractVideoId(raw);
    if (!videoId) {
      el.inputHint.textContent = "Please enter a valid YouTube URL or video ID.";
      el.videoInput.focus();
      return;
    }
    el.inputHint.textContent = "";

    setFetchLoading(true);
    resetResults();
    el.resultsSection.classList.add("visible");
    showSection(el.resultsLoading);

    try {
      const listData = await apiList(videoId);
      state.videoId = videoId;
      state.transcripts = listData.transcripts || [];
      state.translationLanguages = listData.translationLanguages || [];

      el.videoThumb.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      el.videoLink.href = `https://www.youtube.com/watch?v=${videoId}`;

      if (state.transcripts.length === 0) {
        showError("No transcripts found", "This video does not have any captions available.");
        return;
      }

      const preferred =
        (lang && state.transcripts.find((t) => t.languageCode === lang)) ||
        state.transcripts.find((t) => !t.isGenerated) ||
        state.transcripts[0];

      const ok = await loadTranscript(preferred.languageCode, { translateTo });
      if (!ok) return;

      mountPlayer(videoId);
      showSection(null);
      el.resultsContent.hidden = false;
      el.resultsSection.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      const friendly = friendlyError(err);
      showError(friendly.title, friendly.message);
    } finally {
      setFetchLoading(false);
    }
  }

  // Loads a transcript track (or translation). Returns true on success so the
  // caller never reveals an empty results panel after a failure.
  async function loadTranscript(langCode, { translateTo } = {}) {
    state.currentLang = translateTo || langCode;
    showSection(el.resultsLoading);

    try {
      const data = await apiFetch(state.videoId, { lang: langCode, preserveFormatting: true, translateTo });
      state.snippets = data.snippets || [];

      el.videoTitle.textContent = data.language ? `Transcript ${String.fromCharCode(183)} ${data.language}` : "Transcript";
      el.metaLang.textContent = data.languageCode || "";
      el.metaGen.hidden = !data.isGenerated;

      buildTranslateOptions();
      renderTranscript();
      showSection(null);
      el.resultsContent.hidden = false;
      updateUrl(state.videoId, langCode, translateTo);
      return true;
    } catch (err) {
      const friendly = friendlyError(err);
      showError(friendly.title, friendly.message);
      return false;
    }
  }

  // ─── Translate Options ────────────────────────

  function buildTranslateOptions() {
    el.translateSelect.innerHTML = '<option value="">🌐 Translate…</option>';

    // Existing caption tracks in other languages.
    const seen = new Set();
    const trackGroup = document.createElement("optgroup");
    trackGroup.label = "Available captions";
    for (const t of state.transcripts) {
      if (t.languageCode === state.currentLang || seen.has(t.languageCode)) continue;
      seen.add(t.languageCode);
      const opt = document.createElement("option");
      opt.value = `track:${t.languageCode}`;
      opt.textContent = buildLangLabel(t.languageCode, t.language, t.isGenerated);
      trackGroup.appendChild(opt);
    }
    if (trackGroup.childElementCount > 0) el.translateSelect.appendChild(trackGroup);

    // Real machine translations YouTube can produce from the current track.
    if (state.translationLanguages.length > 0) {
      const transGroup = document.createElement("optgroup");
      transGroup.label = "Translate to";
      for (const tl of state.translationLanguages) {
        if (tl.languageCode === state.currentLang) continue;
        const opt = document.createElement("option");
        opt.value = `translate:${tl.languageCode}`;
        opt.textContent = buildLangLabel(tl.languageCode, tl.language, false);
        transGroup.appendChild(opt);
      }
      if (transGroup.childElementCount > 0) el.translateSelect.appendChild(transGroup);
    }
  }

  el.translateSelect.addEventListener("change", () => {
    const value = el.translateSelect.value;
    if (!value) return;
    const [kind, code] = value.split(":");
    if (kind === "translate") {
      // Translate the current base track into the chosen language.
      const base = state.transcripts.find((t) => t.languageCode === state.currentLang) || state.transcripts[0];
      loadTranscript(base.languageCode, { translateTo: code });
    } else {
      loadTranscript(code);
    }
  });

  // ─── Render Transcript ────────────────────────

  function renderTranscript() {
    const frag = document.createDocumentFragment();
    state.rows = [];

    if (state.snippets.length === 0) {
      el.transcriptViewer.innerHTML =
        '<div class="transcript-empty"><p>No transcript content available.</p></div>';
      return;
    }

    state.snippets.forEach((s, index) => {
      const row = document.createElement("div");
      row.className = "snippet";
      row.dataset.index = String(index);

      const time = document.createElement("a");
      time.className = "snippet-time";
      time.href = youtubeUrl(state.videoId, s.start);
      time.target = "_blank";
      time.rel = "noopener";
      time.textContent = formatTime(s.start);
      time.addEventListener("click", (e) => {
        // Keep users on-site: seek the embedded player instead of navigating.
        if (seekPlayer(s.start)) e.preventDefault();
      });

      const text = document.createElement("span");
      text.className = "snippet-text";
      text.textContent = s.text;

      row.appendChild(time);
      row.appendChild(text);
      frag.appendChild(row);
      state.rows.push({ row, textSpan: text, text: s.text, start: s.start });
    });

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
      setMatchNavVisible(false);
      clearSearch();
    }
  });

  el.searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (state.matches.length === 0) return;
    stepMatch(e.shiftKey ? -1 : 1);
  });

  el.searchClear.addEventListener("click", () => {
    el.searchInput.value = "";
    el.searchInput.focus();
    el.searchClear.hidden = true;
    el.searchCount.hidden = true;
    setMatchNavVisible(false);
    clearSearch();
  });

  if (el.searchPrev) el.searchPrev.addEventListener("click", () => stepMatch(-1));
  if (el.searchNext) el.searchNext.addEventListener("click", () => stepMatch(1));

  // Highlights matches by rebuilding the text node tree (never innerHTML of
  // transcript text) so caption markup can't execute as HTML.
  function highlightInto(span, text, lowerQuery) {
    span.textContent = "";
    if (!lowerQuery) {
      span.textContent = text;
      return 0;
    }
    const lowerText = text.toLowerCase();
    let cursor = 0;
    let count = 0;
    for (;;) {
      const idx = lowerText.indexOf(lowerQuery, cursor);
      if (idx === -1) {
        span.appendChild(document.createTextNode(text.slice(cursor)));
        break;
      }
      if (idx > cursor) span.appendChild(document.createTextNode(text.slice(cursor, idx)));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(idx, idx + lowerQuery.length);
      span.appendChild(mark);
      count += 1;
      cursor = idx + lowerQuery.length;
    }
    return count;
  }

  function applySearch(q) {
    const lower = q.toLowerCase();
    let total = 0;
    state.matches = [];

    for (const entry of state.rows) {
      const matchCount = highlightInto(entry.textSpan, entry.text, lower);
      if (matchCount > 0) {
        entry.row.classList.remove("dim");
        state.matches.push(entry.row);
        total += matchCount;
      } else {
        entry.row.classList.add("dim");
      }
    }

    el.searchCount.hidden = false;
    el.searchCount.textContent = `${state.matches.length} match${state.matches.length === 1 ? "" : "es"}`;
    setMatchNavVisible(state.matches.length > 0);
    state.matchIndex = -1;
    if (state.matches.length > 0) stepMatch(1);
  }

  function stepMatch(direction) {
    if (state.matches.length === 0) return;
    for (const row of state.matches) row.classList.remove("active-match");
    state.matchIndex = (state.matchIndex + direction + state.matches.length) % state.matches.length;
    const row = state.matches[state.matchIndex];
    row.classList.add("active-match");
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    el.searchCount.textContent = `${state.matchIndex + 1} / ${state.matches.length}`;
  }

  function setMatchNavVisible(visible) {
    if (el.searchPrev) el.searchPrev.hidden = !visible;
    if (el.searchNext) el.searchNext.hidden = !visible;
  }

  function clearSearch() {
    state.matches = [];
    state.matchIndex = -1;
    for (const entry of state.rows) {
      entry.row.classList.remove("dim", "active-match");
      entry.textSpan.textContent = entry.text;
    }
    el.searchCount.hidden = true;
  }

  // ─── Embedded Player ──────────────────────────

  let player = null;
  let playerReady = false;
  let activeRowIndex = -1;
  let highlightTimer = null;
  let apiLoading = null;

  function loadIframeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (apiLoading) return apiLoading;
    apiLoading = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === "function") prev();
        resolve();
      };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    });
    return apiLoading;
  }

  async function mountPlayer(videoId) {
    if (!el.playerMount) return;
    try {
      await loadIframeApi();
    } catch {
      return;
    }
    el.playerMount.hidden = false;
    el.playerMount.innerHTML = '<div id="ytPlayerFrame"></div>';
    playerReady = false;
    player = new window.YT.Player("ytPlayerFrame", {
      videoId,
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onReady: () => {
          playerReady = true;
        },
        onStateChange: (e) => {
          if (e.data === window.YT.PlayerState.PLAYING) startHighlightLoop();
          else stopHighlightLoop();
        },
      },
    });
  }

  function destroyPlayer() {
    stopHighlightLoop();
    if (player && typeof player.destroy === "function") {
      try {
        player.destroy();
      } catch {
        /* ignore */
      }
    }
    player = null;
    playerReady = false;
    activeRowIndex = -1;
    if (el.playerMount) {
      el.playerMount.hidden = true;
      el.playerMount.innerHTML = "";
    }
  }

  function seekPlayer(seconds) {
    if (player && playerReady && typeof player.seekTo === "function") {
      player.seekTo(seconds, true);
      player.playVideo();
      return true;
    }
    return false;
  }

  function startHighlightLoop() {
    stopHighlightLoop();
    highlightTimer = setInterval(() => {
      if (!player || !playerReady || typeof player.getCurrentTime !== "function") return;
      const t = player.getCurrentTime();
      let lo = 0;
      let hi = state.rows.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (state.rows[mid].start <= t) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (found !== activeRowIndex) {
        if (activeRowIndex >= 0 && state.rows[activeRowIndex]) state.rows[activeRowIndex].row.classList.remove("playing");
        if (found >= 0 && state.rows[found]) state.rows[found].row.classList.add("playing");
        activeRowIndex = found;
      }
    }, 500);
  }

  function stopHighlightLoop() {
    if (highlightTimer) {
      clearInterval(highlightTimer);
      highlightTimer = null;
    }
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

  function pad(value, width) {
    return String(value).padStart(width, "0");
  }

  function formatTimestampSrt(start) {
    const totalMs = Math.round(start * 1000);
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
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
        mime = "application/x-subrip";
        break;
      case "webvtt":
        content = toWebVTT(state.snippets);
        filename = base + ".vtt";
        mime = "text/vtt";
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
    closeDownloadMenu();
    showToast(`Downloaded as ${format.toUpperCase()}`);
  }

  el.downloadMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".dropdown-item");
    if (!item) return;
    downloadFormat(item.dataset.format);
  });

  document.addEventListener("click", (e) => {
    if (!el.downloadDropdown.contains(e.target)) {
      closeDownloadMenu();
    }
  });

  function openDownloadMenu() {
    el.downloadDropdown.classList.add("open");
    el.downloadBtn.setAttribute("aria-expanded", "true");
  }

  function closeDownloadMenu() {
    el.downloadDropdown.classList.remove("open");
    el.downloadBtn.setAttribute("aria-expanded", "false");
  }

  el.downloadBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (el.downloadDropdown.classList.contains("open")) closeDownloadMenu();
    else openDownloadMenu();
  });

  // ─── Error Display ────────────────────────────

  function showError(title, message) {
    destroyPlayer();
    showSection(null);
    el.resultsError.hidden = false;
    el.errorTitle.textContent = title;
    el.errorMessage.textContent = message;
  }

  el.errorDismiss.addEventListener("click", () => {
    resetResults();
    el.videoInput.focus();
  });

  // ─── Fetch Button State ───────────────────────

  function setFetchLoading(loading) {
    el.fetchBtn.disabled = loading;
    el.fetchBtn.classList.toggle("is-loading", loading);
  }

  // ─── Deep Links ───────────────────────────────

  // lang = the actual caption track; tlang = the machine-translation target,
  // kept separate so a restored deep link can re-apply the translation.
  function updateUrl(videoId, lang, tlang) {
    if (!videoId) return;
    const params = new URLSearchParams();
    params.set("v", videoId);
    if (lang) params.set("lang", lang);
    if (tlang) params.set("tlang", tlang);
    const next = `${window.location.pathname}?${params.toString()}`;
    if (window.location.search !== `?${params.toString()}`) {
      window.history.pushState({ videoId, lang, tlang }, "", next);
    }
  }

  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("v");
    if (v) {
      el.videoInput.value = v;
      handleFetch(v, {
        lang: params.get("lang") || undefined,
        translateTo: params.get("tlang") || undefined,
      });
    } else {
      resetResults();
    }
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
      closeDownloadMenu();
    }
  });

  // ─── URL-based loading ────────────────────────

  const urlParams = new URLSearchParams(window.location.search);
  const urlV = urlParams.get("v");
  if (urlV) {
    el.videoInput.value = urlV;
    handleFetch(urlV, {
      lang: urlParams.get("lang") || undefined,
      translateTo: urlParams.get("tlang") || undefined,
    });
  }
})();
