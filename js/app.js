/* ==========================================================================
   SPT — live data layer + rendering
   Two fetches: LEADERBOARD (aggregates) and SITE (per-season history).
   No chart libraries. No dependencies. Just the databook.
   ========================================================================== */

(function () {
  "use strict";

  var BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTVMK7oQCF4qf-Jhan0o4GS8BQEDVeavP9O0TDj6f1JDrr945ks9aycIngxlCrVlUHXyNMixaSw6Uq2/pub";
  var URL_LEADERBOARD = BASE + "?gid=232414899&single=true&output=csv";
  var URL_SITE = BASE + "?gid=556175416&single=true&output=csv";

  var THE_FIVE = ["Concierge", "Doctor", "Dyna-mite", "Ices", "Smooth"];

  /* Joker is a seat, not a person — a guest chair added for a stretch
     of seasons. Display it as such everywhere. */
  var DISPLAY_NAMES = { "Joker": "Joker Seat" };
  var SEAT_NOTES = {
    "Phantom": "The sixth seat",
    "Joker": "Guest seat — a different face most weeks"
  };
  function displayName(name) { return DISPLAY_NAMES[name] || name; }

  /* ------------------------------------------------------------------
     CSV parser — handles quoted fields, embedded commas and newlines
     ------------------------------------------------------------------ */
  function parseCSV(text) {
    var rows = [], row = [], field = "", inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else { field += c; }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else if (c === "\r") { /* skip */ }
        else { field += c; }
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function num(v) {
    if (v === null || v === undefined) return 0;
    var n = parseFloat(String(v).replace(/,/g, "").trim());
    return isNaN(n) ? 0 : n;
  }

  function fmt(n) {
    return Math.round(n).toLocaleString("en-AU");
  }

  /* ------------------------------------------------------------------
     LEADERBOARD tab
     Columns (0-indexed): 0 name · 21 total · 23–28 placings 1st–6th ·
     29 games · 30 points per game. Core players sit above the
     "Substitutes" marker row; subs below it.
     ------------------------------------------------------------------ */
  function parseLeaderboard(rows) {
    var core = [], subs = [], pastMarker = false;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var name = (r[0] || "").trim();
      if (!name) continue;
      if (/^substitutes$/i.test(name)) { pastMarker = true; continue; }
      var p = {
        name: name,
        total: num(r[21]),
        games: num(r[29]),
        ppg: num(r[30]),
        placings: [num(r[23]), num(r[24]), num(r[25]), num(r[26]), num(r[27]), num(r[28])]
      };
      // Guard against stray header text reaching this point
      if (!p.games && !p.total && !/[a-z]/i.test(name)) continue;
      (pastMarker ? subs : core).push(p);
    }
    return { core: core, subs: subs };
  }

  /* ------------------------------------------------------------------
     SITE tab — Player, SPT1 … SPT22. Preserves databook row order,
     which mirrors the leaderboard (core, marker, subs).
     ------------------------------------------------------------------ */
  function parseSite(rows) {
    if (!rows.length) return { seasons: [], players: [] };
    var header = rows[0];
    var seasons = header.slice(1).map(function (h) { return (h || "").trim(); }).filter(Boolean);
    var players = [];
    for (var i = 1; i < rows.length; i++) {
      var name = (rows[i][0] || "").trim();
      if (!name || /^substitutes$/i.test(name)) continue;
      players.push({
        name: name,
        seasons: seasons.map(function (_, j) { return num(rows[i][j + 1]); })
      });
    }
    return { seasons: seasons, players: players };
  }

  function seasonHistoryFor(site, name) {
    for (var i = 0; i < site.players.length; i++) {
      if (site.players[i].name === name) return site.players[i].seasons;
    }
    return null;
  }

  /* First-to-last season with points on the board — derived from the
     databook, never hardcoded. Returns e.g. "SPT5–SPT12". */
  function eraFor(site, name) {
    var hist = seasonHistoryFor(site, name);
    if (!hist) return null;
    var first = -1, last = -1;
    for (var i = 0; i < hist.length; i++) {
      if (hist[i] > 0) { if (first === -1) first = i; last = i; }
    }
    if (first === -1) return null;
    return {
      label: site.seasons[first] + "\u2013" + site.seasons[last],
      count: last - first + 1
    };
  }

  /* ------------------------------------------------------------------
     Sparkline — pure SVG. Grey polyline; best season marked blue,
     leanest marked red. Colour arrives on hover via CSS.
     ------------------------------------------------------------------ */
  function sparkline(values) {
    var W = 200, H = 44, PAD = 4;
    var max = Math.max.apply(null, values);
    var min = Math.min.apply(null, values);
    var range = max - min || 1;
    var pts = values.map(function (v, i) {
      var x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
      var y = H - PAD - ((v - min) / range) * (H - PAD * 2);
      return [x, y];
    });
    var bestIdx = values.indexOf(max);
    var worstIdx = values.indexOf(min);
    var path = pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
    return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline class="spark-line" points="' + path + '"/>' +
      '<circle class="spark-best" cx="' + pts[bestIdx][0].toFixed(1) + '" cy="' + pts[bestIdx][1].toFixed(1) + '" r="3.5"/>' +
      '<circle class="spark-worst" cx="' + pts[worstIdx][0].toFixed(1) + '" cy="' + pts[worstIdx][1].toFixed(1) + '" r="3.5"/>' +
      "</svg>";
  }

  function initials(name) {
    return name.split(/[\s-]+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase();
  }

  function avatarSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  /* Avatar: tries assets/avatars/<slug>.jpg, falls back to a monogram */
  function avatarHTML(name) {
    var slug = avatarSlug(name);
    return '<div class="avatar">' +
      '<img src="assets/avatars/' + slug + '.jpg" alt="" loading="lazy" ' +
      "onerror=\"this.parentNode.textContent='" + initials(name) + "'\">" +
      "</div>";
  }

  /* ------------------------------------------------------------------
     Renderers
     ------------------------------------------------------------------ */
  function renderHeroStats(lb, site) {
    var seasons = site.seasons.length;
    var allPlayers = lb.core.length + lb.subs.length;
    var totalPoints = lb.core.concat(lb.subs).reduce(function (s, p) { return s + p.total; }, 0);
    var el = document.getElementById("hero-stats");
    if (!el) return;
    el.querySelector('[data-stat="seasons"]').textContent = seasons;
    el.querySelector('[data-stat="players"]').textContent = allPlayers;
    el.querySelector('[data-stat="points"]').textContent = fmt(totalPoints);
  }

  function renderFeatureCards(lb, site) {
    var host = document.getElementById("feature-cards");
    if (!host) return;
    var ranked = lb.core.slice().sort(function (a, b) { return b.total - a.total; });
    var html = THE_FIVE.map(function (name) {
      var p = null;
      for (var i = 0; i < lb.core.length; i++) if (lb.core[i].name === name) { p = lb.core[i]; break; }
      if (!p) return "";
      var rank = ranked.indexOf(p) + 1;
      var hist = seasonHistoryFor(site, name);
      var sparkBlock = hist && hist.length > 1
        ? sparkline(hist) +
          '<div class="spark-caption"><span>SPT1</span><span>SPT' + hist.length + "</span></div>"
        : "";
      return (
        '<article class="player-card" tabindex="0">' +
          avatarHTML(name) +
          "<div>" +
            '<h3 class="player-name">' + name + "</h3>" +
            '<div class="player-rank">All-time #' + rank + "</div>" +
          "</div>" +
          '<div class="card-stats">' +
            '<div class="card-stat"><span class="v">' + fmt(p.total) + '</span><span class="k">Points</span></div>' +
            '<div class="card-stat"><span class="v">' + p.ppg.toFixed(2) + '</span><span class="k">PPG</span></div>' +
            '<div class="card-stat"><span class="v">' + fmt(p.placings[0]) + '</span><span class="k">1st</span></div>' +
          "</div>" +
          sparkBlock +
        "</article>"
      );
    }).join("");
    host.innerHTML = html;
  }

  function renderLeaderboardTable(lb, site) {
    var tbody = document.querySelector("#lb-table tbody");
    if (!tbody) return;
    var ranked = lb.core.slice().sort(function (a, b) { return b.total - a.total; });
    // Column bests, matching the databook's per-column highlight
    var bests = {
      total: Math.max.apply(null, ranked.map(function (p) { return p.total; })),
      ppg: Math.max.apply(null, ranked.map(function (p) { return p.ppg; }))
    };
    tbody.innerHTML = ranked.map(function (p, i) {
      var leader = i === 0 ? ' class="is-leader"' : "";
      var era = THE_FIVE.indexOf(p.name) === -1 ? eraFor(site, p.name) : null;
      var nameCell = displayName(p.name) +
        (era ? ' <span class="era-tag">' + era.label + "</span>" : "");
      var cells =
        '<td class="col-rank">' + (i + 1) + "</td>" +
        '<td class="col-name">' + nameCell + "</td>" +
        '<td class="num num-total">' + fmt(p.total) + "</td>" +
        '<td class="num">' + fmt(p.games) + "</td>" +
        '<td class="num">' + (p.ppg === bests.ppg ? '<span class="best-mark">' + p.ppg.toFixed(2) + "</span>" : p.ppg.toFixed(2)) + "</td>" +
        p.placings.map(function (v) { return '<td class="num">' + fmt(v) + "</td>"; }).join("");
      return "<tr" + leader + ">" + cells + "</tr>";
    }).join("");
  }

  function renderPastSeats(lb, site) {
    var host = document.getElementById("seat-cards");
    if (!host) return;
    var seats = lb.core.filter(function (p) { return THE_FIVE.indexOf(p.name) === -1; });
    if (!seats.length) { host.innerHTML = ""; return; }
    host.innerHTML = seats.map(function (p) {
      var era = eraFor(site, p.name);
      var note = SEAT_NOTES[p.name] || "";
      var sub = era
        ? note + (note ? " \u00b7 " : "") + era.label
        : note;
      var hist = seasonHistoryFor(site, p.name);
      var sparkBlock = hist && hist.length > 1 ? sparkline(hist) : "";
      return (
        '<article class="player-card" tabindex="0">' +
          avatarHTML(p.name) +
          "<div>" +
            '<h3 class="player-name">' + displayName(p.name) + "</h3>" +
            '<div class="player-rank">' + sub + "</div>" +
          "</div>" +
          '<div class="card-stats">' +
            '<div class="card-stat"><span class="v">' + fmt(p.total) + '</span><span class="k">Points</span></div>' +
            '<div class="card-stat"><span class="v">' + fmt(p.games) + '</span><span class="k">Games</span></div>' +
            '<div class="card-stat"><span class="v">' + p.ppg.toFixed(2) + '</span><span class="k">PPG</span></div>' +
          "</div>" +
          sparkBlock +
        "</article>"
      );
    }).join("");
  }

  function renderSubs(lb) {
    var host = document.getElementById("sub-cards");
    if (!host) return;
    var subs = lb.subs.slice().sort(function (a, b) { return b.total - a.total || b.games - a.games; });
    host.innerHTML = subs.map(function (p) {
      return (
        '<div class="sub-card">' +
          '<div class="sub-name">' + p.name + "</div>" +
          '<div class="sub-stats">' +
            "<span><b>" + fmt(p.total) + "</b> pts</span>" +
            "<span><b>" + fmt(p.games) + "</b> " + (p.games === 1 ? "game" : "games") + "</span>" +
          "</div>" +
        "</div>"
      );
    }).join("");
  }

  function showError(msg) {
    var note = '<div class="data-error">Couldn\u2019t reach the databook. ' + msg +
      " Refresh to try again \u2014 the Sheet may be waking up.</div>";
    ["feature-cards", "seat-cards", "sub-cards"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = note;
    });
    var tbody = document.querySelector("#lb-table tbody");
    if (tbody) tbody.innerHTML = '<tr><td colspan="11">' + note + "</td></tr>";
  }

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */
  function fetchCSV(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    }).then(parseCSV);
  }

  Promise.all([fetchCSV(URL_LEADERBOARD), fetchCSV(URL_SITE)])
    .then(function (results) {
      var lb = parseLeaderboard(results[0]);
      var site = parseSite(results[1]);
      var page = document.body.getAttribute("data-page");
      if (page === "dashboard") {
        renderHeroStats(lb, site);
        renderFeatureCards(lb, site);
        renderLeaderboardTable(lb, site);
      } else if (page === "players") {
        renderPastSeats(lb, site);
        renderSubs(lb);
      }
    })
    .catch(function (err) {
      console.error("SPT data load failed:", err);
      showError("(" + err.message + ")");
    });
})();
