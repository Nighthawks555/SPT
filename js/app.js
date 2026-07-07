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
  /* GAMES tab gid — per-game results. Once the GAMES tab is published,
     replace the placeholder below with its gid. Until then the games
     grid quietly stays hidden and everything else works. */
  var GAMES_GID = "1306722529";
  var URL_GAMES = BASE + "?gid=" + GAMES_GID + "&single=true&output=csv";

  /* Photo gallery — images live in the GitHub repo under
     images/{season}.{game}/ e.g. images/22.1/. Fill in the repo owner
     below (the GitHub username the SPT repo lives under). */
  var GITHUB_OWNER = "Nighthawks555";
  var GITHUB_REPO = "SPT";
  var GITHUB_BRANCH = "main";

  /* Player profile photos — images/players/{Poker Name}.jpg in the repo.
     Optional images/players/players.json maps poker name to
     { "realName": "...", "firstPlayed": "..." } (both optional;
     firstPlayed overrides the season derived from the databook). */
  var RAW_BASE = "https://raw.githubusercontent.com/" + GITHUB_OWNER + "/" +
    GITHUB_REPO + "/" + GITHUB_BRANCH + "/";
  var PLAYERS_IMG_BASE = RAW_BASE + "images/players/";
  var URL_PLAYER_META = PLAYERS_IMG_BASE + "players.json";

  /* One repo-tree call indexes every file under images/ — powers the
     View pics / Add pics button states and the galleries without
     per-folder API requests. */
  var IMG_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;
  var repoIndex = null;
  var repoIndexPromise = fetch("https://api.github.com/repos/" + GITHUB_OWNER + "/" +
      GITHUB_REPO + "/git/trees/" + GITHUB_BRANCH + "?recursive=1")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (t) {
      if (!t || !t.tree) return null;
      var idx = {};
      t.tree.forEach(function (f) {
        if (f.type !== "blob") return;
        var m = f.path.match(/^images\/([^\/]+)\/([^\/]+)$/);
        if (!m) return;
        (idx[m[1]] = idx[m[1]] || []).push(m[2]);
      });
      return idx;
    })
    .catch(function () { return null; });
  repoIndexPromise.then(function (idx) { repoIndex = idx; refreshPicsButtons(); });

  function folderHasPics(folder) {
    if (!repoIndex) return null; // unknown yet
    return (repoIndex[folder] || []).some(function (n) { return IMG_EXT.test(n); });
  }

  function refreshPicsButtons() {
    if (!repoIndex) return;
    var btns = document.querySelectorAll(".pics-btn");
    for (var i = 0; i < btns.length; i++) {
      var has = folderHasPics(btns[i].getAttribute("data-folder"));
      btns[i].textContent = has ? "View pics" : "Add pics";
      btns[i].classList.toggle("pics-btn-empty", !has);
    }
  }

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
      var rounds = [];
      for (var k = 0; k < 10; k++) {
        rounds.push({ tp: num(r[1 + 2 * k]), w: num(r[2 + 2 * k]) });
      }
      var p = {
        name: name,
        total: num(r[21]),
        games: num(r[29]),
        ppg: num(r[30]),
        rounds: rounds,
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

  /* All-time placings pie — SVG wedges, greyscale ramp (brightest =
     1sts), 1st wedge turns blue on card hover via CSS. Legend carries
     the actual counts. */
  var ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th"];

  function pieWedge(cx, cy, r, a0, a1) {
    var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    var large = (a1 - a0) > Math.PI ? 1 : 0;
    return "M" + cx + "," + cy + " L" + x0.toFixed(2) + "," + y0.toFixed(2) +
      " A" + r + "," + r + " 0 " + large + " 1 " + x1.toFixed(2) + "," + y1.toFixed(2) + " Z";
  }

  function placingPieHTML(placings) {
    var total = placings.reduce(function (s, v) { return s + v; }, 0);
    if (!total) return "";
    var a = -Math.PI / 2; // start at 12 o'clock
    var wedges = "";
    for (var i = 0; i < placings.length; i++) {
      if (!placings[i]) continue;
      var sweep = (placings[i] / total) * Math.PI * 2;
      // A full-circle single wedge won't draw as one arc; use two halves
      if (sweep >= Math.PI * 2 - 0.0001) {
        wedges += '<circle class="pie-seg seg-' + (i + 1) + '" cx="50" cy="50" r="48"><title>' +
          ORDINALS[i] + " · " + placings[i] + "</title></circle>";
      } else {
        wedges += '<path class="pie-seg seg-' + (i + 1) + '" d="' + pieWedge(50, 50, 48, a, a + sweep) +
          '"><title>' + ORDINALS[i] + " · " + placings[i] + "</title></path>";
      }
      a += sweep;
    }
    var legend = placings.map(function (v, i) {
      return '<div class="pie-key"><span class="pie-swatch seg-' + (i + 1) + '"></span>' +
        '<span class="pie-key-label">' + ORDINALS[i] + '</span>' +
        '<span class="pie-key-count">' + fmt(v) + "</span></div>";
    }).join("");
    return (
      '<div class="placings">' +
        '<div class="placings-label">All-time placings</div>' +
        '<div class="placings-chart">' +
          '<svg class="placings-pie" viewBox="0 0 100 100" aria-hidden="true">' + wedges + "</svg>" +
          '<div class="pie-legend">' + legend + "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function initials(name) {
    return name.split(/[\s-]+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase();
  }

  function photoURL(name) {
    return PLAYERS_IMG_BASE + encodeURIComponent(name) + ".jpg";
  }

  /* Avatar: images/players/{Poker Name}.jpg from the repo, monogram fallback */
  function avatarHTML(name) {
    return '<div class="avatar">' +
      '<img src="' + photoURL(name) + '" alt="" loading="lazy" ' +
      "onerror=\"this.parentNode.textContent='" + initials(name) + "'\">" +
      "</div>";
  }

  function firstSeasonFor(site, name) {
    var hist = seasonHistoryFor(site, name);
    if (!hist) return null;
    for (var i = 0; i < hist.length; i++) {
      if (hist[i] > 0) return site.seasons[i];
    }
    return null;
  }

  function metaFor(playerMeta, name) {
    var m = (playerMeta && playerMeta[name]) || null;
    if (typeof m === "string") return { realName: m, firstPlayed: null };
    return { realName: (m && m.realName) || "", firstPlayed: (m && m.firstPlayed) || null };
  }

  /* Unified compact profile card — OG's, Past Seats, and Substitutes
     all share this shape. */
  function profileCardHTML(opts) {
    var statsRow = opts.stats && opts.stats.length
      ? '<div class="profile-stats">' + opts.stats.map(function (s) {
          return '<span class="profile-stat"><b>' + s.v + "</b> " + s.k + "</span>";
        }).join("") + "</div>"
      : "";
    return (
      '<article class="profile-card" tabindex="0">' +
        '<div class="profile-photo">' +
          '<img src="' + photoURL(opts.photoName || opts.name) + '" alt="" loading="lazy" ' +
          "onerror=\"this.parentNode.textContent='" + initials(opts.title) + "'\">" +
        "</div>" +
        '<div class="profile-body">' +
          '<h3 class="profile-name">' + opts.title + "</h3>" +
          (opts.realName ? '<div class="profile-real">' + opts.realName + "</div>" : "") +
          (opts.meta ? '<div class="profile-meta">' + opts.meta + "</div>" : "") +
          statsRow +
        "</div>" +
      "</article>"
    );
  }

  /* ------------------------------------------------------------------
     Renderers
     ------------------------------------------------------------------ */
  /* League tiebreak: countback on positions. Equal points resolve by
     most 1sts that season, then most 2nds, and so on. Position counts
     come from the games data; without it, points stand alone. */
  function positionCountsFor(seasonGames) {
    if (!seasonGames || !seasonGames.majors.length) return null;
    var counts = {};
    seasonGames.majors.forEach(function (p) { counts[p.name] = [0, 0, 0, 0, 0, 0]; });
    for (var g = 0; g < 10; g++) {
      var pool = rankPoolFor(seasonGames, g);
      seasonGames.majors.forEach(function (p) {
        var pos = positionIn(g, p, pool);
        if (pos !== null) counts[p.name][Math.min(pos, 6) - 1]++;
      });
    }
    return counts;
  }

  function countbackCompare(a, b, counts) {
    if (b.points !== a.points) return b.points - a.points;
    if (!counts || !counts[a.name] || !counts[b.name]) return 0;
    for (var i = 0; i < 6; i++) {
      if (counts[a.name][i] !== counts[b.name][i]) {
        return counts[b.name][i] - counts[a.name][i];
      }
    }
    return 0;
  }

  function sortWithCountback(rows, counts) {
    return rows.slice().sort(function (a, b) { return countbackCompare(a, b, counts); });
  }

  function majorsStandingsFor(lb, site, seasonIdx, gamesData) {
    var coreNames = lb.core.map(function (p) { return p.name; });
    var seen = {};
    var majors = standingsFor(site, seasonIdx).filter(function (r) {
      if (coreNames.indexOf(r.name) === -1 || seen[r.name]) return false;
      seen[r.name] = true;
      return true;
    });
    var counts = gamesData ? positionCountsFor(gamesData[site.seasons[seasonIdx]]) : null;
    return { rows: sortWithCountback(majors, counts), counts: counts };
  }

  /* Championships — top major of every COMPLETED season after
     countback. The current season's leader isn't a champion yet.
     Returns { name: [seasonIdx] } */
  function computeChampionships(lb, site, gamesData) {
    var champs = {};
    for (var idx = 0; idx < site.seasons.length - 1; idx++) {
      var st = majorsStandingsFor(lb, site, idx, gamesData);
      if (st.rows.length) {
        var top = st.rows[0].name;
        (champs[top] = champs[top] || []).push(idx);
      }
    }
    return champs;
  }

  function seasonYear(seasonName) {
    var no = parseInt(String(seasonName).replace(/\D/g, ""), 10);
    return no ? String(2004 + no) : "";
  }

  function openChampionships(playerName, lb, site, gamesData) {
    var modal = ensureModal();
    var body = document.getElementById("pics-body");
    var champs = computeChampionships(lb, site, gamesData)[playerName] || [];
    document.getElementById("pics-title").textContent =
      playerName + " \u00b7 " + champs.length + (champs.length === 1 ? " Championship" : " Championships");
    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
    if (!champs.length) {
      body.innerHTML = '<p class="pics-note">No titles yet. The felt is long.</p>';
      return;
    }
    body.innerHTML = champs.map(function (idx) {
      var majors = majorsStandingsFor(lb, site, idx, gamesData).rows;
      var rows = majors.map(function (r, i) {
        return (
          '<li class="standing-row' + (i === 0 ? " is-champ" : "") + '">' +
            '<span class="standing-rank">' + (i + 1) + "</span>" +
            '<span class="standing-name">' + displayName(r.name) +
              (i === 0 ? '<span class="champ-badge">Champion</span>' : "") + "</span>" +
            '<span class="standing-points">' + fmt(r.points) + "</span>" +
          "</li>"
        );
      }).join("");
      return (
        '<div class="champ-season">' +
          '<div class="champ-season-head"><span>' + site.seasons[idx] + "</span>" +
          '<span class="champ-season-year">' + seasonYear(site.seasons[idx]) + "</span></div>" +
          '<div class="season-panel"><ol class="season-standings">' + rows + "</ol></div>" +
        "</div>"
      );
    }).join("");
  }

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

  function renderFeatureCards(lb, site, gamesData) {
    var host = document.getElementById("feature-cards");
    if (!host) return;
    var ranked = lb.core.slice().sort(function (a, b) { return b.total - a.total; });
    var champMap = computeChampionships(lb, site, gamesData);
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
      var pieBlock = placingPieHTML(p.placings);
      var nChamps = (champMap[name] || []).length;
      var champBtn = '<button type="button" class="champ-btn" data-player="' + name + '">' +
        nChamps + (nChamps === 1 ? " Championship" : " Championships") + "</button>";
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
          pieBlock +
          champBtn +
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
    var gapDone = false;
    tbody.innerHTML = ranked.map(function (p, i) {
      var spacer = "";
      if (!gapDone && THE_FIVE.indexOf(p.name) === -1) {
        spacer = '<tr class="lb-spacer" aria-hidden="true"><td colspan="11"></td></tr>';
        gapDone = true;
      }
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
      return spacer + "<tr" + leader + ">" + cells + "</tr>";
    }).join("");
  }

  function renderOGs(lb, site, playerMeta) {
    var host = document.getElementById("og-cards");
    if (!host) return;
    host.innerHTML = THE_FIVE.map(function (name) {
      var p = null;
      for (var i = 0; i < lb.core.length; i++) if (lb.core[i].name === name) { p = lb.core[i]; break; }
      if (!p) return "";
      var m = metaFor(playerMeta, name);
      var first = m.firstPlayed || firstSeasonFor(site, name);
      return profileCardHTML({
        name: name,
        title: name,
        realName: m.realName,
        meta: first ? "First played " + first : "",
        stats: [
          { v: fmt(p.total), k: "pts" },
          { v: fmt(p.games), k: "games" },
          { v: p.ppg.toFixed(2), k: "ppg" }
        ]
      });
    }).join("");
  }

  function renderPastSeats(lb, site, playerMeta) {
    var host = document.getElementById("seat-cards");
    if (!host) return;
    var seats = lb.core.filter(function (p) { return THE_FIVE.indexOf(p.name) === -1; });
    if (!seats.length) { host.innerHTML = ""; return; }
    host.innerHTML = seats.map(function (p) {
      var era = eraFor(site, p.name);
      var m = metaFor(playerMeta, p.name);
      var note = SEAT_NOTES[p.name] || "";
      return profileCardHTML({
        name: p.name,
        title: displayName(p.name),
        realName: m.realName,
        meta: (note ? note + (era ? " \u00b7 " : "") : "") + (era ? era.label : ""),
        stats: [
          { v: fmt(p.total), k: "pts" },
          { v: fmt(p.games), k: "games" },
          { v: p.ppg.toFixed(2), k: "ppg" }
        ]
      });
    }).join("");
  }

  /* First game a player appears in, at game precision: "SPT 15.5" */
  function firstGameFor(gamesData, site, name) {
    if (!gamesData) return null;
    for (var i = 0; i < site.seasons.length; i++) {
      var s = gamesData[site.seasons[i]];
      if (!s) continue;
      var rows = s.majors.concat(s.subs);
      for (var r = 0; r < rows.length; r++) {
        if (rows[r].name !== name) continue;
        for (var g = 0; g < 10; g++) {
          if (rows[r].pts[g] !== null) {
            return "SPT " + site.seasons[i].replace(/\D/g, "") + "." + (g + 1);
          }
        }
      }
    }
    return null;
  }

  function renderSubs(lb, site, playerMeta, gamesData) {
    var host = document.getElementById("sub-cards");
    if (!host) return;
    var subs = lb.subs.slice().sort(function (a, b) { return b.total - a.total || b.games - a.games; });
    host.innerHTML = subs.map(function (p) {
      var m = metaFor(playerMeta, p.name);
      var first = m.firstPlayed || firstGameFor(gamesData, site, p.name) || firstSeasonFor(site, p.name);
      return profileCardHTML({
        name: p.name,
        title: p.name,
        realName: m.realName,
        meta: first ? "First played " + first : "",
        stats: [
          { v: fmt(p.total), k: "pts" },
          { v: fmt(p.games), k: p.games === 1 ? "game" : "games" }
        ]
      });
    }).join("");
  }

  /* ------------------------------------------------------------------
     GAMES tab — every season sheet stacked: SEASON | LABEL | G1…G10.
     Rows are identified by their label (Round Name, Location, player,
     Substitutes marker), never by position.
     ------------------------------------------------------------------ */
  function parseGames(rows) {
    var bySeason = {};
    var lastSeason = "";
    for (var i = 1; i < rows.length; i++) {
      var rawSeason = (rows[i][0] || "").trim();
      /* The stacking formula only writes the season on each block's
         first row; the rest export as blank or #N/A. Forward-fill. */
      if (rawSeason && rawSeason.indexOf("#") !== 0) lastSeason = rawSeason;
      var season = lastSeason;
      if (!season) continue;
      var label = (rows[i][1] || "").trim();
      var cells = rows[i].slice(2, 12);
      if (!bySeason[season]) {
        bySeason[season] = { names: [], venues: [], majors: [], subs: [], pastMarker: false };
      }
      var s = bySeason[season];
      if (!label) continue;
      if (/^round no\.?$/i.test(label)) continue;
      if (/^round name$/i.test(label)) { s.names = cells.map(function (c) { return String(c || "").replace(/\n/g, " ").trim(); }); continue; }
      if (/^location$/i.test(label)) { s.venues = cells.map(function (c) { return String(c || "").trim(); }); continue; }
      if (/^substitutes?$/i.test(label)) { s.pastMarker = true; continue; }
      var pts = cells.map(function (c) {
        var t = String(c === null || c === undefined ? "" : c).trim();
        return t === "" ? null : num(t);
      });
      var played = pts.some(function (v) { return v !== null; });
      var entry = { name: label, pts: pts };
      if (s.pastMarker) { if (played) s.subs.push(entry); }
      else { if (played) s.majors.push(entry); }
    }
    return bySeason;
  }

  /* When a substitute covers a seat, the databook records the points
     in BOTH rows. A sub whose value duplicates a seat's value in that
     game IS that seat's result — exclude them from the ranking pool
     (and remember the match: it tells us who they played for). Subs
     with a unique value genuinely sat as an extra and stay in. */
  function rankPoolFor(s, gameIdx) {
    var seatVals = {};
    for (var i = 0; i < s.majors.length; i++) {
      var v = s.majors[i].pts[gameIdx];
      if (v !== null) seatVals[v] = true;
    }
    return s.majors.concat(s.subs.filter(function (p) {
      var v = p.pts[gameIdx];
      return v !== null && !seatVals[v];
    }));
  }

  /* Position via competition ranking within a game: 1 + players who
     scored strictly more. Handles ties and any off-scale scores. */
  function positionIn(gameIdx, player, pool) {
    var mine = player.pts[gameIdx];
    if (mine === null) return null;
    var above = 0;
    for (var i = 0; i < pool.length; i++) {
      var v = pool[i].pts[gameIdx];
      if (v !== null && v > mine) above++;
    }
    return above + 1;
  }

  /* Which seat(s) did a sub cover, per game — inferred from the
     duplicated value. Returns [{game, majors:[names]}] */
  function subCoverage(s, subName) {
    var out = [];
    for (var i = 0; i < s.subs.length; i++) {
      if (s.subs[i].name !== subName) continue;
      for (var g = 0; g < 10; g++) {
        var v = s.subs[i].pts[g];
        if (v === null) continue;
        var majors = [];
        for (var m = 0; m < s.majors.length; m++) {
          if (s.majors[m].pts[g] === v) majors.push(s.majors[m].name);
        }
        if (majors.length) out.push({ game: g, majors: majors });
      }
    }
    return out;
  }

  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function renderSeasonGames(gamesData, seasonName) {
    var host = document.getElementById("season-games");
    if (!host) return;
    var s = gamesData && gamesData[seasonName];
    if (!s || !s.majors.length) { host.innerHTML = ""; return; }
    var everyone = s.majors.concat(s.subs);
    // Games that were actually played
    var playedIdx = [];
    for (var g = 0; g < 10; g++) {
      if (everyone.some(function (p) { return p.pts[g] !== null; })) playedIdx.push(g);
    }
    var pools = {};
    playedIdx.forEach(function (g) { pools[g] = rankPoolFor(s, g); });
    if (!playedIdx.length) { host.innerHTML = ""; return; }

    var head = "<tr><th scope=\"col\" class=\"game-meta-h\">Game</th>" +
      s.majors.map(function (p) {
        return '<th scope="col">' + displayName(p.name) + "</th>";
      }).join("") + "</tr>";

    var body = playedIdx.map(function (g) {
      var name = s.names[g] || "";
      var venue = s.venues[g] || "";
      var seasonNo = seasonName.replace(/\D/g, "");
      var folder = seasonNo + "." + (g + 1);
      var meta = '<th scope="row" class="game-meta">' +
        '<span class="game-no">' + (g + 1) + "</span>" +
        '<span class="game-name">' + name + "</span>" +
        (venue ? '<span class="game-venue">' + venue + "</span>" : "") +
        '<button type="button" class="pics-btn" data-folder="' + folder + '"' +
        ' data-title="' + seasonName + " \u00b7 Game " + (g + 1) + (name ? " \u00b7 " + name : "") + '">' +
        "View pics</button>" +
        "</th>";
      var cells = s.majors.map(function (p) {
        var attrs = ' data-major="' + p.name + '" data-game="' + g + '"';
        var pos = positionIn(g, p, pools[g]);
        if (pos === null) return '<td class="pos-cell pos-none"' + attrs + ">\u2014</td>";
        return '<td class="pos-cell pos-' + Math.min(pos, 6) + '"' + attrs + ">" +
          '<span class="pos-ord">' + ordinal(pos) + "</span>" +
          '<span class="pos-pts">' + fmt(p.pts[g]) + " pts</span>" +
          "</td>";
      }).join("");
      // Guest / sub appearances in this game, shown under the grid row? No —
      // keep the grid majors-only; subs get their own list below.
      return "<tr>" + meta + cells + "</tr>";
    }).join("");

    host.innerHTML =
      '<div class="table-wrap games-wrap"><table class="games-table">' +
      "<thead>" + head + "</thead><tbody>" + body + "</tbody></table></div>";
    refreshPicsButtons();
  }

  /* ------------------------------------------------------------------
     Season tally — majors only, ranked; subs listed separately below.
     Majors = the leaderboard's core seats (The Five + Phantom + Joker
     Seat), whoever of them scored that season.
     ------------------------------------------------------------------ */
  function standingsFor(site, seasonIdx) {
    var rows = [];
    for (var i = 0; i < site.players.length; i++) {
      var p = site.players[i];
      var pts = p.seasons[seasonIdx];
      if (pts > 0) rows.push({ name: p.name, points: pts });
    }
    rows.sort(function (a, b) { return b.points - a.points; });
    return rows;
  }

  var currentSubCoverage = {};

  function renderSeasonStandings(lb, site, seasonIdx, gamesData) {
    var host = document.getElementById("season-standings");
    var subsBlock = document.getElementById("season-subs-block");
    var subsHost = document.getElementById("season-subs");
    if (!host) return;
    var coreNames = lb.core.map(function (p) { return p.name; });
    var all = standingsFor(site, seasonIdx);
    var subs = [];
    var seenCore = {};
    for (var i = 0; i < all.length; i++) {
      var isCore = coreNames.indexOf(all[i].name) !== -1 && !seenCore[all[i].name];
      if (isCore) { seenCore[all[i].name] = true; }
      else subs.push(all[i]);
    }
    var majors = majorsStandingsFor(lb, site, seasonIdx, gamesData).rows;
    var isCurrent = seasonIdx === site.seasons.length - 1;
    if (!majors.length) {
      host.innerHTML = '<li class="loading-note">No results on the board for ' +
        site.seasons[seasonIdx] + " yet.</li>";
    } else {
      host.innerHTML = majors.map(function (r, i) {
        var isTop = i === 0;
        var badge = isTop
          ? '<span class="champ-badge">' + (isCurrent ? "Leading" : "Champion") + "</span>"
          : "";
        return (
          '<li class="standing-row' + (isTop ? " is-champ" : "") + '">' +
            '<span class="standing-rank">' + (i + 1) + "</span>" +
            '<span class="standing-name">' + displayName(r.name) + badge + "</span>" +
            '<span class="standing-points">' + fmt(r.points) + "</span>" +
          "</li>"
        );
      }).join("");
    }
    /* Coverage map: which seat each sub played for (per game),
       inferred from the games data. Clickable when known. */
    currentSubCoverage = {};
    var seasonGames = gamesData && gamesData[site.seasons[seasonIdx]];
    if (seasonGames) {
      subs.forEach(function (r) {
        var cov = subCoverage(seasonGames, r.name);
        if (cov.length) currentSubCoverage[r.name] = cov;
      });
    }
    if (subsBlock && subsHost) {
      if (subs.length) {
        subsBlock.hidden = false;
        subsHost.innerHTML = subs.map(function (r) {
          var clickable = !!currentSubCoverage[r.name];
          return (
            '<li class="standing-row standing-sub' + (clickable ? " standing-click" : "") + '"' +
              (clickable ? ' data-sub="' + r.name + '" role="button" tabindex="0" aria-pressed="false"' +
                ' title="Show the seat ' + r.name + ' played for"' : "") + ">" +
              '<span class="standing-rank">\u00b7</span>' +
              '<span class="standing-name">' + r.name + "</span>" +
              '<span class="standing-points">' + fmt(r.points) + "</span>" +
            "</li>"
          );
        }).join("");
      } else {
        subsBlock.hidden = true;
        subsHost.innerHTML = "";
      }
    }
  }

  function clearSubHighlights() {
    var cells = document.querySelectorAll(".pos-cell.cell-hint");
    for (var i = 0; i < cells.length; i++) cells[i].classList.remove("cell-hint");
    var rows = document.querySelectorAll('.standing-click[aria-pressed="true"]');
    for (var j = 0; j < rows.length; j++) rows[j].setAttribute("aria-pressed", "false");
  }

  function toggleSubHighlight(row) {
    var name = row.getAttribute("data-sub");
    var wasOn = row.getAttribute("aria-pressed") === "true";
    clearSubHighlights();
    if (wasOn) return;
    row.setAttribute("aria-pressed", "true");
    var cov = currentSubCoverage[name] || [];
    cov.forEach(function (c) {
      c.majors.forEach(function (m) {
        var cell = document.querySelector(
          '.pos-cell[data-major="' + m + '"][data-game="' + c.game + '"]');
        if (cell) cell.classList.add("cell-hint");
      });
    });
  }

  document.addEventListener("click", function (e) {
    var row = e.target.closest(".standing-click");
    if (row) toggleSubHighlight(row);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var row = e.target.closest ? e.target.closest(".standing-click") : null;
    if (row) { e.preventDefault(); toggleSubHighlight(row); }
  });

  /* Season Positions — every season's final tally in one matrix.
     Rows = seasons (with year), columns = the majors. Champions of
     completed seasons take the blue; the live season stays neutral. */
  function renderSeasonMatrix(lb, site, gamesData) {
    var table = document.getElementById("history-table");
    if (!table) return;
    var majors = lb.core; // databook order: the five, Phantom, Joker
    var head = "<tr><th scope=\"col\" class=\"game-meta-h\">Season</th>" +
      majors.map(function (p) { return '<th scope="col">' + displayName(p.name) + "</th>"; }).join("") +
      "</tr>";
    var coreNames = majors.map(function (p) { return p.name; });
    var latest = site.seasons.length - 1;

    var rows = site.seasons.map(function (seasonName, idx) {
      var st = majorsStandingsFor(lb, site, idx, gamesData);
      var standings = st.rows;
      var byName = {};
      standings.forEach(function (r) {
        var above = standings.filter(function (o) {
          return countbackCompare(o, r, st.counts) < 0;
        }).length;
        byName[r.name] = { pos: above + 1, points: r.points };
      });
      var isCurrent = idx === latest;
      var meta = '<th scope="row" class="game-meta">' +
        '<span class="game-name">' + seasonName + "</span>" +
        '<span class="game-venue">' + seasonYear(seasonName) +
          (isCurrent ? " \u00b7 in progress" : "") + "</span>" +
        "</th>";
      var cells = majors.map(function (p) {
        var r = byName[p.name];
        if (!r) return '<td class="pos-cell pos-none">\u2014</td>';
        var cls = r.pos === 1 && !isCurrent ? "pos-1" : "pos-" + Math.min(r.pos, 6);
        if (r.pos === 1 && isCurrent) cls = "pos-2"; // leading, not yet champion
        return '<td class="pos-cell ' + cls + '">' +
          '<span class="pos-ord">' + ordinal(r.pos) + "</span>" +
          '<span class="pos-pts">' + fmt(r.points) + " pts</span>" +
          "</td>";
      }).join("");
      return "<tr>" + meta + cells + "</tr>";
    }).join("");

    table.innerHTML = "<thead>" + head + "</thead><tbody>" + rows + "</tbody>";
  }

  /* Composite rounds — all-time points per round number, straight
     from the databook's per-round columns. Best total in each round
     takes the blue. */
  function renderRoundMatrix(lb) {
    var table = document.getElementById("rounds-table");
    if (!table) return;
    var majors = lb.core;
    var head = "<tr><th scope=\"col\" class=\"game-meta-h\">Round</th>" +
      majors.map(function (p) { return '<th scope="col">' + displayName(p.name) + "</th>"; }).join("") +
      "</tr>";
    var rows = "";
    for (var r = 0; r < 10; r++) {
      var best = Math.max.apply(null, majors.map(function (p) { return p.rounds[r].tp; }));
      var meta = '<th scope="row" class="game-meta">' +
        '<span class="game-name">Round ' + (r + 1) + "</span>" +
        "</th>";
      var cells = majors.map(function (p) {
        var d = p.rounds[r];
        if (!d.tp && !d.w) return '<td class="pos-cell pos-none">\u2014</td>';
        var isBest = d.tp === best && best > 0;
        return '<td class="pos-cell' + (isBest ? " round-best" : "") + '">' +
          '<span class="pos-ord">' + fmt(d.tp) + "</span>" +
          '<span class="pos-pts">' + fmt(d.w) + (d.w === 1 ? " win" : " wins") + "</span>" +
          "</td>";
      }).join("");
      rows += "<tr>" + meta + cells + "</tr>";
    }
    table.innerHTML = "<thead>" + head + "</thead><tbody>" + rows + "</tbody>";
  }

  function renderSeasons(lb, site, gamesData) {
    var pillsHost = document.getElementById("season-pills");
    if (!pillsHost) return;
    var latest = site.seasons.length - 1;

    function show(idx) {
      var pills = pillsHost.querySelectorAll(".season-cell");
      for (var i = 0; i < pills.length; i++) {
        pills[i].setAttribute("aria-pressed",
          parseInt(pills[i].getAttribute("data-season"), 10) === idx ? "true" : "false");
      }
      var yearEl = document.getElementById("season-year");
      if (yearEl) {
        var no = parseInt(site.seasons[idx].replace(/\D/g, ""), 10);
        yearEl.textContent = no ? String(2004 + no) : "";
      }
      renderSeasonGames(gamesData, site.seasons[idx]);
      renderSeasonStandings(lb, site, idx, gamesData);
    }

    pillsHost.innerHTML = '<span class="season-grid-label">SPT</span>' +
      site.seasons.map(function (s, i) {
        var short = s.replace(/^SPT/i, "");
        return '<button type="button" class="season-cell" data-season="' + i + '"' +
          ' aria-label="' + s + '" aria-pressed="' + (i === latest ? "true" : "false") + '">' +
          short + "</button>";
      }).join("");

    pillsHost.addEventListener("click", function (e) {
      var btn = e.target.closest(".season-cell");
      if (!btn) return;
      show(parseInt(btn.getAttribute("data-season"), 10));
    });

    show(latest);
  }

  /* ------------------------------------------------------------------
     Photo gallery — lists images/{season}.{game}/ from the GitHub repo
     via the contents API, with optional captions.json in each folder
     mapping filename -> caption. Results are cached per session.
     ------------------------------------------------------------------ */
  var galleryCache = {};

  function fetchGallery(folder) {
    if (galleryCache[folder]) return galleryCache[folder];
    if (repoIndex) {
      var files = repoIndex[folder] || [];
      var images = files.filter(function (n) { return IMG_EXT.test(n); })
        .sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); })
        .map(function (n) {
          return { name: n, download_url: RAW_BASE + "images/" + folder + "/" + encodeURIComponent(n) };
        });
      var hasCaps = files.indexOf("captions.json") !== -1;
      galleryCache[folder] = (hasCaps
        ? fetch(RAW_BASE + "images/" + folder + "/captions.json")
            .then(function (r) { return r.ok ? r.json() : {}; })
            .catch(function () { return {}; })
        : Promise.resolve({})
      ).then(function (caps) { return { images: images, captions: caps || {} }; });
      return galleryCache[folder];
    }
    var apiUrl = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO +
      "/contents/images/" + encodeURIComponent(folder) + "?ref=" + GITHUB_BRANCH;
    galleryCache[folder] = fetch(apiUrl)
      .then(function (res) {
        if (res.status === 404) return [];
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (items) {
        if (!Array.isArray(items)) return { images: [], captions: {} };
        var images = items.filter(function (f) {
          return f.type === "file" && /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name);
        }).sort(function (a, b) {
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        });
        var capFile = items.filter(function (f) { return f.name === "captions.json"; })[0];
        if (!capFile) return { images: images, captions: {} };
        return fetch(capFile.download_url)
          .then(function (r) { return r.ok ? r.json() : {}; })
          .catch(function () { return {}; })
          .then(function (caps) { return { images: images, captions: caps || {} }; });
      })
      .catch(function () {
        delete galleryCache[folder]; // allow retry
        return null;
      });
    return galleryCache[folder];
  }

  function ensureModal() {
    var modal = document.getElementById("pics-modal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "pics-modal";
    modal.className = "pics-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML =
      '<div class="pics-backdrop" data-close></div>' +
      '<div class="pics-panel">' +
        '<header class="pics-head">' +
          '<h3 class="pics-title" id="pics-title"></h3>' +
          '<button type="button" class="pics-close" data-close aria-label="Close">\u00d7</button>' +
        "</header>" +
        '<div class="pics-body" id="pics-body"></div>' +
      "</div>";
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) {
      if (e.target.hasAttribute("data-close")) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
    return modal;
  }

  function closeModal() {
    var modal = document.getElementById("pics-modal");
    if (modal) {
      modal.classList.remove("is-open");
      document.body.style.overflow = "";
    }
  }

  function openGallery(folder, title) {
    var modal = ensureModal();
    var body = document.getElementById("pics-body");
    document.getElementById("pics-title").textContent = title;
    body.innerHTML = '<p class="pics-note">Fetching photos\u2026</p>';
    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";

    if (GITHUB_OWNER.indexOf("PASTE") === 0) {
      body.innerHTML = '<p class="pics-note">Photo repository not connected yet.</p>';
      return;
    }

    fetchGallery(folder).then(function (data) {
      if (data === null) {
        body.innerHTML = '<p class="pics-note">Couldn\u2019t reach the photo repository. Try again in a minute.</p>';
        return;
      }
      if (!data.images || !data.images.length) {
        body.innerHTML = '<p class="pics-note">No photos for this one yet. ' +
          "Drop some into <code>images/" + folder + "/</code> in the repo.</p>";
        return;
      }
      body.innerHTML = data.images.map(function (img) {
        var cap = data.captions[img.name] || "";
        return (
          '<figure class="pics-item">' +
            '<img src="' + img.download_url + '" alt="' + (cap || img.name) + '" loading="lazy">' +
            (cap ? "<figcaption>" + cap + "</figcaption>" : "") +
          "</figure>"
        );
      }).join("");
    });
  }

  var bootData = null;

  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".champ-btn");
    if (!btn || !bootData) return;
    openChampionships(btn.getAttribute("data-player"), bootData.lb, bootData.site, bootData.gamesData);
  });

  /* Theme toggle — light/dark, remembered between visits */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".theme-toggle");
    if (!btn) return;
    var el = document.documentElement;
    var next = el.getAttribute("data-theme") === "light" ? "dark" : "light";
    el.setAttribute("data-theme", next);
    try { localStorage.setItem("spt-theme", next); } catch (err) {}
  });

  /* One delegated listener covers every View Pics button, including
     buttons re-rendered on season switch. */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".pics-btn");
    if (!btn) return;
    openGallery(btn.getAttribute("data-folder"), btn.getAttribute("data-title"));
  });

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

  var gamesFetch = GAMES_GID.indexOf("PASTE") === 0
    ? Promise.resolve(null)
    : fetchCSV(URL_GAMES).catch(function () { return null; });

  var metaFetch = fetch(URL_PLAYER_META)
    .then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; });

  Promise.all([fetchCSV(URL_LEADERBOARD), fetchCSV(URL_SITE), gamesFetch, metaFetch])
    .then(function (results) {
      var lb = parseLeaderboard(results[0]);
      var site = parseSite(results[1]);
      var gamesData = results[2] ? parseGames(results[2]) : null;
      var playerMeta = results[3] || {};
      bootData = { lb: lb, site: site, gamesData: gamesData };
      var page = document.body.getAttribute("data-page");
      if (page === "dashboard") {
        renderHeroStats(lb, site);
        renderFeatureCards(lb, site, gamesData);
        renderLeaderboardTable(lb, site);
        renderSeasons(lb, site, gamesData);
        renderSeasonMatrix(lb, site, gamesData);
        renderRoundMatrix(lb);
      } else if (page === "players") {
        renderOGs(lb, site, playerMeta);
        renderPastSeats(lb, site, playerMeta);
        renderSubs(lb, site, playerMeta, gamesData);
      }
    })
    .catch(function (err) {
      console.error("SPT data load failed:", err);
      showError("(" + err.message + ")");
    });
})();
