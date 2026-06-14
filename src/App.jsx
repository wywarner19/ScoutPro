import { useState, useCallback, useRef, useEffect } from "react";

// ── Design tokens ──────────────────────────────────────────────
const C = {
  bg:        "#0a0e14",
  surface:   "#111822",
  card:      "#161f2e",
  border:    "#1e2d42",
  accent:    "#e8312a",   // MLB red
  accentDim: "#7a1a16",
  gold:      "#f5c518",
  text:      "#e8edf4",
  muted:     "#5a7490",
  green:     "#22c55e",
  blue:      "#3b82f6",
  zone: {
    ball:    "#1e3a5f",
    strike:  "#5a1a14",
    hit:     "#1a4a1a",
    out:     "#2a1a2a",
  }
};

const PITCH_TYPES = ["FB","CB","SL","CH","Other"];
const PITCH_COLORS = { FB:"#e8312a", CB:"#3b82f6", SL:"#22c55e", CH:"#f5c518", Other:"#a855f7" };
const RESULTS = ["Strike","Ball","Foul","HBP","In Play"];
const RESULT_COLORS = { Strike:"#e8312a", Ball:"#3b82f6", Foul:"#f5c518", HBP:"#a855f7", "In Play":"#22c55e" };
const AB_OUTCOMES = ["Single","Double","Triple","HR","Walk","HBP","K","K-L","Ground Out","Fly Out","Line Out","FC","Error","Sac Bunt","Sac Fly"];
const ZONES = [1,2,3,4,5,6,7,8,9]; // 3x3 grid, 1=top-left, 5=middle, 9=bot-right

// Zone positions for the 3x3 grid
const ZONE_LABELS = {
  1:"TL", 2:"TM", 3:"TR",
  4:"ML", 5:"MM", 6:"MR",
  7:"BL", 8:"BM", 9:"BR"
};

// Field zones for spray chart (polar-ish sectors)
const FIELD_ZONES = ["LF","LCF","CF","RCF","RF","Infield"];

// ── Local Storage helpers ───────────────────────────────────────
const save = (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) {} };
const load = (key, def) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch(e) { return def; } };

// ── Supabase config ─────────────────────────────────────────────
const SUPABASE_URL = "https://kxrgzzbozuhkiokkzgxi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_QP3Lgylvv3RhLhTpPqnoqg_xhR5wj30";
const SB_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

async function sbFetchTeams() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/scout_teams?select=*`, { headers: SB_HEADERS });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return res.json(); // [{ id, name, data, updated_at }]
}
async function sbUpsertTeam(team) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/scout_teams?on_conflict=id`, {
    method: "POST",
    headers: { ...SB_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: team.id, name: team.name, data: team }),
  });
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
}
async function sbDeleteTeam(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/scout_teams?id=eq.${id}`, {
    method: "DELETE", headers: SB_HEADERS,
  });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

async function sbFetchGames() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/scout_games?select=*`, { headers: SB_HEADERS });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return res.json(); // [{ id, data, updated_at }]
}
async function sbUpsertGame(game) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/scout_games?on_conflict=id`, {
    method: "POST",
    headers: { ...SB_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: game.id, data: game }),
  });
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
}
async function sbDeleteGame(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/scout_games?id=eq.${id}`, {
    method: "DELETE", headers: SB_HEADERS,
  });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

// ── ID generator ───────────────────────────────────────────────
let _id = Date.now();
const uid = () => (++_id).toString(36);

// ── App Mode: "live" (synced to your Supabase) vs "sandbox" (local-only, demo data) ──
const LIVE_PASSCODE = "9833";

const getInitialMode = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "live") {
      localStorage.setItem("scout_mode", "live");
      return "live";
    }
    return localStorage.getItem("scout_mode") || "sandbox";
  } catch (e) { return "sandbox"; }
};
const teamsKey = (mode) => mode==="live" ? "scout_teams" : "sandbox_scout_teams";
const gamesKey = (mode) => mode==="live" ? "scout_games" : "sandbox_scout_games";

// ── Sandbox demo data ───────────────────────────────────────────
const makeDemoTeams = () => {
  const blankProfile = () => ({ willSteal:"No", willBunt:"No", firstPitchSwinger:"No", putAwayPitch:"FB", sprayTend:"Pull", baseRunningNotes:"", scoutNotes:"" });
  const pitch = (type, zone, result) => ({ id: uid(), type, zone, result });

  const jake = {
    id: uid(), name:"Jake Torres", number:"7", bats:"L", order:"3", gradYear:"2026",
    profile: {
      willSteal:"Maybe", willBunt:"No", firstPitchSwinger:"Yes", putAwayPitch:"FB", sprayTend:"Pull",
      baseRunningNotes:"Average speed. Won't run much unless given a big jump.",
      scoutNotes:"Pulls almost everything — sits on fastballs early in the count and yanks them to right field. Vulnerable to soft stuff away, especially changeups down and away. Will chase a get-me-over breaking ball if behind in the count."
    },
    seasonStats: { avg:".342", ab:"76", h:"26", "2b":"6", "3b":"1", hr:"4", rbi:"22", bb:"10", k:"14", sb:"3", obp:".410", slg:".566", source:"MaxPreps", importedAt: Date.now() },
    abs: [
      { id: uid(), inning:1, outcome:"Double", fieldZone:"RF", pitches:[ pitch("FB",5,"In Play") ], createdAt: Date.now() },
      { id: uid(), inning:3, outcome:"K", fieldZone:null, pitches:[ pitch("FB",2,"Strike"), pitch("CH",9,"Strike"), pitch("CH",9,"Strike") ], createdAt: Date.now() },
      { id: uid(), inning:5, outcome:"Ground Out", fieldZone:"Infield", pitches:[ pitch("FB",4,"Foul"), pitch("SL",6,"In Play") ], createdAt: Date.now() },
    ],
    createdAt: Date.now()
  };

  const marcus = {
    id: uid(), name:"Marcus Webb", number:"14", bats:"R", order:"4", gradYear:"2026",
    profile: {
      willSteal:"No", willBunt:"No", firstPitchSwinger:"No", putAwayPitch:"SL", sprayTend:"All Fields",
      baseRunningNotes:"Below average speed, station-to-station runner.",
      scoutNotes:"Balanced approach, sprays the ball to all fields with occasional pop to the gaps. Takes a lot of pitches and works deep counts. Put-away pitch is a backdoor slider — he'll take it for a strike more often than not."
    },
    seasonStats: { avg:".298", ab:"81", h:"24", "2b":"5", "3b":"0", hr:"3", rbi:"19", bb:"15", k:"18", sb:"1", obp:".398", slg:".457", source:"MaxPreps", importedAt: Date.now() },
    abs: [
      { id: uid(), inning:1, outcome:"Walk", fieldZone:null, pitches:[ pitch("FB",1,"Ball"), pitch("SL",3,"Ball"), pitch("FB",7,"Strike"), pitch("CH",1,"Ball"), pitch("SL",2,"Ball") ], createdAt: Date.now() },
      { id: uid(), inning:4, outcome:"Single", fieldZone:"CF", pitches:[ pitch("FB",5,"Foul"), pitch("FB",5,"In Play") ], createdAt: Date.now() },
      { id: uid(), inning:6, outcome:"Fly Out", fieldZone:"LF", pitches:[ pitch("SL",8,"Strike"), pitch("SL",8,"In Play") ], createdAt: Date.now() },
    ],
    createdAt: Date.now()
  };

  const diego = {
    id: uid(), name:"Diego Ramirez", number:"2", bats:"R", order:"1", gradYear:"2027",
    profile: {
      willSteal:"Yes", willBunt:"Occasional", firstPitchSwinger:"No", putAwayPitch:"CH", sprayTend:"Oppo",
      baseRunningNotes:"Plus speed — legitimate stolen base threat anytime he's on. Goes early in the count, doesn't need a big lead.",
      scoutNotes:"Slap-and-go approach, looks to go the other way and beat out infield hits. Will bunt for a hit against a slow-footed corner infield. First pitch is almost always a take. Chases changeups down in the zone."
    },
    seasonStats: { avg:".315", ab:"89", h:"28", "2b":"3", "3b":"2", hr:"0", rbi:"11", bb:"12", k:"9", sb:"18", obp:".403", slg:".382", source:"MaxPreps", importedAt: Date.now() },
    abs: [
      { id: uid(), inning:1, outcome:"Single", fieldZone:"RF", pitches:[ pitch("FB",4,"Ball"), pitch("CH",6,"In Play") ], createdAt: Date.now() },
      { id: uid(), inning:3, outcome:"Sac Bunt", fieldZone:"Infield", pitches:[ pitch("FB",1,"In Play") ], createdAt: Date.now() },
      { id: uid(), inning:5, outcome:"K", fieldZone:null, pitches:[ pitch("FB",2,"Ball"), pitch("CH",8,"Strike"), pitch("CH",9,"Strike"), pitch("CH",9,"Strike") ], createdAt: Date.now() },
    ],
    createdAt: Date.now()
  };

  return [{
    id: uid(),
    name: "Sandbox High School",
    players: [diego, jake, marcus],
    createdAt: Date.now()
  }];
};

// ══════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════
export default function App() {
  const [mode, setMode] = useState(getInitialMode); // "live" | "sandbox"
  const isLive = mode === "live";
  const [teams, setTeams] = useState(() => {
    const stored = load(teamsKey(mode), null);
    if (stored) return stored;
    return mode==="live" ? [] : makeDemoTeams();
  });
  const [games, setGames] = useState(() => load(gamesKey(mode), []));
  const [view, setView] = useState("home"); // home | team | player | live | report | gamesetup | livegame
  const [activeTeamId, setActiveTeamId] = useState(null);
  const [activePlayerId, setActivePlayerId] = useState(null);
  const [activeABId, setActiveABId] = useState(null);
  const [activeGameId, setActiveGameId] = useState(null);
  const [gameFlow, setGameFlow] = useState(null); // { gameId, side } while tracking an AB from Live Game
  const [reportPlayerIds, setReportPlayerIds] = useState(null); // null = all players, array = filtered subset for a custom report
  const [modal, setModal] = useState(null); // "addTeam"|"addPlayer"|"addAB"|"startGame"
  const [syncStatus, setSyncStatus] = useState("connecting"); // connecting | synced | syncing | offline | error
  const syncTimers = useRef({});

  const persistGames = (newGames, changedGameId) => {
    setGames(newGames);
    save(gamesKey(mode), newGames);
    if (changedGameId && isLive) {
      const game = newGames.find(g => g.id === changedGameId);
      const key = `game_${changedGameId}`;
      if (syncTimers.current[key]) clearTimeout(syncTimers.current[key]);
      setSyncStatus("syncing");
      syncTimers.current[key] = setTimeout(async () => {
        try {
          if (game) await sbUpsertGame(game);
          setSyncStatus("synced");
        } catch (e) {
          setSyncStatus("error");
        }
      }, 700);
    }
  };

  // ── Initial cloud load (runs once, live mode only) ──────────────
  useEffect(() => {
    if (!isLive) { setSyncStatus("sandbox"); return; }
    (async () => {
      try {
        const [teamRows, gameRows] = await Promise.all([sbFetchTeams(), sbFetchGames()]);
        if (teamRows && teamRows.length > 0) {
          const cloudTeams = teamRows.map(r => r.data);
          setTeams(cloudTeams);
          save("scout_teams", cloudTeams);
        } else if (teams.length > 0) {
          // Local data exists but cloud is empty — push it up
          for (const t of teams) await sbUpsertTeam(t);
        }
        if (gameRows && gameRows.length > 0) {
          const cloudGames = gameRows.map(r => r.data);
          setGames(cloudGames);
          save("scout_games", cloudGames);
        } else if (games.length > 0) {
          for (const g of games) await sbUpsertGame(g);
        }
        setSyncStatus("synced");
      } catch (e) {
        setSyncStatus("offline");
      }
    })();
  }, []);

  const persist = (newTeams, changedTeamId) => {
    setTeams(newTeams);
    save(teamsKey(mode), newTeams);
    if (changedTeamId && isLive) {
      const team = newTeams.find(t => t.id === changedTeamId);
      if (syncTimers.current[changedTeamId]) clearTimeout(syncTimers.current[changedTeamId]);
      setSyncStatus("syncing");
      syncTimers.current[changedTeamId] = setTimeout(async () => {
        try {
          if (team) await sbUpsertTeam(team);
          setSyncStatus("synced");
        } catch (e) {
          setSyncStatus("error");
        }
      }, 700);
    }
  };

  const activeTeam   = teams.find(t => t.id === activeTeamId);
  const activePlayer = activeTeam?.players?.find(p => p.id === activePlayerId);
  const activeAB     = activePlayer?.abs?.find(a => a.id === activeABId);
  const activeGame   = games.find(g => g.id === activeGameId);

  // ── CRUD ────────────────────────────────────────────────────
  const addTeam = (name) => {
    const t = { id: uid(), name, players: [], createdAt: Date.now() };
    persist([...teams, t], t.id);
  };
  const addPlayer = (teamId, info) => {
    const p = {
      id: uid(), ...info,
      abs: [],
      profile: { willSteal:"No", willBunt:"No", firstPitchSwinger:"No", putAwayPitch:"FB", sprayTend:"Pull", baseRunningNotes:"", scoutNotes:"" },
      createdAt: Date.now()
    };
    persist(teams.map(t => t.id===teamId ? {...t, players:[...t.players, p]} : t), teamId);
    return p.id;
  };
  const updatePlayerProfile = (teamId, playerId, profile) => {
    persist(teams.map(t => t.id!==teamId ? t : {
      ...t, players: t.players.map(p => p.id!==playerId ? p : { ...p, profile })
    }), teamId);
  };
  // Import season stats from MaxPreps/etc. rows: [{matchId|null, name, number, ...stats}]
  const importStats = (teamId, rows, source) => {
    persist(teams.map(t => {
      if (t.id !== teamId) return t;
      let players = [...t.players];
      rows.forEach(row => {
        const seasonStats = { ...row.stats, source: source||"Imported", importedAt: Date.now() };
        if (row.matchId) {
          players = players.map(p => p.id!==row.matchId ? p : { ...p, seasonStats, name: p.name, number: p.number });
        } else {
          players.push({
            id: uid(), name: row.name||"Unknown", number: row.number||"", bats: row.bats||"R",
            order: row.order||"", gradYear: row.gradYear||"",
            abs: [], seasonStats,
            profile: { willSteal:"No", willBunt:"No", firstPitchSwinger:"No", putAwayPitch:"FB", sprayTend:"Pull", baseRunningNotes:"", scoutNotes:"" },
            createdAt: Date.now()
          });
        }
      });
      return { ...t, players };
    }), teamId);
  };
  const addAB = (teamId, playerId, ab) => {
    const newAB = { id: uid(), ...ab, pitches: [], outcome: null, inning: null, createdAt: Date.now() };
    persist(teams.map(t => t.id!==teamId ? t : {
      ...t, players: t.players.map(p => p.id!==playerId ? p : { ...p, abs:[...p.abs, newAB] })
    }), teamId);
    return newAB.id;
  };
  const addPitch = (teamId, playerId, abId, pitch) => {
    const newPitch = { id: uid(), ...pitch };
    persist(teams.map(t => t.id!==teamId ? t : {
      ...t, players: t.players.map(p => p.id!==playerId ? p : {
        ...p, abs: p.abs.map(a => a.id!==abId ? a : { ...a, pitches:[...a.pitches, newPitch] })
      })
    }), teamId);
  };
  const setABOutcome = (teamId, playerId, abId, outcome, inning, fieldZone) => {
    persist(teams.map(t => t.id!==teamId ? t : {
      ...t, players: t.players.map(p => p.id!==playerId ? p : {
        ...p, abs: p.abs.map(a => a.id!==abId ? a : { ...a, outcome, inning, fieldZone })
      })
    }), teamId);
  };
  const deleteTeam = async (teamId) => {
    // Cancel any pending upsert for this team so it can't recreate the row after deletion
    if (syncTimers.current[teamId]) { clearTimeout(syncTimers.current[teamId]); delete syncTimers.current[teamId]; }
    const next = teams.filter(t => t.id !== teamId);
    setTeams(next);
    save(teamsKey(mode), next);
    if (isLive) {
      setSyncStatus("syncing");
      try {
        await sbDeleteTeam(teamId);
        setSyncStatus("synced");
      } catch (e) {
        setSyncStatus("error");
      }
    }
    // Also remove any games referencing this team
    const remainingGames = games.filter(g => g.teamAId!==teamId && g.teamBId!==teamId);
    if (remainingGames.length !== games.length) {
      setGames(remainingGames);
      save(gamesKey(mode), remainingGames);
      const removed = games.filter(g => g.teamAId===teamId || g.teamBId===teamId);
      for (const g of removed) {
        if (syncTimers.current[`game_${g.id}`]) { clearTimeout(syncTimers.current[`game_${g.id}`]); delete syncTimers.current[`game_${g.id}`]; }
        if (isLive) { try { await sbDeleteGame(g.id); } catch(e){} }
      }
      if (activeGameId && removed.some(g=>g.id===activeGameId)) { setActiveGameId(null); setGameFlow(null); }
    }
  };

  const deletePlayer = (teamId, playerId) => {
    persist(teams.map(t => t.id!==teamId ? t : {
      ...t, players: t.players.filter(p => p.id!==playerId)
    }), teamId);
  };

  const deleteAB = (teamId, playerId, abId) => {
    persist(teams.map(t => t.id!==teamId ? t : {
      ...t, players: t.players.map(p => p.id!==playerId ? p : {
        ...p, abs: p.abs.filter(a => a.id!==abId)
      })
    }), teamId);
  };

  // ── LIVE GAME ──────────────────────────────────────────────
  const startGame = (config) => {
    // config: { mode: "single"|"matchup", teamAId, teamBId, lineupA: [playerId...], lineupB: [playerId...] }
    const g = {
      id: uid(),
      mode: config.mode,
      teamAId: config.teamAId,
      teamBId: config.teamBId || null,
      lineupA: config.lineupA,
      lineupB: config.lineupB || [],
      idxA: 0,
      idxB: 0,
      inning: 1,
      half: config.mode==="matchup" ? "top" : "single",
      battingSide: config.mode==="matchup" ? "B" : "A", // visitors (B) bat first in a matchup
      active: true,
      createdAt: Date.now(),
    };
    persistGames([...games.filter(x=>!x.active), g], g.id); // only one active game at a time
    setActiveGameId(g.id);
    setView("livegame");
  };
  const updateGame = (gameId, patch) => {
    persistGames(games.map(g => g.id!==gameId ? g : { ...g, ...patch }), gameId);
  };
  const advanceLineup = (gameId, side) => {
    const g = games.find(x=>x.id===gameId);
    if (!g) return;
    const key = side==="A" ? "idxA" : "idxB";
    const lineup = side==="A" ? g.lineupA : g.lineupB;
    if (!lineup || lineup.length===0) return;
    updateGame(gameId, { [key]: (g[key]+1) % lineup.length });
  };
  const switchSides = (gameId) => {
    const g = games.find(x=>x.id===gameId);
    if (!g) return;
    if (g.battingSide==="B") updateGame(gameId, { battingSide:"A", half:"bottom" });
    else updateGame(gameId, { battingSide:"B", half:"top", inning: g.inning+1 });
  };
  const subInPlayer = (gameId, side, slotIdx, playerId) => {
    const g = games.find(x=>x.id===gameId);
    if (!g) return;
    const key = side==="A" ? "lineupA" : "lineupB";
    const lineup = [...g[key]];
    lineup[slotIdx] = playerId;
    updateGame(gameId, { [key]: lineup });
  };
  const endGame = (gameId) => {
    persistGames(games.map(g => g.id!==gameId ? g : { ...g, active:false }), gameId);
    setActiveGameId(null);
    setGameFlow(null);
    setView("home");
  };
  const refreshGame = async (gameId) => {
    if (!isLive) return;
    setSyncStatus("syncing");
    try {
      const rows = await sbFetchGames();
      const found = rows.find(r => r.id === gameId);
      if (found) {
        setGames(prev => {
          const next = prev.map(g => g.id === gameId ? found.data : g);
          save("scout_games", next);
          return next;
        });
      }
      setSyncStatus("synced");
    } catch (e) {
      setSyncStatus("error");
    }
  };
  const deleteGame = async (gameId) => {
    if (syncTimers.current[`game_${gameId}`]) { clearTimeout(syncTimers.current[`game_${gameId}`]); delete syncTimers.current[`game_${gameId}`]; }
    const next = games.filter(g => g.id !== gameId);
    setGames(next);
    save(gamesKey(mode), next);
    if (activeGameId === gameId) { setActiveGameId(null); setGameFlow(null); setView("home"); }
    if (isLive) {
      setSyncStatus("syncing");
      try {
        await sbDeleteGame(gameId);
        setSyncStatus("synced");
      } catch (e) {
        setSyncStatus("error");
      }
    }
  };

  // ── NAV ────────────────────────────────────────────────────
  const navTeam       = (id) => { setActiveTeamId(id);   setView("team"); };
  const navPlayer     = (id) => { setActivePlayerId(id);  setView("player"); };
  const navReport     = ()   => setView("report");
  const navTeamReport = (playerIds) => { setReportPlayerIds(playerIds || null); setView("teamreport"); };
  const navLive       = (abId) => { setActiveABId(abId); setView("live"); };
  const navBack       = () => {
    if (view==="live") {
      if (gameFlow) { setGameFlow(null); setActiveABId(null); setView("livegame"); }
      else { setActiveABId(null); setView("player"); }
    }
    else if (view==="player")     { setActivePlayerId(null); setView("team"); }
    else if (view==="team")       { setActiveTeamId(null);   setView("home"); }
    else if (view==="report")     setView("player");
    else if (view==="teamreport") { setReportPlayerIds(null); setView("team"); }
    else if (view==="gamesetup")  setView("home");
    else if (view==="livegame")   { setActiveGameId(null); setGameFlow(null); setView("home"); }
  };

  // Start tracking the current "now batting" player's at-bat from Live Game
  const startGameAB = () => {
    if (!activeGame) return;
    const side   = activeGame.battingSide;
    const teamId = side==="A" ? activeGame.teamAId : activeGame.teamBId;
    const lineup = side==="A" ? activeGame.lineupA : activeGame.lineupB;
    const idx    = side==="A" ? activeGame.idxA    : activeGame.idxB;
    const playerId = lineup[idx];
    if (!teamId || !playerId) return;
    const abId = addAB(teamId, playerId, { inningStart: activeGame.inning });
    setActiveTeamId(teamId);
    setActivePlayerId(playerId);
    setActiveABId(abId);
    setGameFlow({ gameId: activeGame.id, side });
    setView("live");
  };

  return (
    <div style={{ background: C.bg, minHeight:"100vh", color: C.text, fontFamily:"'SF Pro Display',-apple-system,BlinkMacSystemFont,sans-serif", userSelect:"none" }}>
      {/* TOP NAV */}
      <TopBar view={view} team={activeTeam} player={activePlayer} onBack={navBack} onReport={navReport} onTeamReport={navTeamReport} syncStatus={syncStatus} isLive={isLive} onUnlock={()=>setModal("unlock")} />

      {/* VIEWS */}
      {view==="home"       && (
        <HomeView
          teams={teams} onSelect={navTeam} onAdd={()=>setModal("addTeam")}
          games={games}
          activeGame={games.find(g=>g.active)}
          onResumeGame={(id)=>{ setActiveGameId(id); setView("livegame"); }}
          onStartGame={()=>setModal("startGame")}
          onDeleteGame={deleteGame}
          onDeleteTeam={deleteTeam}
        />
      )}
      {view==="team"       && activeTeam && <TeamView team={activeTeam} onSelect={navPlayer} onAdd={()=>setModal("addPlayer")} onTeamReport={navTeamReport} onImport={()=>setModal("importStats")} onStartGame={()=>setModal("startGame")} onDeletePlayer={(playerId)=>deletePlayer(activeTeam.id, playerId)} />}
      {view==="player"     && activePlayer && activeTeam && (
        <PlayerView
          team={activeTeam} player={activePlayer}
          onUpdateProfile={p => updatePlayerProfile(activeTeam.id, activePlayer.id, p)}
          onStartAB={()=>setModal("addAB")}
          onSelectAB={(abId)=>{ setActiveABId(abId); setView("live"); }}
          onDeleteAB={(abId)=>deleteAB(activeTeam.id, activePlayer.id, abId)}
          onReport={navReport}
        />
      )}
      {view==="live"   && activeAB && activePlayer && activeTeam && (
        <LiveTrackingView
          team={activeTeam} player={activePlayer} ab={activeAB}
          onAddPitch={(p)=>addPitch(activeTeam.id, activePlayer.id, activeAB.id, p)}
          onFinishAB={(outcome, inning, fz)=>{
            setABOutcome(activeTeam.id, activePlayer.id, activeAB.id, outcome, inning, fz);
            if (gameFlow) {
              advanceLineup(gameFlow.gameId, gameFlow.side);
              setGameFlow(null);
              setActiveABId(null);
              setView("livegame");
            } else {
              setView("player");
            }
          }}
        />
      )}
      {view==="report" && activePlayer && activeTeam && (
        <ReportView team={activeTeam} player={activePlayer} onBack={navBack} />
      )}
      {view==="teamreport" && activeTeam && (
        <TeamReportView team={activeTeam} onBack={navBack} onSelectPlayer={(id)=>{ setActivePlayerId(id); setView("player"); }} playerIds={reportPlayerIds} />
      )}
      {view==="livegame" && activeGame && (
        <LiveGameView
          game={activeGame} teams={teams}
          onTrackAB={startGameAB}
          onSwitchSides={()=>switchSides(activeGame.id)}
          onAdvance={(side)=>advanceLineup(activeGame.id, side)}
          onSetIdx={(side, idx)=>updateGame(activeGame.id, side==="A"?{idxA:idx}:{idxB:idx})}
          onSub={(side, slotIdx, playerId)=>subInPlayer(activeGame.id, side, slotIdx, playerId)}
          onAddPlayer={(teamId, info)=>addPlayer(teamId, info)}
          onEndGame={()=>endGame(activeGame.id)}
          onDeleteGame={()=>deleteGame(activeGame.id)}
          onRefresh={()=>refreshGame(activeGame.id)}
          onViewPlayer={(teamId, playerId)=>{ setActiveTeamId(teamId); setActivePlayerId(playerId); setView("player"); }}
        />
      )}

      {/* MODALS */}
      {modal==="addTeam"   && <AddTeamModal   onAdd={(n)=>{ addTeam(n); setModal(null); }}     onClose={()=>setModal(null)} />}
      {modal==="addPlayer" && <AddPlayerModal  onAdd={(info)=>{ addPlayer(activeTeamId, info); setModal(null); }} onClose={()=>setModal(null)} />}
      {modal==="addAB"     && <AddABModal
        onAdd={(ab)=>{
          const abId = addAB(activeTeamId, activePlayerId, ab);
          setModal(null);
          setTimeout(()=>navLive(abId), 50);
        }}
        onClose={()=>setModal(null)}
      />}
      {modal==="importStats" && activeTeam && (
        <ImportStatsModal
          existingPlayers={activeTeam.players||[]}
          onImport={(rows, source)=>{ importStats(activeTeam.id, rows, source); setModal(null); }}
          onClose={()=>setModal(null)}
        />
      )}
      {modal==="startGame" && (
        <StartGameModal
          teams={teams}
          defaultTeamId={activeTeamId}
          onStart={(config)=>{ startGame(config); setModal(null); }}
          onClose={()=>setModal(null)}
        />
      )}
      {modal==="unlock" && (
        <UnlockModal
          onUnlock={()=>{
            try { localStorage.setItem("scout_mode", "live"); } catch(e) {}
            window.location.reload();
          }}
          onClose={()=>setModal(null)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TOP BAR
// ══════════════════════════════════════════════════════════════
function TopBar({ view, team, player, onBack, onReport, onTeamReport, syncStatus, isLive, onUnlock }) {
  const canReport     = view==="player";
  const canTeamReport = view==="team";
  const syncInfo = {
    connecting: { icon:"☁️", label:"Connecting…", color:C.muted },
    synced:     { icon:"☁️", label:"Synced",      color:C.green },
    syncing:    { icon:"⏳", label:"Saving…",     color:C.gold },
    offline:    { icon:"📴", label:"Offline (local only)", color:C.muted },
    error:      { icon:"⚠️", label:"Sync error — saved locally", color:C.accent },
    sandbox:    { icon:"🏖️", label:"Sandbox · not saved to cloud", color:C.gold },
  }[syncStatus] || { icon:"☁️", label:"", color:C.muted };
  return (
    <div style={{ background: C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 20px", height:56, display:"flex", alignItems:"center", gap:12, position:"sticky", top:0, zIndex:100 }}>
      {/* Logo */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginRight:8 }}>
        <div style={{ width:28, height:28, borderRadius:6, background:`linear-gradient(135deg,${C.accent},${C.accentDim})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:900 }}>⚾</div>
        <span style={{ fontSize:13, fontWeight:800, letterSpacing:2, color:C.text, textTransform:"uppercase" }}>ScoutPro</span>
      </div>

      {view!=="home" && (
        <button onClick={onBack} style={btnStyle({ bg:"transparent", color:C.muted, padding:"6px 10px" })}>
          ← Back
        </button>
      )}

      {/* Breadcrumb */}
      <div style={{ flex:1, display:"flex", alignItems:"center", gap:6, fontSize:13, color:C.muted, overflow:"hidden" }}>
        {view==="livegame" && <span style={{ color:C.gold, fontWeight:700 }}>🎮 Live Game</span>}
        {team && <><span style={{ color:C.text, fontWeight:600 }}>{team.name}</span></>}
        {player && <><span>›</span><span style={{ color:C.gold, fontWeight:700 }}>#{player.number} {player.name}</span></>}
      </div>

      {/* Sync status */}
      <div onClick={!isLive ? onUnlock : undefined} title={!isLive ? "Tap to sync to live cloud account" : syncInfo.label}
        style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:syncInfo.color, fontWeight:600, padding:"4px 10px", borderRadius:20, border:`1px solid ${syncInfo.color}33`, whiteSpace:"nowrap", cursor: !isLive ? "pointer" : "default" }}>
        <span style={{ fontSize:13 }}>{syncInfo.icon}</span>
        <span>{syncInfo.label}</span>
      </div>

      {canTeamReport && (
        <button onClick={onTeamReport} style={btnStyle({ bg:C.blue, color:"#fff", padding:"8px 16px", fontSize:12, fontWeight:700 })}>
          📋 Game Day Sheet
        </button>
      )}
      {canReport && (
        <button onClick={onReport} style={btnStyle({ bg:C.accent, color:"#fff", padding:"8px 16px", fontSize:12, fontWeight:700 })}>
          📊 Scout Card
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// HOME VIEW
// ══════════════════════════════════════════════════════════════
function HomeView({ teams, onSelect, onAdd, games, activeGame, onResumeGame, onStartGame, onDeleteGame }) {
  const [confirmDelete, setConfirmDelete] = useState(null); // gameId
  const pastGames = (games||[]).filter(g=>!g.active).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  return (
    <div style={{ maxWidth:900, margin:"0 auto", padding:"32px 20px" }}>
      {activeGame && (
        <div style={{ ...cardStyle(), marginBottom:20, display:"flex", alignItems:"center", gap:14, border:`1px solid ${C.gold}55`, background:`${C.gold}11` }}>
          <div onClick={()=>onResumeGame(activeGame.id)} style={{ display:"flex", alignItems:"center", gap:14, flex:1, cursor:"pointer" }}>
            <div style={{ fontSize:28 }}>🎮</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, color:C.gold, textTransform:"uppercase", letterSpacing:2, fontWeight:700 }}>Game In Progress</div>
              <div style={{ fontSize:16, fontWeight:800 }}>
                {teams.find(t=>t.id===activeGame.teamAId)?.name || "Team A"}
                {activeGame.mode==="matchup" && <> vs {teams.find(t=>t.id===activeGame.teamBId)?.name || "Team B"}</>}
              </div>
            </div>
            <div style={{ fontWeight:700, color:C.gold }}>Resume →</div>
          </div>
          {confirmDelete===activeGame.id ? (
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={()=>{onDeleteGame(activeGame.id); setConfirmDelete(null);}} style={btnStyle({ bg:C.accent, color:"#fff", padding:"8px 12px", fontSize:12, fontWeight:700 })}>Delete</button>
              <button onClick={()=>setConfirmDelete(null)} style={btnStyle({ bg:"transparent", color:C.muted, padding:"8px 12px", fontSize:12 })}>Cancel</button>
            </div>
          ) : (
            <button onClick={()=>setConfirmDelete(activeGame.id)} style={{ background:"transparent", border:"none", color:C.muted, cursor:"pointer", fontSize:18, padding:"4px 8px" }}>🗑</button>
          )}
        </div>
      )}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:28, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:28, fontWeight:900, letterSpacing:-0.5 }}>Opponent Teams</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>{teams.length} team{teams.length!==1?"s":""} scouted</div>
        </div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {!activeGame && teams.length>0 && (
            <button onClick={onStartGame} style={btnStyle({ bg:C.gold, color:"#000", padding:"12px 22px", fontWeight:700 })}>🎮 Start Game</button>
          )}
          <button onClick={onAdd} style={btnStyle({ bg:C.accent, color:"#fff", padding:"12px 22px", fontWeight:700 })}>+ Add Team</button>
        </div>
      </div>
      {teams.length===0 && (
        <Empty icon="🏟️" title="No teams yet" sub="Add your first opponent team to start scouting" />
      )}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:16 }}>
        {teams.map(t => (
          <div key={t.id} style={{ ...cardStyle(), position:"relative" }}>
            <div onClick={()=>onSelect(t.id)} style={{ cursor:"pointer" }}>
              <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:2, marginBottom:6 }}>Team</div>
              <div style={{ fontSize:22, fontWeight:800, paddingRight:28 }}>{t.name}</div>
              <div style={{ marginTop:10, fontSize:13, color:C.muted }}>{t.players?.length||0} players scouted</div>
              <div style={{ marginTop:12, height:2, background:`linear-gradient(90deg,${C.accent},transparent)`, borderRadius:1 }} />
            </div>
            {confirmDelete===`team-${t.id}` ? (
              <div style={{ display:"flex", gap:6, marginTop:12 }}>
                <button onClick={(e)=>{e.stopPropagation(); onDeleteTeam(t.id); setConfirmDelete(null);}} style={btnStyle({ bg:C.accent, color:"#fff", padding:"8px 12px", fontSize:12, fontWeight:700 })}>Delete Team</button>
                <button onClick={(e)=>{e.stopPropagation(); setConfirmDelete(null);}} style={btnStyle({ bg:"transparent", color:C.muted, padding:"8px 12px", fontSize:12 })}>Cancel</button>
              </div>
            ) : (
              <button onClick={(e)=>{e.stopPropagation(); setConfirmDelete(`team-${t.id}`);}} style={{ position:"absolute", top:14, right:14, background:"transparent", border:"none", color:C.muted, cursor:"pointer", fontSize:18, padding:"2px 6px" }}>🗑</button>
            )}
          </div>
        ))}
      </div>

      {pastGames.length > 0 && (
        <div style={{ marginTop:36 }}>
          <div style={{ fontSize:16, fontWeight:800, marginBottom:12, color:C.muted }}>Game History</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {pastGames.map(g => {
              const tA = teams.find(t=>t.id===g.teamAId);
              const tB = teams.find(t=>t.id===g.teamBId);
              return (
                <div key={g.id} style={{ ...cardStyle(), display:"flex", alignItems:"center", gap:14, padding:"12px 16px" }}>
                  <div style={{ fontSize:20 }}>🏁</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700 }}>
                      {tA?.name || "Unknown"}{g.mode==="matchup" && tB && <> vs {tB.name}</>}
                    </div>
                    <div style={{ fontSize:12, color:C.muted }}>
                      {g.mode==="matchup" ? "Matchup" : "Single Team"} · {g.createdAt ? new Date(g.createdAt).toLocaleDateString() : ""}
                    </div>
                  </div>
                  {confirmDelete===g.id ? (
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={()=>{onDeleteGame(g.id); setConfirmDelete(null);}} style={btnStyle({ bg:C.accent, color:"#fff", padding:"8px 12px", fontSize:12, fontWeight:700 })}>Delete</button>
                      <button onClick={()=>setConfirmDelete(null)} style={btnStyle({ bg:"transparent", color:C.muted, padding:"8px 12px", fontSize:12 })}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={()=>setConfirmDelete(g.id)} style={{ background:"transparent", border:"none", color:C.muted, cursor:"pointer", fontSize:18, padding:"4px 8px" }}>🗑</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TEAM VIEW
// ══════════════════════════════════════════════════════════════
function TeamView({ team, onSelect, onAdd, onTeamReport, onImport, onStartGame, onDeletePlayer }) {
  const sorted = [...(team.players||[])].sort((a,b) => (a.order||99)-(b.order||99));
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null); // playerId

  const toggleSelect = (id) => setSelected(sel => sel.includes(id) ? sel.filter(x=>x!==id) : [...sel, id]);

  const exitSelectMode = () => { setSelectMode(false); setSelected([]); };

  return (
    <div style={{ maxWidth:1000, margin:"0 auto", padding:"32px 20px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:28, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:28, fontWeight:900 }}>{team.name}</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>{sorted.length} players</div>
        </div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {selectMode ? (
            <>
              <button onClick={()=>onTeamReport(selected)} disabled={selected.length===0}
                style={{ ...btnStyle({ bg: selected.length?C.blue:C.border, color: selected.length?"#fff":C.muted, padding:"12px 18px", fontWeight:700 }), cursor: selected.length?"pointer":"not-allowed" }}>
                📋 Create Report ({selected.length})
              </button>
              <button onClick={exitSelectMode} style={btnStyle({ bg:C.card, color:C.muted, padding:"12px 18px", fontWeight:700 })}>Cancel</button>
            </>
          ) : (
            <>
              <button onClick={onStartGame} style={btnStyle({ bg:C.gold, color:"#000", padding:"12px 18px", fontWeight:700 })}>🎮 Start Game</button>
              <button onClick={onImport} style={btnStyle({ bg:C.card, color:C.gold, padding:"12px 18px", fontWeight:700 })}>📥 Import Stats</button>
              <button onClick={()=>setSelectMode(true)} style={btnStyle({ bg:C.card, color:C.blue, padding:"12px 18px", fontWeight:700 })}>☑️ Select Players</button>
              <button onClick={()=>onTeamReport()} style={btnStyle({ bg:C.blue, color:"#fff", padding:"12px 18px", fontWeight:700 })}>📋 Game Day Sheet</button>
              <button onClick={onAdd} style={btnStyle({ bg:C.accent, color:"#fff", padding:"12px 22px", fontWeight:700 })}>+ Add Player</button>
            </>
          )}
        </div>
      </div>
      {selectMode && (
        <div style={{ fontSize:13, color:C.muted, marginBottom:16 }}>Tap players to include them in a custom report, then tap "Create Report."</div>
      )}
      {sorted.length===0 && <Empty icon="⚾" title="No players yet" sub="Add hitters to start building scouting reports" />}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14 }}>
        {sorted.map(p => (
          <PlayerCard
            key={p.id} player={p}
            onClick={()=> selectMode ? toggleSelect(p.id) : onSelect(p.id)}
            selectMode={selectMode}
            selected={selected.includes(p.id)}
            confirmDelete={confirmDelete===p.id}
            onAskDelete={()=>setConfirmDelete(p.id)}
            onCancelDelete={()=>setConfirmDelete(null)}
            onConfirmDelete={()=>{ onDeletePlayer(p.id); setConfirmDelete(null); }}
          />
        ))}
      </div>
    </div>
  );
}

function PlayerCard({ player: p, onClick, selectMode, selected, confirmDelete, onAskDelete, onCancelDelete, onConfirmDelete }) {
  const abCount = p.abs?.length || 0;
  const hits = p.abs?.filter(a => ["Single","Double","Triple","HR"].includes(a.outcome)).length || 0;
  const tracked = abCount > 0;
  const avg  = tracked ? (hits/abCount).toFixed(3).replace("0.","." ) : (p.seasonStats?.avg ? Number(p.seasonStats.avg).toFixed(3).replace("0.","." ) : ".000");
  const displayAB = tracked ? abCount : (p.seasonStats?.ab ?? 0);
  return (
    <div onClick={onClick} style={{ ...cardStyle({ hover:true }), position:"relative", border: selected?`2px solid ${C.blue}`:cardStyle().border, background: selected?`${C.blue}11`:C.card }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:2 }}>
            {p.gradYear ? `'${p.gradYear.toString().slice(-2)}` : ""} · {p.bats||"R"} · {p.order ? `#${p.order} in order` : ""}
          </div>
          <div style={{ fontSize:22, fontWeight:800, marginTop:4, paddingRight: selectMode?28:0 }}>{p.name}</div>
          <div style={{ fontSize:13, color:C.muted }}>#{p.number}</div>
        </div>
        {selectMode ? (
          <div style={{ width:26, height:26, borderRadius:6, border:`2px solid ${selected?C.blue:C.border}`, background: selected?C.blue:"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:900, color:"#fff", flexShrink:0 }}>
            {selected ? "✓" : ""}
          </div>
        ) : (
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:24, fontWeight:900, color:C.gold, fontVariantNumeric:"tabular-nums" }}>{avg}</div>
            <div style={{ fontSize:11, color:C.muted }}>{tracked ? "AVG · tracked" : p.seasonStats ? "AVG · season" : "AVG"} · {displayAB} AB</div>
          </div>
        )}
      </div>
      <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        {p.profile?.willSteal==="Yes" && <Tag label="SB Threat" color={C.green} />}
        {p.profile?.willBunt==="Yes"  && <Tag label="Bunt" color={C.blue} />}
        {p.profile?.firstPitchSwinger==="Yes" && <Tag label="1st Pitch" color={C.gold} />}
        {p.seasonStats && <Tag label={`Season data (${p.seasonStats.source||"Imported"})`} color={C.muted} />}
        {!selectMode && (
          <div style={{ flex:1, display:"flex", justifyContent:"flex-end" }}>
            {confirmDelete ? (
              <div onClick={e=>e.stopPropagation()} style={{ display:"flex", gap:6 }}>
                <button onClick={onConfirmDelete} style={btnStyle({ bg:C.accent, color:"#fff", padding:"6px 10px", fontSize:11, fontWeight:700 })}>Delete</button>
                <button onClick={onCancelDelete} style={btnStyle({ bg:"transparent", color:C.muted, padding:"6px 10px", fontSize:11 })}>Cancel</button>
              </div>
            ) : (
              <button onClick={e=>{e.stopPropagation(); onAskDelete();}} style={{ background:"transparent", border:"none", color:C.muted, cursor:"pointer", fontSize:16, padding:"2px 6px" }}>🗑</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PLAYER VIEW
// ══════════════════════════════════════════════════════════════
function PlayerView({ team, player, onUpdateProfile, onStartAB, onSelectAB, onDeleteAB, onReport }) {
  const [tab, setTab] = useState("profile"); // profile | abs | charts
  const [profile, setProfile] = useState(player.profile || {});
  const [editing, setEditing] = useState(false);

  const abs = player.abs || [];
  const abCount = abs.length;
  const hits = abs.filter(a=>["Single","Double","Triple","HR"].includes(a.outcome)).length;
  const ks   = abs.filter(a=>["K","K-L"].includes(a.outcome)).length;
  const bbs  = abs.filter(a=>a.outcome==="Walk").length;
  const avg  = abCount ? (hits/abCount).toFixed(3).replace("0.","." ) : ".000";

  const saveProfile = () => { onUpdateProfile(profile); setEditing(false); };

  return (
    <div style={{ maxWidth:1100, margin:"0 auto", padding:"24px 20px" }}>
      {/* Player Header */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:24, marginBottom:20, display:"flex", alignItems:"center", gap:24, flexWrap:"wrap" }}>
        <div style={{ width:72, height:72, borderRadius:12, background:`linear-gradient(135deg,${C.accentDim},${C.accent})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, fontWeight:900 }}>
          {player.number}
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:2 }}>
            {team.name} · Bats {player.bats||"R"} · {player.gradYear ? `Class of ${player.gradYear}` : ""}
          </div>
          <div style={{ fontSize:32, fontWeight:900, letterSpacing:-1 }}>{player.name}</div>
          <div style={{ fontSize:13, color:C.muted }}>Batting order: {player.order ? `#${player.order}` : "—"}</div>
        </div>
        <div style={{ display:"flex", gap:24, textAlign:"center" }}>
          {[["AVG",avg],["AB",abCount],["H",hits],["K",ks],["BB",bbs]].map(([l,v])=>(
            <div key={l}>
              <div style={{ fontSize:22, fontWeight:900, color: l==="AVG" ? C.gold : C.text, fontVariantNumeric:"tabular-nums" }}>{v}</div>
              <div style={{ fontSize:11, color:C.muted, letterSpacing:1 }}>{l}</div>
            </div>
          ))}
        </div>
        <button onClick={onReport} style={btnStyle({ bg:C.accent, color:"#fff", padding:"10px 18px", fontWeight:700 })}>📊 Full Report</button>
      </div>

      {/* Tab Bar */}
      <div style={{ display:"flex", gap:4, marginBottom:20, background:C.surface, borderRadius:10, padding:4, border:`1px solid ${C.border}` }}>
        {["profile","abs","charts"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ flex:1, padding:"10px 0", borderRadius:8, border:"none", cursor:"pointer", fontWeight:700, fontSize:13, background: tab===t ? C.accent : "transparent", color: tab===t ? "#fff" : C.muted, textTransform:"capitalize", transition:"all 0.15s" }}>
            {t==="abs" ? "At-Bats" : t==="charts" ? "Charts" : "Scout Profile"}
          </button>
        ))}
      </div>

      {/* Scout Profile Tab */}
      {tab==="profile" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          {player.seasonStats && (
            <div style={{ ...cardStyle(), gridColumn:"span 2" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <SectionLabel>Season Stats (Imported{player.seasonStats.source?` · ${player.seasonStats.source}`:""})</SectionLabel>
                <span style={{ fontSize:11, color:C.muted }}>{player.seasonStats.importedAt ? new Date(player.seasonStats.importedAt).toLocaleDateString() : ""}</span>
              </div>
              <div style={{ display:"flex", gap:18, flexWrap:"wrap" }}>
                {["avg","ab","h","2b","3b","hr","rbi","bb","k","sb","obp","slg"].map(key=>{
                  const v = player.seasonStats[key];
                  if (v===undefined || v===null || v==="") return null;
                  return (
                    <div key={key} style={{ textAlign:"center" }}>
                      <div style={{ fontSize:20, fontWeight:900, color: key==="avg"||key==="obp"||key==="slg" ? C.gold : C.text, fontVariantNumeric:"tabular-nums" }}>{v}</div>
                      <div style={{ fontSize:11, color:C.muted, letterSpacing:1 }}>{key.toUpperCase()}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{ gridColumn:"span 2", display:"flex", justifyContent:"flex-end", marginBottom:4 }}>
            {editing
              ? <><button onClick={saveProfile} style={btnStyle({ bg:C.green, color:"#000", padding:"8px 18px", fontWeight:700 })}>Save</button>
                  <button onClick={()=>{setProfile(player.profile); setEditing(false);}} style={{ ...btnStyle({ bg:"transparent", color:C.muted, padding:"8px 14px" }), marginLeft:8 }}>Cancel</button></>
              : <button onClick={()=>setEditing(true)} style={btnStyle({ bg:C.card, color:C.text, padding:"8px 18px", fontWeight:600 })}>Edit Profile</button>
            }
          </div>
          {[
            ["Will He Steal?","willSteal",["No","Yes","Maybe"]],
            ["Will He Bunt?","willBunt",["No","Yes","Occasional"]],
            ["1st Pitch Swinger?","firstPitchSwinger",["No","Yes","Sometimes"]],
            ["Put Away Pitch","putAwayPitch",PITCH_TYPES],
            ["Spray Tendency","sprayTend",["Pull","Middle","Oppo","All Fields"]],
          ].map(([label, key, opts])=>(
            <ProfileField key={key} label={label} value={profile[key]||opts[0]} options={opts} editing={editing}
              onChange={v=>setProfile({...profile,[key]:v})} />
          ))}
          <div style={{ ...cardStyle(), gridColumn:"span 2" }}>
            <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:2, marginBottom:10 }}>Base Running Notes</div>
            {editing
              ? <textarea value={profile.baseRunningNotes||""} onChange={e=>setProfile({...profile,baseRunningNotes:e.target.value})}
                  style={{ width:"100%", background:C.bg, border:`1px solid ${C.border}`, color:C.text, borderRadius:8, padding:10, fontSize:14, resize:"vertical", minHeight:60, boxSizing:"border-box" }} />
              : <div style={{ fontSize:14, color: profile.baseRunningNotes ? C.text : C.muted, lineHeight:1.6 }}>{profile.baseRunningNotes||"No notes yet."}</div>
            }
          </div>
          <div style={{ ...cardStyle(), gridColumn:"span 2" }}>
            <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:2, marginBottom:10 }}>Overall Scouting Notes</div>
            {editing
              ? <textarea value={profile.scoutNotes||""} onChange={e=>setProfile({...profile,scoutNotes:e.target.value})}
                  style={{ width:"100%", background:C.bg, border:`1px solid ${C.border}`, color:C.text, borderRadius:8, padding:10, fontSize:14, resize:"vertical", minHeight:100, boxSizing:"border-box" }} />
              : <div style={{ fontSize:14, color: profile.scoutNotes ? C.text : C.muted, lineHeight:1.6 }}>{profile.scoutNotes||"No scouting notes yet."}</div>
            }
          </div>
        </div>
      )}

      {/* At-Bats Tab */}
      {tab==="abs" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div style={{ fontSize:16, fontWeight:700 }}>{abs.length} At-Bats tracked</div>
            <button onClick={onStartAB} style={btnStyle({ bg:C.accent, color:"#fff", padding:"10px 20px", fontWeight:700 })}>+ New At-Bat</button>
          </div>
          {abs.length===0 && <Empty icon="🏏" title="No at-bats yet" sub="Start a new at-bat to begin pitch-by-pitch tracking" />}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {[...abs].reverse().map(ab=>(
              <ABRow key={ab.id} ab={ab} onClick={()=>onSelectAB(ab.id)} onDelete={()=>onDeleteAB(ab.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Charts Tab */}
      {tab==="charts" && <ChartsView player={player} />}
    </div>
  );
}

function ProfileField({ label, value, options, editing, onChange }) {
  return (
    <div style={cardStyle()}>
      <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:2, marginBottom:10 }}>{label}</div>
      {editing
        ? <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {options.map(o=>(
              <button key={o} onClick={()=>onChange(o)}
                style={{ padding:"6px 14px", borderRadius:20, border:`1px solid ${value===o ? C.accent : C.border}`, background: value===o ? C.accent : "transparent", color: value===o ? "#fff" : C.muted, fontSize:13, cursor:"pointer", fontWeight: value===o ? 700 : 400 }}>
                {o}
              </button>
            ))}
          </div>
        : <div style={{ fontSize:18, fontWeight:700, color: value==="Yes"||value==="FB"||value==="Pull" ? C.gold : C.text }}>{value||"—"}</div>
      }
    </div>
  );
}

function ABRow({ ab, onClick, onDelete }) {
  const pitchCount = ab.pitches?.length || 0;
  const ballsStrikes = ab.pitches?.reduce((acc,p) => {
    if (p.result==="Ball") acc.b++; else if (p.result==="Strike"||p.result==="Foul") acc.s++;
    return acc;
  }, {b:0,s:0}) || {b:0,s:0};

  return (
    <div style={{ ...cardStyle(), display:"flex", alignItems:"center", gap:16, padding:"14px 18px", cursor:"pointer" }} onClick={onClick}>
      <div style={{ width:40, height:40, borderRadius:8, background: ab.outcome ? (["Single","Double","Triple","HR"].includes(ab.outcome) ? C.zone.hit : C.zone.out) : C.zone.ball, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, color:C.text }}>
        {ab.outcome ? ab.outcome.replace(" Out","O").replace("Ground","G").replace("Fly","F").replace("Line","L").substring(0,3).toUpperCase() : "?"}
      </div>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700 }}>{ab.outcome || <span style={{ color:C.muted }}>In progress…</span>}</div>
        <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>
          Inning {ab.inning||"?"} · {pitchCount} pitch{pitchCount!==1?"es":""} · {ballsStrikes.b}B-{ballsStrikes.s}S
          {ab.fieldZone && <> · {ab.fieldZone}</>}
        </div>
      </div>
      {/* Mini pitch dots */}
      <div style={{ display:"flex", gap:3, flexWrap:"wrap", maxWidth:120 }}>
        {(ab.pitches||[]).map(p=>(
          <div key={p.id} style={{ width:10, height:10, borderRadius:"50%", background: PITCH_COLORS[p.type]||C.muted, opacity:0.85 }} title={`${p.type} Zone ${p.zone} - ${p.result}`} />
        ))}
      </div>
      <button onClick={e=>{e.stopPropagation();onDelete();}} style={{ background:"transparent", border:"none", color:C.muted, cursor:"pointer", fontSize:18, padding:"4px 8px" }}>🗑</button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// CHARTS VIEW
// ══════════════════════════════════════════════════════════════
function ChartsView({ player }) {
  const abs = player.abs || [];
  const allPitches = abs.flatMap(a => (a.pitches||[]).map(p=>({...p, outcome:a.outcome})));

  // Count tendencies
  const countData = {};
  abs.forEach(ab=>{
    let b=0,s=0;
    (ab.pitches||[]).forEach(p=>{
      const key = `${b}-${s}`;
      if (!countData[key]) countData[key] = { swing:0, take:0, hit:0, total:0 };
      countData[key].total++;
      if (p.result!=="Ball") { countData[key].swing++; if(["Single","Double","Triple","HR"].includes(p.outcome)) countData[key].hit++; }
      else countData[key].take++;
      if (p.result==="Ball") b = Math.min(b+1,3);
      else if (p.result!=="Foul") s = Math.min(s+1,2);
    });
  });

  // Zone frequency
  const zoneCount = {};
  allPitches.forEach(p=>{ zoneCount[p.zone] = (zoneCount[p.zone]||0)+1; });
  const maxZone = Math.max(...Object.values(zoneCount),1);

  // Spray chart
  const sprayData = {};
  abs.filter(a=>a.fieldZone && ["Single","Double","Triple","HR"].includes(a.outcome)).forEach(a=>{
    sprayData[a.fieldZone] = (sprayData[a.fieldZone]||0)+1;
  });

  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
      {/* Zone Frequency */}
      <div style={cardStyle()}>
        <SectionLabel>Pitch Location Frequency</SectionLabel>
        <ZoneGrid zoneCount={zoneCount} maxZone={maxZone} showHeat />
        <div style={{ marginTop:10, fontSize:12, color:C.muted, textAlign:"center" }}>Darker = more pitches seen</div>
      </div>

      {/* Spray Chart */}
      <div style={cardStyle()}>
        <SectionLabel>Hit Spray Chart</SectionLabel>
        <SprayChart sprayData={sprayData} />
      </div>

      {/* Count Tendencies */}
      <div style={{ ...cardStyle(), gridColumn:"span 2" }}>
        <SectionLabel>Tendencies by Count</SectionLabel>
        <CountMatrix countData={countData} />
      </div>

      {/* Pitch type breakdown */}
      <div style={{ ...cardStyle(), gridColumn:"span 2" }}>
        <SectionLabel>Result by Pitch Type</SectionLabel>
        <PitchBreakdown pitches={allPitches} />
      </div>
    </div>
  );
}

function ZoneGrid({ zoneCount, maxZone, showHeat, onZoneClick, selected }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:4, maxWidth:240, margin:"0 auto" }}>
      {ZONES.map(z=>{
        const count = zoneCount[z]||0;
        const intensity = showHeat ? count/maxZone : 0;
        const isSelected = selected===z;
        return (
          <div key={z} onClick={()=>onZoneClick&&onZoneClick(z)}
            style={{ aspectRatio:"1", borderRadius:6, border:`2px solid ${isSelected ? C.accent : C.border}`, background: showHeat ? `rgba(232,49,42,${0.1+intensity*0.85})` : C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:onZoneClick?"pointer":"default", transition:"all 0.1s" }}>
            {showHeat && <div style={{ fontSize:14, fontWeight:800, color:intensity>0.5?"#fff":C.muted }}>{count||""}</div>}
            {!showHeat && <div style={{ fontSize:11, color:C.muted }}>{ZONE_LABELS[z]}</div>}
          </div>
        );
      })}
    </div>
  );
}

function SprayChart({ sprayData }) {
  // SVG-based baseball field
  const total = Object.values(sprayData).reduce((a,b)=>a+b,0)||1;
  const zones = [
    { key:"LF",  x:80,  y:130, label:"LF" },
    { key:"LCF", x:140, y:80,  label:"LCF" },
    { key:"CF",  x:200, y:55,  label:"CF" },
    { key:"RCF", x:260, y:80,  label:"RCF" },
    { key:"RF",  x:320, y:130, label:"RF" },
    { key:"Infield", x:200, y:165, label:"IF" },
  ];
  return (
    <svg viewBox="0 0 400 260" style={{ width:"100%", maxWidth:340, display:"block", margin:"0 auto" }}>
      {/* Field */}
      <path d="M200 230 L60 100 Q200 10 340 100 Z" fill="#0d2f0d" stroke="#1a4a1a" strokeWidth={1.5} />
      <path d="M200 230 L120 150 L200 130 L280 150 Z" fill="#1a3a0a" stroke="#2a5a1a" strokeWidth={1} />
      {/* Base paths */}
      <rect x={185} y={185} width={30} height={30} fill="none" stroke={C.border} strokeWidth={1} transform="rotate(45 200 200)" />
      {/* Zone circles */}
      {zones.map(z=>{
        const count = sprayData[z.key]||0;
        const pct = count/total;
        const r = 8 + pct*28;
        const opacity = count ? 0.6+pct*0.4 : 0.1;
        return (
          <g key={z.key}>
            <circle cx={z.x} cy={z.y} r={r} fill={C.accent} opacity={opacity} />
            <text x={z.x} y={z.y+1} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#fff" fontWeight={700}>{count||""}</text>
            <text x={z.x} y={z.y+r+10} textAnchor="middle" fontSize={9} fill={C.muted}>{z.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function CountMatrix({ countData }) {
  const balls = [0,1,2,3];
  const strikes = [0,1,2];
  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ borderCollapse:"collapse", width:"100%", fontSize:13 }}>
        <thead>
          <tr>
            <th style={{ padding:"6px 12px", color:C.muted, textAlign:"left" }}>Count</th>
            <th style={{ padding:"6px 12px", color:C.muted }}>Pitches</th>
            <th style={{ padding:"6px 12px", color:C.muted }}>Swing%</th>
            <th style={{ padding:"6px 12px", color:C.muted }}>Tendency</th>
          </tr>
        </thead>
        <tbody>
          {balls.flatMap(b=>strikes.filter(s=>!(b===3&&s===2)).map(s=>{
            const key=`${b}-${s}`;
            const d = countData[key]||{b:0,s:0,swing:0,take:0,hit:0,total:0};
            const swingPct = d.total ? Math.round(d.swing/d.total*100) : 0;
            const label = b===3&&s===0?"Full Count ahead":b>s?"Hitter's Count":s>b?"Pitcher's Count":"Even";
            const isHitterCount = b>=s;
            return (
              <tr key={key} style={{ borderTop:`1px solid ${C.border}`, background: d.total ? "transparent" : "rgba(0,0,0,0.2)" }}>
                <td style={{ padding:"8px 12px", fontWeight:700, color: isHitterCount ? C.green : C.accent }}>
                  {b}-{s}
                </td>
                <td style={{ padding:"8px 12px", textAlign:"center", color:C.muted }}>{d.total}</td>
                <td style={{ padding:"8px 12px", textAlign:"center" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ flex:1, height:6, background:C.border, borderRadius:3, overflow:"hidden" }}>
                      <div style={{ width:`${swingPct}%`, height:"100%", background: swingPct>60?C.accent:C.green, borderRadius:3 }} />
                    </div>
                    <span style={{ width:36, textAlign:"right", color: swingPct>60?C.accent:C.text }}>{d.total?`${swingPct}%`:"—"}</span>
                  </div>
                </td>
                <td style={{ padding:"8px 12px", color:C.muted, fontSize:12 }}>{d.total ? label : "—"}</td>
              </tr>
            );
          }))}
        </tbody>
      </table>
    </div>
  );
}

function PitchBreakdown({ pitches }) {
  const byType = {};
  PITCH_TYPES.forEach(t=>{ byType[t]={total:0,swing:0,whiff:0,hit:0}; });
  pitches.forEach(p=>{
    const t=p.type||"Other"; if(!byType[t]) byType[t]={total:0,swing:0,whiff:0,hit:0};
    byType[t].total++;
    if(p.result!=="Ball") { byType[t].swing++; }
    if(p.result==="Strike") byType[t].whiff++;
    if(["Single","Double","Triple","HR"].includes(p.outcome)) byType[t].hit++;
  });
  return (
    <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
      {PITCH_TYPES.map(t=>{
        const d=byType[t];
        if(!d.total) return null;
        return (
          <div key={t} style={{ flex:1, minWidth:100, background:C.bg, borderRadius:10, padding:14, border:`1px solid ${C.border}` }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:PITCH_COLORS[t] }} />
              <span style={{ fontWeight:800, fontSize:15 }}>{t}</span>
            </div>
            <div style={{ fontSize:24, fontWeight:900, color:PITCH_COLORS[t] }}>{d.total}</div>
            <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>seen</div>
            <div style={{ marginTop:8, fontSize:12, color:C.muted }}>
              <div>Swing: {d.total?Math.round(d.swing/d.total*100):0}%</div>
              <div>Whiff: {d.swing?Math.round(d.whiff/d.swing*100):0}%</div>
              <div>Hits: {d.hit}</div>
            </div>
          </div>
        );
      })}
      {pitches.length===0 && <div style={{ color:C.muted, fontSize:14 }}>No pitches tracked yet.</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// LIVE TRACKING VIEW
// ══════════════════════════════════════════════════════════════
function LiveTrackingView({ team, player, ab, onAddPitch, onFinishAB }) {
  const [selectedType, setSelectedType] = useState("FB");
  const [selectedZone, setSelectedZone] = useState(null);
  const [finishMode, setFinishMode]   = useState(false);
  const [outcome, setOutcome]         = useState(null);
  const [inning, setInning]           = useState("");
  const [fieldZone, setFieldZone]     = useState(null);

  const pitches = ab.pitches || [];
  const balls   = pitches.filter(p=>p.result==="Ball").length;
  const strikes = pitches.filter(p=>["Strike","Foul"].includes(p.result)).length;
  const lastPitch = pitches[pitches.length-1];

  const logPitch = (result) => {
    if (!selectedZone) { alert("Select a zone first"); return; }
    onAddPitch({ type:selectedType, zone:selectedZone, result });
    setSelectedZone(null);
  };

  const finish = () => {
    if (!outcome) { alert("Select an outcome"); return; }
    onFinishAB(outcome, inning||"?", fieldZone);
  };

  return (
    <div style={{ maxWidth:900, margin:"0 auto", padding:"20px 16px" }}>
      {/* AB Header */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:16, marginBottom:16, display:"flex", alignItems:"center", gap:20, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:2 }}>Live Tracking</div>
          <div style={{ fontSize:20, fontWeight:800 }}>#{player.number} {player.name}</div>
        </div>
        {/* Count display */}
        <div style={{ display:"flex", gap:20, flex:1, justifyContent:"center" }}>
          <CountBubble label="Balls" value={balls} color={C.green} />
          <CountBubble label="Strikes" value={strikes} color={C.accent} />
          <CountBubble label="Pitches" value={pitches.length} color={C.muted} />
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>setFinishMode(!finishMode)} style={btnStyle({ bg:finishMode?C.surface:C.gold, color:finishMode?C.muted:"#000", padding:"10px 16px", fontWeight:700 })}>
            {finishMode ? "← Back" : "End AB"}
          </button>
        </div>
      </div>

      {!finishMode ? (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          {/* Left: Zone + Pitch Type */}
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {/* Pitch Type */}
            <div style={cardStyle()}>
              <SectionLabel>Pitch Type</SectionLabel>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {PITCH_TYPES.map(t=>(
                  <button key={t} onClick={()=>setSelectedType(t)}
                    style={{ padding:"10px 16px", borderRadius:8, border:`2px solid ${selectedType===t?PITCH_COLORS[t]:C.border}`, background: selectedType===t ? `${PITCH_COLORS[t]}22` : "transparent", color: selectedType===t ? PITCH_COLORS[t] : C.muted, fontSize:14, fontWeight:700, cursor:"pointer" }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Zone selector */}
            <div style={cardStyle()}>
              <SectionLabel>Pitch Zone {selectedZone ? <span style={{ color:C.accent }}>· Zone {selectedZone}</span> : <span style={{ color:C.muted }}>· tap to select</span>}</SectionLabel>
              <ZoneGrid zoneCount={{}} maxZone={1} onZoneClick={setSelectedZone} selected={selectedZone} />
            </div>

            {/* Result buttons */}
            <div style={cardStyle()}>
              <SectionLabel>Log Result</SectionLabel>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {RESULTS.map(r=>(
                  <button key={r} onClick={()=>logPitch(r)}
                    disabled={!selectedZone}
                    style={{ padding:"14px", borderRadius:10, border:`1px solid ${RESULT_COLORS[r]}44`, background: selectedZone ? `${RESULT_COLORS[r]}22` : C.bg, color: selectedZone ? RESULT_COLORS[r] : C.muted, fontSize:14, fontWeight:700, cursor: selectedZone?"pointer":"not-allowed", transition:"all 0.1s" }}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Pitch history */}
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div style={cardStyle()}>
              <SectionLabel>This At-Bat · {pitches.length} Pitch{pitches.length!==1?"es":""}</SectionLabel>
              <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:400, overflowY:"auto" }}>
                {pitches.length===0 && <div style={{ color:C.muted, fontSize:13 }}>No pitches yet. Select a zone and log a pitch.</div>}
                {pitches.map((p,i)=>(
                  <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", background:C.bg, borderRadius:8, border:`1px solid ${C.border}` }}>
                    <div style={{ width:22, height:22, borderRadius:"50%", background:PITCH_COLORS[p.type], display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:"#fff" }}>{p.type?.substring(0,2)}</div>
                    <div style={{ flex:1 }}>
                      <span style={{ fontWeight:700, color:PITCH_COLORS[p.type] }}>{p.type}</span>
                      <span style={{ color:C.muted, fontSize:12 }}> · Zone {p.zone} · </span>
                      <span style={{ color:RESULT_COLORS[p.result], fontWeight:600, fontSize:13 }}>{p.result}</span>
                    </div>
                    <div style={{ fontSize:11, color:C.muted }}>#{i+1}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mini zone heat for current AB */}
            {pitches.length > 0 && (
              <div style={cardStyle()}>
                <SectionLabel>AB Zone Map</SectionLabel>
                <ZoneGrid zoneCount={pitches.reduce((a,p)=>{a[p.zone]=(a[p.zone]||0)+1;return a;},{})} maxZone={pitches.length} showHeat />
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Finish AB mode */
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <div style={cardStyle()}>
            <SectionLabel>At-Bat Outcome</SectionLabel>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {AB_OUTCOMES.map(o=>(
                <button key={o} onClick={()=>setOutcome(o)}
                  style={{ padding:"12px", borderRadius:8, border:`2px solid ${outcome===o?C.accent:C.border}`, background: outcome===o ? `${C.accent}22` : "transparent", color: outcome===o ? C.accent : C.muted, fontSize:13, fontWeight:outcome===o?700:400, cursor:"pointer" }}>
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div style={cardStyle()}>
              <SectionLabel>Inning</SectionLabel>
              <input type="number" min={1} max={15} value={inning} onChange={e=>setInning(e.target.value)} placeholder="1-9"
                style={{ width:"100%", background:C.bg, border:`1px solid ${C.border}`, color:C.text, borderRadius:8, padding:"12px", fontSize:18, boxSizing:"border-box", textAlign:"center" }} />
            </div>
            {["Single","Double","Triple","HR","Sac Fly","FC","Error"].some(o=>o===outcome) && (
              <div style={cardStyle()}>
                <SectionLabel>Field Zone (Ball in Play)</SectionLabel>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                  {FIELD_ZONES.map(fz=>(
                    <button key={fz} onClick={()=>setFieldZone(fz)}
                      style={{ padding:"10px 6px", borderRadius:8, border:`2px solid ${fieldZone===fz?C.green:C.border}`, background: fieldZone===fz ? `${C.green}22` : "transparent", color: fieldZone===fz ? C.green : C.muted, fontSize:12, fontWeight:700, cursor:"pointer" }}>
                      {fz}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button onClick={finish} disabled={!outcome}
              style={{ ...btnStyle({ bg: outcome?C.green:C.border, color: outcome?"#000":C.muted, padding:"16px", fontWeight:800, fontSize:15 }), cursor:outcome?"pointer":"not-allowed" }}>
              ✓ Save At-Bat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CountBubble({ label, value, color }) {
  return (
    <div style={{ textAlign:"center" }}>
      <div style={{ width:48, height:48, borderRadius:12, border:`2px solid ${color}`, background:`${color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, fontWeight:900, color, margin:"0 auto" }}>{value}</div>
      <div style={{ fontSize:11, color:C.muted, marginTop:4, letterSpacing:1 }}>{label.toUpperCase()}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// REPORT VIEW (Print-friendly)
// ══════════════════════════════════════════════════════════════
function ReportView({ team, player, onBack }) {
  const abs = player.abs || [];
  const allPitches = abs.flatMap(a=>(a.pitches||[]).map(p=>({...p,outcome:a.outcome})));
  const hits = abs.filter(a=>["Single","Double","Triple","HR"].includes(a.outcome)).length;
  const abCount = abs.length;
  const avg = abCount ? (hits/abCount).toFixed(3).replace("0.","." ) : ".000";

  const zoneCount = {};
  allPitches.forEach(p=>{ zoneCount[p.zone]=(zoneCount[p.zone]||0)+1; });
  const maxZone = Math.max(...Object.values(zoneCount),1);

  const sprayData = {};
  abs.filter(a=>a.fieldZone&&["Single","Double","Triple","HR"].includes(a.outcome)).forEach(a=>{
    sprayData[a.fieldZone]=(sprayData[a.fieldZone]||0)+1;
  });

  const countData = {};
  abs.forEach(ab=>{
    let b=0,s=0;
    (ab.pitches||[]).forEach(p=>{
      const key=`${b}-${s}`;
      if(!countData[key]) countData[key]={swing:0,take:0,total:0};
      countData[key].total++;
      if(p.result!=="Ball") countData[key].swing++;
      else countData[key].take++;
      if(p.result==="Ball") b=Math.min(b+1,3);
      else if(p.result!=="Foul") s=Math.min(s+1,2);
    });
  });

  return (
    <div style={{ background:"#fff", color:"#111", minHeight:"100vh", padding:"32px", fontFamily:"'Helvetica Neue',Arial,sans-serif" }}>
      <style>{`@media print { .no-print { display:none!important; } body { background:#fff; } }`}</style>

      <div className="no-print" style={{ marginBottom:24, display:"flex", gap:12 }}>
        <button onClick={onBack} style={{ padding:"10px 20px", borderRadius:8, border:"1px solid #ccc", background:"#fff", cursor:"pointer", fontWeight:600 }}>← Back</button>
        <button onClick={()=>window.print()} style={{ padding:"10px 20px", borderRadius:8, border:"none", background:"#e8312a", color:"#fff", cursor:"pointer", fontWeight:700 }}>🖨 Print / Save PDF</button>
      </div>

      {/* Report Header */}
      <div style={{ borderBottom:"3px solid #e8312a", paddingBottom:16, marginBottom:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:3, color:"#666", marginBottom:4 }}>Hitter Scouting Report · {team.name}</div>
            <div style={{ fontSize:36, fontWeight:900, letterSpacing:-1 }}>{player.name}</div>
            <div style={{ fontSize:16, color:"#555", marginTop:2 }}>
              #{player.number} · Bats {player.bats||"R"} · {player.order?`Batting #${player.order}`:""}
              {player.gradYear ? ` · Class of ${player.gradYear}` : ""}
            </div>
          </div>
          <div style={{ display:"flex", gap:20, textAlign:"center" }}>
            {[["AVG",avg],["AB",abCount],["H",hits],["K",abs.filter(a=>["K","K-L"].includes(a.outcome)).length],["BB",abs.filter(a=>a.outcome==="Walk").length]].map(([l,v])=>(
              <div key={l}>
                <div style={{ fontSize:28, fontWeight:900, color:l==="AVG"?"#c8a800":"#111" }}>{v}</div>
                <div style={{ fontSize:11, color:"#888", letterSpacing:1 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Scout Card */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:0, border:"1px solid #ddd", borderRadius:8, overflow:"hidden", marginBottom:20 }}>
        {[
          ["Will Steal?",player.profile?.willSteal||"No"],
          ["Will Bunt?",player.profile?.willBunt||"No"],
          ["1st Pitch Swinger?",player.profile?.firstPitchSwinger||"No"],
          ["Put Away Pitch",player.profile?.putAwayPitch||"FB"],
          ["Spray Tendency",player.profile?.sprayTend||"Pull"],
        ].map(([l,v],i)=>(
          <div key={l} style={{ padding:"12px 14px", borderLeft:i>0?"1px solid #ddd":"none", textAlign:"center" }}>
            <div style={{ fontSize:10, textTransform:"uppercase", letterSpacing:1.5, color:"#888", marginBottom:6 }}>{l}</div>
            <div style={{ fontSize:18, fontWeight:800, color: v==="Yes"?"#c00":"#111" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Notes */}
      {(player.profile?.scoutNotes||player.profile?.baseRunningNotes) && (
        <div style={{ border:"1px solid #ddd", borderRadius:8, padding:16, marginBottom:20 }}>
          <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:2, color:"#888", marginBottom:8 }}>Scouting Notes</div>
          {player.profile?.scoutNotes && <div style={{ fontSize:13, lineHeight:1.7, marginBottom:8 }}>{player.profile.scoutNotes}</div>}
          {player.profile?.baseRunningNotes && <div style={{ fontSize:13, lineHeight:1.7, color:"#555" }}><strong>Base Running:</strong> {player.profile.baseRunningNotes}</div>}
        </div>
      )}

      {/* Charts row */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:20, marginBottom:20 }}>
        <div style={{ border:"1px solid #ddd", borderRadius:8, padding:14 }}>
          <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:2, color:"#888", marginBottom:10 }}>Pitch Zone Frequency</div>
          <PrintZoneGrid zoneCount={zoneCount} maxZone={maxZone} />
        </div>
        <div style={{ border:"1px solid #ddd", borderRadius:8, padding:14 }}>
          <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:2, color:"#888", marginBottom:10 }}>Hit Spray Chart</div>
          <SprayChart sprayData={sprayData} />
        </div>
        <div style={{ border:"1px solid #ddd", borderRadius:8, padding:14 }}>
          <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:2, color:"#888", marginBottom:10 }}>Pitch Type Seen</div>
          <PrintPitchBreakdown pitches={allPitches} />
        </div>
      </div>

      {/* Count matrix */}
      <div style={{ border:"1px solid #ddd", borderRadius:8, padding:14, marginBottom:20 }}>
        <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:2, color:"#888", marginBottom:12 }}>Tendencies by Count</div>
        <PrintCountMatrix countData={countData} />
      </div>

      {/* AB Log */}
      <div style={{ border:"1px solid #ddd", borderRadius:8, padding:14 }}>
        <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:2, color:"#888", marginBottom:12 }}>At-Bat Log</div>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead>
            <tr style={{ borderBottom:"2px solid #e8312a" }}>
              {["#","Inn","Outcome","Pitches","Sequence","Field Zone"].map(h=>(
                <th key={h} style={{ padding:"6px 10px", textAlign:"left", color:"#555", fontSize:11, textTransform:"uppercase", letterSpacing:1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {abs.map((ab,i)=>(
              <tr key={ab.id} style={{ borderBottom:"1px solid #eee" }}>
                <td style={{ padding:"7px 10px", fontWeight:700 }}>{i+1}</td>
                <td style={{ padding:"7px 10px", color:"#666" }}>{ab.inning||"?"}</td>
                <td style={{ padding:"7px 10px", fontWeight:700, color: ["Single","Double","Triple","HR"].includes(ab.outcome)?"#1a7a1a":["K","K-L"].includes(ab.outcome)?"#c00":"#111" }}>{ab.outcome||"—"}</td>
                <td style={{ padding:"7px 10px", color:"#666" }}>{ab.pitches?.length||0}</td>
                <td style={{ padding:"7px 10px", fontFamily:"monospace", fontSize:11, color:"#555" }}>
                  {(ab.pitches||[]).map(p=>`${p.type}/${p.zone}/${p.result[0]}`).join(" ")||"—"}
                </td>
                <td style={{ padding:"7px 10px", color:"#666" }}>{ab.fieldZone||"—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop:16, textAlign:"center", fontSize:10, color:"#aaa" }}>
        Generated by ScoutPro · {new Date().toLocaleDateString()}
      </div>
    </div>
  );
}

function PrintZoneGrid({ zoneCount, maxZone }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:3, maxWidth:180, margin:"0 auto" }}>
      {ZONES.map(z=>{
        const count=zoneCount[z]||0;
        const intensity=count/maxZone;
        return (
          <div key={z} style={{ aspectRatio:"1", borderRadius:4, border:"1px solid #ddd", background:`rgba(232,49,42,${0.05+intensity*0.7})`, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <span style={{ fontSize:13, fontWeight:700, color:intensity>0.5?"#fff":"#333" }}>{count||""}</span>
          </div>
        );
      })}
    </div>
  );
}

function PrintPitchBreakdown({ pitches }) {
  const byType = {};
  PITCH_TYPES.forEach(t=>{byType[t]=0;});
  pitches.forEach(p=>{const t=p.type||"Other"; byType[t]=(byType[t]||0)+1;});
  const total=pitches.length||1;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      {PITCH_TYPES.map(t=>{
        const count=byType[t]||0;
        const pct=Math.round(count/total*100);
        return (
          <div key={t} style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:28, fontSize:11, fontWeight:700, color:PITCH_COLORS[t] }}>{t}</div>
            <div style={{ flex:1, height:14, background:"#f0f0f0", borderRadius:3, overflow:"hidden" }}>
              <div style={{ width:`${pct}%`, height:"100%", background:PITCH_COLORS[t], borderRadius:3 }} />
            </div>
            <div style={{ width:24, fontSize:11, color:"#666", textAlign:"right" }}>{count}</div>
          </div>
        );
      })}
    </div>
  );
}

function PrintCountMatrix({ countData }) {
  const counts = ["0-0","1-0","2-0","3-0","0-1","1-1","2-1","3-1","0-2","1-2","2-2","3-2"];
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
      {counts.map(key=>{
        const [b,s]=key.split("-").map(Number);
        const d=countData[key]||{total:0,swing:0};
        const swingPct=d.total?Math.round(d.swing/d.total*100):0;
        const isHitter=b>=s;
        return (
          <div key={key} style={{ border:"1px solid #ddd", borderRadius:6, padding:"8px 10px", background: d.total?(isHitter?"#f0fff0":"#fff5f5"):"#fafafa" }}>
            <div style={{ fontSize:13, fontWeight:800, color:isHitter?"#1a7a1a":"#c00" }}>{key}</div>
            <div style={{ fontSize:11, color:"#666" }}>{d.total} pitches</div>
            {d.total>0 && <div style={{ fontSize:11, fontWeight:700 }}>Swing {swingPct}%</div>}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════════
function UnlockModal({ onUnlock, onClose }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);

  const submit = () => {
    if (code.trim() === LIVE_PASSCODE) {
      onUnlock();
    } else {
      setError(true);
    }
  };

  return (
    <Modal title="🔒 Sync to Live Account" onClose={onClose} onConfirm={submit} confirmLabel="Unlock">
      <div style={{ fontSize:13, color:C.muted, marginBottom:14, lineHeight:1.6 }}>
        You're currently in <strong style={{ color:C.gold }}>Sandbox Mode</strong> — everything you do here stays on this device only and is never saved to the cloud.
        <br/><br/>
        Enter the coach passcode to switch this device to your live, cloud-synced account.
      </div>
      <input
        type="tel" inputMode="numeric" autoFocus
        value={code}
        onChange={e=>{ setCode(e.target.value); setError(false); }}
        onKeyDown={e=>e.key==="Enter" && submit()}
        placeholder="Enter passcode"
        style={{ ...inputStyle(), textAlign:"center", fontSize:24, letterSpacing:6, fontWeight:800 }}
      />
      {error && <div style={{ marginTop:10, fontSize:13, color:C.accent, textAlign:"center" }}>Incorrect passcode.</div>}
      <div style={{ marginTop:14, fontSize:12, color:C.muted, textAlign:"center" }}>
        This device will switch to live mode and reload. To go back to sandbox later, clear this site's browsing data.
      </div>
    </Modal>
  );
}


function AddTeamModal({ onAdd, onClose }) {
  const [name, setName] = useState("");
  return (
    <Modal title="Add Opponent Team" onClose={onClose} onConfirm={()=>{ if(name.trim()) onAdd(name.trim()); }} confirmLabel="Add Team" confirmDisabled={!name.trim()}>
      <input autoFocus value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&name.trim()&&onAdd(name.trim())}
        placeholder="Team name (e.g. East High)"
        style={inputStyle()} />
    </Modal>
  );
}

function AddPlayerModal({ onAdd, onClose }) {
  const [f, setF] = useState({ name:"", number:"", bats:"R", order:"", gradYear:"" });
  const ok = f.name.trim() && f.number.trim();
  return (
    <Modal title="Add Player" onClose={onClose} onConfirm={()=>ok&&onAdd(f)} confirmLabel="Add Player" confirmDisabled={!ok}>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <Field label="Name *"><input value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="Full name" style={inputStyle()} /></Field>
        <Field label="Jersey # *"><input value={f.number} onChange={e=>setF({...f,number:e.target.value})} placeholder="27" style={inputStyle()} /></Field>
        <Field label="Bats">
          <div style={{ display:"flex", gap:8 }}>
            {["R","L","S"].map(b=>(
              <button key={b} onClick={()=>setF({...f,bats:b})}
                style={{ flex:1, padding:"10px", borderRadius:8, border:`2px solid ${f.bats===b?C.accent:C.border}`, background: f.bats===b?`${C.accent}22`:"transparent", color:f.bats===b?C.accent:C.muted, fontWeight:700, cursor:"pointer" }}>
                {b}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Batting Order #"><input type="number" min={1} max={9} value={f.order} onChange={e=>setF({...f,order:e.target.value})} placeholder="1-9" style={inputStyle()} /></Field>
        <Field label="Grad Year"><input type="number" value={f.gradYear} onChange={e=>setF({...f,gradYear:e.target.value})} placeholder="2025" style={inputStyle()} /></Field>
      </div>
    </Modal>
  );
}

function AddABModal({ onAdd, onClose }) {
  const [inning, setInning] = useState("");
  return (
    <Modal title="New At-Bat" onClose={onClose} onConfirm={()=>onAdd({inningStart:inning})} confirmLabel="Start Tracking">
      <Field label="Inning (optional)">
        <input type="number" min={1} max={15} value={inning} onChange={e=>setInning(e.target.value)} placeholder="e.g. 3" style={inputStyle()} autoFocus />
      </Field>
      <div style={{ marginTop:12, fontSize:13, color:C.muted }}>You'll track pitches live, then record the at-bat outcome when finished.</div>
    </Modal>
  );
}

function Modal({ title, children, onClose, onConfirm, confirmLabel="Confirm", confirmDisabled=false }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:28, width:"100%", maxWidth:440, boxShadow:"0 24px 64px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize:20, fontWeight:800, marginBottom:20 }}>{title}</div>
        {children}
        <div style={{ display:"flex", gap:10, marginTop:24, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={btnStyle({ bg:"transparent", color:C.muted, padding:"10px 18px" })}>Cancel</button>
          <button onClick={onConfirm} disabled={confirmDisabled}
            style={{ ...btnStyle({ bg: confirmDisabled?C.border:C.accent, color: confirmDisabled?C.muted:"#fff", padding:"10px 20px", fontWeight:700 }), cursor: confirmDisabled?"not-allowed":"pointer" }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SHARED UTILS
// ══════════════════════════════════════════════════════════════
function SectionLabel({ children }) {
  return <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:2, marginBottom:12, fontWeight:700 }}>{children}</div>;
}
function Tag({ label, color }) {
  return <span style={{ padding:"3px 8px", borderRadius:20, background:`${color}22`, color, fontSize:11, fontWeight:700, border:`1px solid ${color}44` }}>{label}</span>;
}
function Empty({ icon, title, sub }) {
  return (
    <div style={{ textAlign:"center", padding:"48px 20px", color:C.muted }}>
      <div style={{ fontSize:48, marginBottom:12 }}>{icon}</div>
      <div style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:6 }}>{title}</div>
      <div style={{ fontSize:14 }}>{sub}</div>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize:12, color:C.muted, marginBottom:6, fontWeight:600, textTransform:"uppercase", letterSpacing:1 }}>{label}</div>
      {children}
    </div>
  );
}
const cardStyle = (opts={}) => ({
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 18,
  cursor: opts.hover ? "pointer" : "default",
  transition: opts.hover ? "border-color 0.15s, transform 0.1s" : "none",
  ...(opts.hover ? { ":hover": { borderColor: C.accent } } : {}),
  ...opts
});
const btnStyle = ({ bg, color, padding="10px 16px", fontSize=14, fontWeight=600 }={}) => ({
  background: bg || C.card,
  color: color || C.text,
  border: "none",
  borderRadius: 8,
  padding,
  fontSize,
  fontWeight,
  cursor: "pointer",
  transition: "opacity 0.15s",
});
const inputStyle = () => ({
  width: "100%",
  background: C.bg,
  border: `1px solid ${C.border}`,
  color: C.text,
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 15,
  boxSizing: "border-box",
  outline: "none",
});

// ══════════════════════════════════════════════════════════════
// TEAM OVERVIEW / GAME DAY SHEET
// ══════════════════════════════════════════════════════════════
function TeamReportView({ team, onBack, onSelectPlayer, playerIds }) {
  const isFiltered = Array.isArray(playerIds) && playerIds.length > 0;
  const sorted = [...(team.players||[])]
    .filter(p => !isFiltered || playerIds.includes(p.id))
    .sort((a,b) => (a.order||99)-(b.order||99));

  // Compute per-player stats
  const stats = sorted.map(p => {
    const abs = p.abs || [];
    const abCount = abs.length;
    const hits   = abs.filter(a=>["Single","Double","Triple","HR"].includes(a.outcome)).length;
    const doubles = abs.filter(a=>a.outcome==="Double").length;
    const triples = abs.filter(a=>a.outcome==="Triple").length;
    const hrs    = abs.filter(a=>a.outcome==="HR").length;
    const ks     = abs.filter(a=>["K","K-L"].includes(a.outcome)).length;
    const bbs    = abs.filter(a=>a.outcome==="Walk").length;
    const tracked = abCount > 0;
    const ss = p.seasonStats || {};
    const avg    = tracked ? (hits/abCount).toFixed(3).replace("0.","." ) : (ss.avg || ".---");
    const slg    = tracked ? (((hits-doubles-triples-hrs) + doubles*2 + triples*3 + hrs*4)/abCount).toFixed(3).replace("0.","." ) : (ss.slg || ".---");
    const dispAB = tracked ? abCount : (ss.ab ?? "—");
    const dispH  = tracked ? hits    : (ss.h  ?? "—");
    const disp2B = tracked ? doubles : (ss["2b"] ?? "—");
    const disp3B = tracked ? triples : (ss["3b"] ?? "—");
    const dispHR = tracked ? hrs     : (ss.hr ?? "—");
    const dispK  = tracked ? ks      : (ss.k  ?? "—");
    const dispBB = tracked ? bbs     : (ss.bb ?? "—");
    const allPitches = abs.flatMap(a=>(a.pitches||[]).map(pitch=>({...pitch,outcome:a.outcome})));
    const zoneCount  = allPitches.reduce((acc,p)=>{ acc[p.zone]=(acc[p.zone]||0)+1; return acc; },{});
    const maxZone    = Math.max(...Object.values(zoneCount),1);
    const sprayData  = abs.filter(a=>a.fieldZone&&["Single","Double","Triple","HR"].includes(a.outcome))
                          .reduce((acc,a)=>{ acc[a.fieldZone]=(acc[a.fieldZone]||0)+1; return acc; },{});
    const putAway = p.profile?.putAwayPitch || "FB";
    const firstPitch = p.profile?.firstPitchSwinger || "No";
    const sprayTend  = p.profile?.sprayTend || "—";
    return { p, abCount:dispAB, hits:dispH, doubles:disp2B, triples:disp3B, hrs:dispHR, ks:dispK, bbs:dispBB, avg, slg, zoneCount, maxZone, sprayData, putAway, firstPitch, sprayTend, tracked, seasonStats: p.seasonStats };
  });

  return (
    <div style={{ background:"#fff", color:"#111", minHeight:"100vh", padding:"28px 24px", fontFamily:"'Helvetica Neue',Arial,sans-serif" }}>
      <style>{`
        @media print {
          .no-print { display:none!important; }
          body { background:#fff; }
          .page-break { page-break-before: always; }
        }
        .player-row:hover { background: #f8f8f8 !important; }
      `}</style>

      {/* Screen controls */}
      <div className="no-print" style={{ marginBottom:24, display:"flex", gap:12, alignItems:"center" }}>
        <button onClick={onBack} style={{ padding:"10px 20px", borderRadius:8, border:"1px solid #ccc", background:"#fff", cursor:"pointer", fontWeight:600 }}>← Back</button>
        <button onClick={()=>window.print()} style={{ padding:"10px 22px", borderRadius:8, border:"none", background:"#1d4ed8", color:"#fff", cursor:"pointer", fontWeight:700 }}>🖨 Print {isFiltered ? "Custom Report" : "Game Day Sheet"}</button>
        <span style={{ fontSize:13, color:"#888" }}>Tip: Print → Save as PDF for digital use</span>
      </div>

      {/* ── REPORT HEADER ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", borderBottom:"4px solid #e8312a", paddingBottom:14, marginBottom:24 }}>
        <div>
          <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:3, color:"#888", marginBottom:4 }}>{isFiltered ? `Custom Scouting Report · ${sorted.length} Player${sorted.length!==1?"s":""}` : "Game Day Scouting Sheet"}</div>
          <div style={{ fontSize:38, fontWeight:900, letterSpacing:-1, lineHeight:1 }}>{team.name}</div>
          <div style={{ fontSize:14, color:"#555", marginTop:6 }}>{sorted.length} hitters scouted · Generated {new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
        </div>
        <div style={{ textAlign:"right", fontSize:13, color:"#888" }}>
          <div style={{ fontSize:22, fontWeight:900, color:"#e8312a" }}>⚾ ScoutPro</div>
        </div>
      </div>

      {/* ── QUICK REFERENCE TABLE ── */}
      <div style={{ marginBottom:32 }}>
        <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:2, color:"#888", marginBottom:10, fontWeight:700 }}>Lineup Quick Reference</div>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead>
            <tr style={{ background:"#111", color:"#fff" }}>
              {["#","Name","#","Bats","Src","AVG","AB","H","2B","3B","HR","K","BB","SLG","Steal?","Bunt?","1st Pitch?","Put Away","Spray","Notes"].map(h=>(
                <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontSize:10, textTransform:"uppercase", letterSpacing:1, whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.map(({ p, abCount, hits, doubles, triples, hrs, ks, bbs, avg, slg, putAway, firstPitch, sprayTend, tracked, seasonStats },i) => (
              <tr key={p.id} className="player-row" onClick={()=>onSelectPlayer(p.id)}
                style={{ borderBottom:"1px solid #e5e5e5", background:i%2===0?"#fff":"#fafafa", cursor:"pointer" }}>
                <td style={{ padding:"9px 10px", fontWeight:700, color:"#888", fontSize:12 }}>{p.order||"—"}</td>
                <td style={{ padding:"9px 10px", fontWeight:800 }}>{p.name}</td>
                <td style={{ padding:"9px 10px", color:"#555" }}>#{p.number}</td>
                <td style={{ padding:"9px 10px", fontWeight:700, color: p.bats==="L"?"#1d4ed8":p.bats==="S"?"#7c3aed":"#c00" }}>{p.bats||"R"}</td>
                <td style={{ padding:"9px 10px", fontSize:10, color:"#999", fontWeight:700 }}>{tracked?"Live":seasonStats?(seasonStats.source||"Imp"):"—"}</td>
                <td style={{ padding:"9px 10px", fontWeight:900, color:avg===".---"?"#ccc":"#111", fontVariantNumeric:"tabular-nums" }}>{avg}</td>
                <td style={{ padding:"9px 10px", color:"#555" }}>{abCount||"—"}</td>
                <td style={{ padding:"9px 10px" }}>{hits||"—"}</td>
                <td style={{ padding:"9px 10px" }}>{doubles||"—"}</td>
                <td style={{ padding:"9px 10px" }}>{triples||"—"}</td>
                <td style={{ padding:"9px 10px", fontWeight: hrs>0?800:400, color:hrs>0?"#c00":"#333" }}>{hrs||"—"}</td>
                <td style={{ padding:"9px 10px", color:"#c00" }}>{ks||"—"}</td>
                <td style={{ padding:"9px 10px", color:"#1d4ed8" }}>{bbs||"—"}</td>
                <td style={{ padding:"9px 10px", fontVariantNumeric:"tabular-nums" }}>{slg}</td>
                <td style={{ padding:"9px 10px", fontWeight:700, color: p.profile?.willSteal==="Yes"?"#c00":"#333" }}>{p.profile?.willSteal||"No"}</td>
                <td style={{ padding:"9px 10px", fontWeight:700, color: p.profile?.willBunt==="Yes"?"#1d4ed8":"#333" }}>{p.profile?.willBunt||"No"}</td>
                <td style={{ padding:"9px 10px", fontWeight:700, color: firstPitch==="Yes"?"#c8a800":"#333" }}>{firstPitch}</td>
                <td style={{ padding:"9px 10px", fontWeight:700, color:"#e8312a" }}>{putAway}</td>
                <td style={{ padding:"9px 10px", fontSize:11 }}>{sprayTend}</td>
                <td style={{ padding:"9px 10px", fontSize:11, color:"#666", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.profile?.scoutNotes||""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop:8, fontSize:11, color:"#aaa" }}>Click any row to open that player's full scout card.</div>
      </div>

      {/* ── PER-PLAYER CARDS ── */}
      <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:2, color:"#888", marginBottom:16, fontWeight:700 }}>Individual Hitter Cards</div>

      {stats.map(({ p, abCount, hits, avg, ks, bbs, zoneCount, maxZone, sprayData }, idx) => (
        <div key={p.id} className={idx > 0 && idx % 3 === 0 ? "page-break" : ""}
          style={{ border:"1px solid #ddd", borderRadius:10, marginBottom:20, overflow:"hidden", pageBreakInside:"avoid" }}>

          {/* Card header */}
          <div style={{ background:"#111", color:"#fff", padding:"12px 18px", display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ width:48, height:48, borderRadius:8, background:"#e8312a", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:900 }}>
              {p.number}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:10, textTransform:"uppercase", letterSpacing:2, color:"#aaa" }}>
                {p.order ? `Bats #${p.order}` : ""} · Bats {p.bats||"R"} {p.gradYear?`· '${p.gradYear.toString().slice(-2)}`:""}
              </div>
              <div style={{ fontSize:20, fontWeight:900 }}>{p.name}</div>
            </div>
            {/* Stat pills */}
            <div style={{ display:"flex", gap:16, textAlign:"center" }}>
              {[["AVG",avg,"#f5c518"],["AB",abCount,"#fff"],["K",ks,"#e8312a"],["BB",bbs,"#60a5fa"]].map(([l,v,c])=>(
                <div key={l}>
                  <div style={{ fontSize:20, fontWeight:900, color:c, fontVariantNumeric:"tabular-nums" }}>{v}</div>
                  <div style={{ fontSize:10, color:"#888", letterSpacing:1 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Card body: 3 columns */}
          <div style={{ display:"grid", gridTemplateColumns:"140px 160px 1fr", gap:0 }}>

            {/* Zone heat */}
            <div style={{ padding:"14px", borderRight:"1px solid #eee" }}>
              <div style={{ fontSize:9, textTransform:"uppercase", letterSpacing:2, color:"#999", marginBottom:8 }}>Zone Freq.</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:2 }}>
                {ZONES.map(z=>{
                  const count=zoneCount[z]||0;
                  const intensity=count/maxZone;
                  return (
                    <div key={z} style={{ aspectRatio:"1", borderRadius:3, border:"1px solid #e5e5e5", background:`rgba(232,49,42,${0.05+intensity*0.75})`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <span style={{ fontSize:11, fontWeight:700, color:intensity>0.5?"#fff":"#333" }}>{count||""}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mini spray */}
            <div style={{ padding:"14px", borderRight:"1px solid #eee" }}>
              <div style={{ fontSize:9, textTransform:"uppercase", letterSpacing:2, color:"#999", marginBottom:8 }}>Hit Spray</div>
              <MiniSpray sprayData={sprayData} />
            </div>

            {/* Scout info */}
            <div style={{ padding:"14px" }}>
              <div style={{ fontSize:9, textTransform:"uppercase", letterSpacing:2, color:"#999", marginBottom:8 }}>Scouting Profile</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 16px", fontSize:12 }}>
                {[
                  ["Will Steal", p.profile?.willSteal||"No"],
                  ["Will Bunt",  p.profile?.willBunt||"No"],
                  ["1st Pitch",  p.profile?.firstPitchSwinger||"No"],
                  ["Put Away",   p.profile?.putAwayPitch||"FB"],
                  ["Spray",      p.profile?.sprayTend||"—"],
                  ["Base Run",   p.profile?.baseRunningNotes||"—"],
                ].map(([l,v])=>(
                  <div key={l}>
                    <span style={{ color:"#888", fontSize:10 }}>{l}: </span>
                    <span style={{ fontWeight:700, color: v==="Yes"?"#c00":v==="No"?"#333":"#111" }}>{v}</span>
                  </div>
                ))}
              </div>
              {p.profile?.scoutNotes && (
                <div style={{ marginTop:10, paddingTop:10, borderTop:"1px solid #eee", fontSize:11, color:"#444", lineHeight:1.6 }}>
                  <span style={{ fontWeight:700, color:"#888", textTransform:"uppercase", fontSize:9, letterSpacing:1 }}>Notes: </span>
                  {p.profile.scoutNotes}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      {sorted.length === 0 && (
        <div style={{ textAlign:"center", padding:48, color:"#aaa" }}>
          <div style={{ fontSize:32, marginBottom:12 }}>⚾</div>
          <div style={{ fontSize:18, fontWeight:700, color:"#555" }}>No players scouted yet</div>
          <div style={{ fontSize:13, marginTop:4 }}>Add players and track at-bats to generate this report</div>
        </div>
      )}

      <div style={{ marginTop:24, textAlign:"center", fontSize:10, color:"#bbb", borderTop:"1px solid #eee", paddingTop:16 }}>
        ScoutPro Game Day Sheet · {team.name} · {new Date().toLocaleDateString()}
      </div>
    </div>
  );
}

function MiniSpray({ sprayData }) {
  const total = Object.values(sprayData).reduce((a,b)=>a+b,0)||1;
  const zones = [
    { key:"LF",  x:38,  y:68,  label:"LF" },
    { key:"LCF", x:66,  y:42,  label:"LC" },
    { key:"CF",  x:95,  y:30,  label:"CF" },
    { key:"RCF", x:124, y:42,  label:"RC" },
    { key:"RF",  x:152, y:68,  label:"RF" },
    { key:"Infield", x:95, y:80, label:"IF" },
  ];
  return (
    <svg viewBox="0 0 190 115" style={{ width:"100%", display:"block" }}>
      <path d="M95 108 L28 48 Q95 5 162 48 Z" fill="#e8f5e8" stroke="#ccc" strokeWidth={1} />
      <path d="M95 108 L58 72 L95 62 L132 72 Z" fill="#d4edda" stroke="#bbb" strokeWidth={0.5} />
      {zones.map(z=>{
        const count = sprayData[z.key]||0;
        const pct   = count/total;
        const r     = 4 + pct*14;
        return (
          <g key={z.key}>
            {count>0 && <circle cx={z.x} cy={z.y} r={r} fill="#e8312a" opacity={0.5+pct*0.5} />}
            <text x={z.x} y={z.y+1} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill={count>0?"#fff":"#999"} fontWeight={700}>{count||z.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════
// IMPORT STATS (MaxPreps / screenshots / PDF via Claude vision)
// ══════════════════════════════════════════════════════════════
const STAT_KEYS = ["avg","ab","h","2b","3b","hr","rbi","bb","k","sb","obp","slg"];

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result.split(",")[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const normalizeName = (s="") => s.toLowerCase().replace(/[^a-z]/g,"");

const findBestMatch = (name, players) => {
  const target = normalizeName(name);
  if (!target) return null;
  const exact = players.find(p => normalizeName(p.name)===target);
  if (exact) return exact.id;
  // last-name match
  const lastWord = (name||"").trim().split(/\s+/).pop();
  const ln = normalizeName(lastWord);
  const partial = players.find(p => normalizeName(p.name).includes(ln) && ln.length>2);
  return partial ? partial.id : null;
};

const EXTRACT_PROMPT = `You are reading a baseball stats table (from MaxPreps or a similar site, screenshot or PDF).
Extract every hitter row you can find. Return ONLY a valid JSON array, no markdown fences, no commentary.
Each item must be an object with these fields (use null if a field is not present):
{
  "name": string,
  "number": string or null,
  "bats": "R"|"L"|"S"|null,
  "avg": string (e.g. ".345"),
  "ab": number,
  "h": number,
  "2b": number,
  "3b": number,
  "hr": number,
  "rbi": number,
  "bb": number,
  "k": number,
  "sb": number,
  "obp": string or null,
  "slg": string or null
}
Only include rows that represent an actual player with stats (skip team totals, headers, or empty rows). Return the JSON array now.`;

function ImportStatsModal({ existingPlayers, onImport, onClose }) {
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | working | review | error
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [source, setSource] = useState("MaxPreps");
  const fileInputRef = useRef(null);

  const handleFiles = (e) => {
    setFiles(Array.from(e.target.files||[]));
    setStatus("idle");
    setError(null);
  };

  const runExtraction = async () => {
    if (files.length===0) return;
    setStatus("working");
    setError(null);
    try {
      const contentBlocks = [];
      for (const file of files) {
        const b64 = await fileToBase64(file);
        if (file.type === "application/pdf") {
          contentBlocks.push({ type:"document", source:{ type:"base64", media_type:"application/pdf", data:b64 } });
        } else {
          contentBlocks.push({ type:"image", source:{ type:"base64", media_type:file.type||"image/png", data:b64 } });
        }
      }
      contentBlocks.push({ type:"text", text: EXTRACT_PROMPT });

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          messages: [{ role:"user", content: contentBlocks }]
        })
      });
      const data = await resp.json();
      const textBlocks = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
      const clean = textBlocks.replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(clean);
      if (!Array.isArray(parsed) || parsed.length===0) throw new Error("No player rows found in the file(s).");

      const withMatch = parsed.map(row => ({
        include: true,
        name: row.name || "",
        number: row.number || "",
        bats: row.bats || "R",
        matchId: findBestMatch(row.name, existingPlayers),
        stats: STAT_KEYS.reduce((acc,k)=>{ acc[k]=row[k]??""; return acc; },{})
      }));
      setRows(withMatch);
      setStatus("review");
    } catch (e) {
      setError(e.message || "Failed to extract stats. Try a clearer image or fewer pages at once.");
      setStatus("error");
    }
  };

  const updateRow = (i, patch) => setRows(rows.map((r,idx)=> idx===i ? {...r, ...patch} : r));
  const updateStat = (i, key, val) => setRows(rows.map((r,idx)=> idx===i ? {...r, stats:{...r.stats,[key]:val}} : r));

  const confirmImport = () => {
    const toImport = rows.filter(r=>r.include).map(r => ({
      name: r.name, number: r.number, bats: r.bats, matchId: r.matchId, stats: r.stats
    }));
    onImport(toImport, source);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:28, width:"100%", maxWidth:status==="review"?960:520, maxHeight:"88vh", overflowY:"auto", boxShadow:"0 24px 64px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize:20, fontWeight:800, marginBottom:6 }}>📥 Import Stats</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>
          Upload a screenshot or PDF of a team's stats page (MaxPreps, GameChanger export, etc.). Claude will read the table and pull out each hitter's season stats.
        </div>

        {(status==="idle"||status==="error"||status==="working") && (
          <>
            <Field label="Source">
              <div style={{ display:"flex", gap:8 }}>
                {["MaxPreps","GameChanger","Other"].map(s=>(
                  <button key={s} onClick={()=>setSource(s)}
                    style={{ padding:"8px 16px", borderRadius:8, border:`2px solid ${source===s?C.accent:C.border}`, background: source===s?`${C.accent}22`:"transparent", color: source===s?C.accent:C.muted, fontWeight:700, cursor:"pointer", fontSize:13 }}>
                    {s}
                  </button>
                ))}
              </div>
            </Field>

            <div style={{ marginTop:14 }}>
              <Field label="Image(s) or PDF">
                <div onClick={()=>fileInputRef.current?.click()}
                  style={{ border:`2px dashed ${C.border}`, borderRadius:10, padding:24, textAlign:"center", cursor:"pointer", background:C.bg }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>📄</div>
                  <div style={{ fontWeight:700, marginBottom:4 }}>
                    {files.length>0 ? `${files.length} file${files.length!==1?"s":""} selected` : "Tap to choose files"}
                  </div>
                  <div style={{ fontSize:12, color:C.muted }}>
                    {files.length>0 ? files.map(f=>f.name).join(", ") : "Photos, screenshots, or a PDF — multiple pages OK"}
                  </div>
                </div>
                <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf" onChange={handleFiles} style={{ display:"none" }} />
              </Field>
            </div>

            {status==="error" && (
              <div style={{ marginTop:12, padding:"10px 14px", borderRadius:8, background:`${C.accent}22`, border:`1px solid ${C.accent}44`, color:C.accent, fontSize:13 }}>
                ⚠ {error}
              </div>
            )}

            <div style={{ display:"flex", gap:10, marginTop:24, justifyContent:"flex-end" }}>
              <button onClick={onClose} style={btnStyle({ bg:"transparent", color:C.muted, padding:"10px 18px" })}>Cancel</button>
              <button onClick={runExtraction} disabled={files.length===0 || status==="working"}
                style={{ ...btnStyle({ bg: files.length===0?C.border:C.accent, color: files.length===0?C.muted:"#fff", padding:"10px 22px", fontWeight:700 }), cursor: files.length===0?"not-allowed":"pointer" }}>
                {status==="working" ? "Reading…" : "Extract Stats"}
              </button>
            </div>
            {status==="working" && (
              <div style={{ marginTop:12, fontSize:13, color:C.muted, textAlign:"center" }}>Analyzing file with Claude — this can take 10–20 seconds…</div>
            )}
          </>
        )}

        {status==="review" && (
          <>
            <div style={{ fontSize:13, color:C.muted, marginBottom:14 }}>
              Found {rows.length} player{rows.length!==1?"s":""}. Review matches below — unmatched players will be added as new roster entries. Uncheck any row to skip it.
            </div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead>
                  <tr style={{ borderBottom:`2px solid ${C.border}` }}>
                    {["","Name","#","Bats","Match to","AVG","AB","H","HR","RBI","BB","K","SB"].map(h=>(
                      <th key={h} style={{ padding:"6px 8px", textAlign:"left", color:C.muted, fontSize:11, textTransform:"uppercase", letterSpacing:1, whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r,i)=>(
                    <tr key={i} style={{ borderBottom:`1px solid ${C.border}`, opacity: r.include?1:0.4 }}>
                      <td style={{ padding:"6px 8px" }}>
                        <input type="checkbox" checked={r.include} onChange={e=>updateRow(i,{include:e.target.checked})} />
                      </td>
                      <td style={{ padding:"6px 8px", minWidth:120 }}>
                        <input value={r.name} onChange={e=>updateRow(i,{name:e.target.value})} style={miniInput()} />
                      </td>
                      <td style={{ padding:"6px 8px", minWidth:50 }}>
                        <input value={r.number} onChange={e=>updateRow(i,{number:e.target.value})} style={{...miniInput(), width:44}} />
                      </td>
                      <td style={{ padding:"6px 8px" }}>
                        <select value={r.bats} onChange={e=>updateRow(i,{bats:e.target.value})} style={miniInput()}>
                          {["R","L","S"].map(b=><option key={b} value={b}>{b}</option>)}
                        </select>
                      </td>
                      <td style={{ padding:"6px 8px", minWidth:150 }}>
                        <select value={r.matchId||""} onChange={e=>updateRow(i,{matchId:e.target.value||null})} style={miniInput()}>
                          <option value="">+ New player</option>
                          {existingPlayers.map(p=>(
                            <option key={p.id} value={p.id}>#{p.number} {p.name}</option>
                          ))}
                        </select>
                      </td>
                      {["avg","ab","h","hr","rbi","bb","k","sb"].map(key=>(
                        <td key={key} style={{ padding:"6px 8px" }}>
                          <input value={r.stats[key]??""} onChange={e=>updateStat(i,key,e.target.value)} style={{...miniInput(), width:48, textAlign:"center"}} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:24, justifyContent:"flex-end" }}>
              <button onClick={onClose} style={btnStyle({ bg:"transparent", color:C.muted, padding:"10px 18px" })}>Cancel</button>
              <button onClick={()=>{setStatus("idle"); setRows([]);}} style={btnStyle({ bg:C.card, color:C.text, padding:"10px 18px" })}>← Re-upload</button>
              <button onClick={confirmImport} disabled={!rows.some(r=>r.include)}
                style={{ ...btnStyle({ bg: rows.some(r=>r.include)?C.green:C.border, color: rows.some(r=>r.include)?"#000":C.muted, padding:"10px 22px", fontWeight:700 }), cursor: rows.some(r=>r.include)?"pointer":"not-allowed" }}>
                ✓ Import {rows.filter(r=>r.include).length} Player{rows.filter(r=>r.include).length!==1?"s":""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const miniInput = () => ({
  width: "100%",
  background: C.bg,
  border: `1px solid ${C.border}`,
  color: C.text,
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 12,
  boxSizing: "border-box",
  outline: "none",
});

// ══════════════════════════════════════════════════════════════
// LIVE GAME: SETUP MODAL
// ══════════════════════════════════════════════════════════════
const defaultLineup = (team) => {
  const sorted = [...(team?.players||[])].sort((a,b)=>(Number(a.order)||99)-(Number(b.order)||99));
  const ids = sorted.slice(0,9).map(p=>p.id);
  while (ids.length < 9) ids.push(null);
  return ids;
};

function StartGameModal({ teams, defaultTeamId, onStart, onClose }) {
  const [mode, setMode] = useState("single"); // single | matchup
  const [teamAId, setTeamAId] = useState(defaultTeamId || teams[0]?.id || "");
  const [teamBId, setTeamBId] = useState("");
  const teamA = teams.find(t=>t.id===teamAId);
  const teamB = teams.find(t=>t.id===teamBId);

  const [lineupA, setLineupA] = useState(()=>defaultLineup(teamA));
  const [lineupB, setLineupB] = useState([]);

  // Re-derive default lineup when team selection changes
  const handleTeamA = (id) => { setTeamAId(id); setLineupA(defaultLineup(teams.find(t=>t.id===id))); };
  const handleTeamB = (id) => { setTeamBId(id); setLineupB(defaultLineup(teams.find(t=>t.id===id))); };

  const aReady = lineupA.some(Boolean);
  const bReady = mode==="single" || lineupB.some(Boolean);
  const canStart = teamAId && aReady && (mode==="single" || (teamBId && bReady && teamBId!==teamAId));

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:28, width:"100%", maxWidth:680, maxHeight:"88vh", overflowY:"auto", boxShadow:"0 24px 64px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize:20, fontWeight:800, marginBottom:6 }}>🎮 Start Game</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>Set up lineups to track at-bats in order. You can sub players in at any time during the game.</div>

        {/* Mode select */}
        <Field label="Track">
          <div style={{ display:"flex", gap:8 }}>
            {[["single","Just one team"],["matchup","Both teams (matchup)"]].map(([m,label])=>(
              <button key={m} onClick={()=>{ setMode(m); if(m==="single"){ setTeamBId(""); setLineupB([]); } }}
                style={{ flex:1, padding:"12px", borderRadius:10, border:`2px solid ${mode===m?C.accent:C.border}`, background: mode===m?`${C.accent}22`:"transparent", color: mode===m?C.accent:C.muted, fontWeight:700, cursor:"pointer" }}>
                {label}
              </button>
            ))}
          </div>
        </Field>

        {/* Team selectors */}
        <div style={{ display:"flex", gap:12, marginTop:14 }}>
          <div style={{ flex:1 }}>
            <Field label={mode==="matchup" ? "Team A (bats in bottom of inning)" : "Team"}>
              <select value={teamAId} onChange={e=>handleTeamA(e.target.value)} style={inputStyle()}>
                <option value="">Select team…</option>
                {teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>
          {mode==="matchup" && (
            <div style={{ flex:1 }}>
              <Field label="Team B (bats in top of inning)">
                <select value={teamBId} onChange={e=>handleTeamB(e.target.value)} style={inputStyle()}>
                  <option value="">Select team…</option>
                  {teams.filter(t=>t.id!==teamAId).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            </div>
          )}
        </div>

        {/* Lineup builders */}
        {teamA && (
          <div style={{ marginTop:18 }}>
            <SectionLabel>{teamA.name} — Batting Order</SectionLabel>
            <LineupBuilder team={teamA} lineup={lineupA} onChange={setLineupA} />
          </div>
        )}
        {mode==="matchup" && teamB && (
          <div style={{ marginTop:18 }}>
            <SectionLabel>{teamB.name} — Batting Order</SectionLabel>
            <LineupBuilder team={teamB} lineup={lineupB} onChange={setLineupB} />
          </div>
        )}

        <div style={{ display:"flex", gap:10, marginTop:24, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={btnStyle({ bg:"transparent", color:C.muted, padding:"10px 18px" })}>Cancel</button>
          <button onClick={()=>canStart && onStart({ mode, teamAId, teamBId: mode==="matchup"?teamBId:null, lineupA: lineupA.filter(Boolean), lineupB: lineupB.filter(Boolean) })}
            disabled={!canStart}
            style={{ ...btnStyle({ bg: canStart?C.gold:C.border, color: canStart?"#000":C.muted, padding:"10px 24px", fontWeight:800 }), cursor: canStart?"pointer":"not-allowed" }}>
            ▶ Start Game
          </button>
        </div>
        {!canStart && teams.length<2 && mode==="matchup" && (
          <div style={{ marginTop:10, fontSize:12, color:C.muted }}>You need at least two scouted teams to start a matchup.</div>
        )}
      </div>
    </div>
  );
}

function LineupBuilder({ team, lineup, onChange }) {
  const players = team.players || [];
  const setSlot = (i, val) => {
    const next = [...lineup];
    next[i] = val || null;
    onChange(next);
  };
  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
      {Array.from({length:9}).map((_,i)=>(
        <div key={i} style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ width:20, fontSize:12, color:C.muted, fontWeight:700, textAlign:"right" }}>{i+1}</div>
          <select value={lineup[i]||""} onChange={e=>setSlot(i, e.target.value)} style={{...inputStyle(), padding:"8px 8px", fontSize:13}}>
            <option value="">— empty —</option>
            {players.map(p=><option key={p.id} value={p.id}>#{p.number} {p.name}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// LIVE GAME VIEW
// ══════════════════════════════════════════════════════════════
const getPlayer = (teams, teamId, playerId) => {
  const team = teams.find(t=>t.id===teamId);
  return team?.players?.find(p=>p.id===playerId);
};

function LiveGameView({ game, teams, onTrackAB, onSwitchSides, onAdvance, onSetIdx, onSub, onAddPlayer, onEndGame, onDeleteGame, onRefresh, onViewPlayer }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [subTarget, setSubTarget] = useState(null); // { side, slotIdx }
  const teamA = teams.find(t=>t.id===game.teamAId);
  const teamB = teams.find(t=>t.id===game.teamBId);
  const isMatchup = game.mode==="matchup";

  const side = game.battingSide;
  const battingTeam = side==="A" ? teamA : teamB;
  const lineup = side==="A" ? game.lineupA : game.lineupB;
  const idx = side==="A" ? game.idxA : game.idxB;
  const currentPlayer = getPlayer(teams, battingTeam?.id, lineup[idx]);

  const inningLabel = !isMatchup ? `Inning ${game.inning}`
    : `${game.half==="top"?"Top":"Bottom"} ${game.inning}`;

  return (
    <div style={{ maxWidth:1000, margin:"0 auto", padding:"20px 16px" }}>
      {/* Header */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:16, marginBottom:16, display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:2 }}>{isMatchup ? "Matchup" : "Single Team"} · {inningLabel}</div>
          <div style={{ fontSize:18, fontWeight:800 }}>
            {teamA?.name}{isMatchup && <> <span style={{ color:C.muted, fontWeight:400 }}>vs</span> {teamB?.name}</>}
          </div>
        </div>
        <div style={{ flex:1 }} />
        {isMatchup && (
          <button onClick={onSwitchSides} style={btnStyle({ bg:C.blue, color:"#fff", padding:"10px 16px", fontWeight:700 })}>⇆ Switch Sides</button>
        )}
        <button onClick={onRefresh} title="Pull latest from cloud (use if you switched devices)" style={btnStyle({ bg:C.card, color:C.muted, padding:"10px 14px", fontWeight:700 })}>↻ Refresh</button>
        <button onClick={onEndGame} style={btnStyle({ bg:C.accent, color:"#fff", padding:"10px 16px", fontWeight:700 })}>■ End Game</button>
        {confirmDelete ? (
          <>
            <button onClick={onDeleteGame} style={btnStyle({ bg:C.accent, color:"#fff", padding:"10px 14px", fontWeight:700 })}>Confirm Delete</button>
            <button onClick={()=>setConfirmDelete(false)} style={btnStyle({ bg:"transparent", color:C.muted, padding:"10px 14px" })}>Cancel</button>
          </>
        ) : (
          <button onClick={()=>setConfirmDelete(true)} title="Delete this game entirely" style={{ background:"transparent", border:`1px solid ${C.border}`, color:C.muted, borderRadius:8, padding:"10px 14px", cursor:"pointer", fontSize:18 }}>🗑</button>
        )}
      </div>

      {/* Now Batting */}
      <div style={{ ...cardStyle(), marginBottom:16, background:`linear-gradient(135deg, ${C.card}, ${C.surface})`, border:`1px solid ${C.gold}44` }}>
        <SectionLabel>
          Now Batting{isMatchup && <span style={{ color:C.gold }}> · {battingTeam?.name}</span>}
        </SectionLabel>
        {currentPlayer ? (
          <div style={{ display:"flex", alignItems:"center", gap:18, flexWrap:"wrap" }}>
            <div style={{ width:60, height:60, borderRadius:12, background:`linear-gradient(135deg,${C.accentDim},${C.accent})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, fontWeight:900 }}>
              {currentPlayer.number}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:24, fontWeight:900 }}>{currentPlayer.name}</div>
              <div style={{ fontSize:13, color:C.muted }}>
                Batting #{idx+1} · Bats {currentPlayer.bats||"R"}
                {currentPlayer.profile?.willSteal==="Yes" && <> · <span style={{ color:C.green, fontWeight:700 }}>SB Threat</span></>}
                {currentPlayer.profile?.firstPitchSwinger==="Yes" && <> · <span style={{ color:C.gold, fontWeight:700 }}>1st Pitch Swinger</span></>}
              </div>
            </div>
            <button onClick={()=>onViewPlayer(battingTeam.id, currentPlayer.id)} style={btnStyle({ bg:C.card, color:C.text, padding:"10px 16px", fontWeight:600 })}>View Profile</button>
            <button onClick={onTrackAB} style={btnStyle({ bg:C.gold, color:"#000", padding:"14px 28px", fontWeight:800, fontSize:15 })}>▶ Track At-Bat</button>
          </div>
        ) : (
          <div style={{ color:C.muted }}>No player in this lineup spot — tap Sub below to fill it.</div>
        )}
      </div>

      {/* Lineups */}
      <div style={{ display:"grid", gridTemplateColumns: isMatchup ? "1fr 1fr" : "1fr", gap:16 }}>
        <LineupCard
          team={teamA} lineup={game.lineupA} idx={game.idxA} active={side==="A"}
          onJump={(i)=>onSetIdx("A",i)} onSub={(i)=>setSubTarget({side:"A", slotIdx:i})}
          teams={teams} onViewPlayer={onViewPlayer}
        />
        {isMatchup && (
          <LineupCard
            team={teamB} lineup={game.lineupB} idx={game.idxB} active={side==="B"}
            onJump={(i)=>onSetIdx("B",i)} onSub={(i)=>setSubTarget({side:"B", slotIdx:i})}
            teams={teams} onViewPlayer={onViewPlayer}
          />
        )}
      </div>

      {subTarget && (
        <SubModal
          team={subTarget.side==="A" ? teamA : teamB}
          onPick={(playerId)=>{ onSub(subTarget.side, subTarget.slotIdx, playerId); setSubTarget(null); }}
          onAddPlayer={onAddPlayer}
          onClose={()=>setSubTarget(null)}
        />
      )}
    </div>
  );
}

function LineupCard({ team, lineup, idx, active, onJump, onSub, teams, onViewPlayer }) {
  return (
    <div style={cardStyle()}>
      <SectionLabel>
        {team?.name} Lineup {active && <span style={{ color:C.gold }}>· Up Now</span>}
      </SectionLabel>
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {lineup.map((playerId,i)=>{
          const player = getPlayer(teams, team?.id, playerId);
          const isCurrent = active && i===idx;
          return (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", borderRadius:8, background: isCurrent?`${C.gold}22`:C.bg, border:`1px solid ${isCurrent?C.gold:C.border}` }}>
              <div style={{ width:20, fontSize:12, fontWeight:800, color:isCurrent?C.gold:C.muted, textAlign:"center" }}>{i+1}</div>
              {player ? (
                <div onClick={()=>onViewPlayer(team.id, player.id)} style={{ flex:1, cursor:"pointer" }}>
                  <span style={{ fontWeight:700 }}>#{player.number} {player.name}</span>
                  <span style={{ color:C.muted, fontSize:12 }}> · {player.bats||"R"}</span>
                </div>
              ) : (
                <div style={{ flex:1, color:C.muted, fontStyle:"italic" }}>empty</div>
              )}
              {!isCurrent && (
                <button onClick={()=>onJump(i)} title="Jump to this batter" style={{ background:"transparent", border:`1px solid ${C.border}`, color:C.muted, borderRadius:6, padding:"4px 8px", fontSize:11, cursor:"pointer" }}>Set Up Next</button>
              )}
              <button onClick={()=>onSub(i)} style={{ background:"transparent", border:`1px solid ${C.border}`, color:C.blue, borderRadius:6, padding:"4px 8px", fontSize:11, cursor:"pointer", fontWeight:700 }}>Sub</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubModal({ team, onPick, onAddPlayer, onClose }) {
  const [tab, setTab] = useState("existing"); // existing | new
  const [newPlayer, setNewPlayer] = useState({ name:"", number:"", bats:"R" });
  const players = team?.players || [];

  const confirmNew = () => {
    if (!newPlayer.name.trim() || !newPlayer.number.trim()) return;
    const id = onAddPlayer(team.id, { ...newPlayer, order:"", gradYear:"" });
    onPick(id);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1100, padding:20 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:24, width:"100%", maxWidth:420, maxHeight:"80vh", overflowY:"auto", boxShadow:"0 24px 64px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:14 }}>Substitute Player</div>
        <div style={{ display:"flex", gap:4, marginBottom:14, background:C.bg, borderRadius:8, padding:4 }}>
          {[["existing","From Roster"],["new","New Player"]].map(([t,label])=>(
            <button key={t} onClick={()=>setTab(t)} style={{ flex:1, padding:"8px 0", borderRadius:6, border:"none", cursor:"pointer", fontWeight:700, fontSize:13, background: tab===t?C.accent:"transparent", color: tab===t?"#fff":C.muted }}>{label}</button>
          ))}
        </div>
        {tab==="existing" ? (
          <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:280, overflowY:"auto" }}>
            {players.map(p=>(
              <button key={p.id} onClick={()=>onPick(p.id)} style={{ textAlign:"left", padding:"10px 12px", borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text, cursor:"pointer", fontSize:14 }}>
                <span style={{ fontWeight:700 }}>#{p.number}</span> {p.name} <span style={{ color:C.muted, fontSize:12 }}>· {p.bats||"R"}</span>
              </button>
            ))}
            {players.length===0 && <div style={{ color:C.muted, fontSize:13 }}>No other players on this roster yet.</div>}
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Field label="Name"><input value={newPlayer.name} onChange={e=>setNewPlayer({...newPlayer,name:e.target.value})} placeholder="Full name" style={inputStyle()} /></Field>
            <Field label="Jersey #"><input value={newPlayer.number} onChange={e=>setNewPlayer({...newPlayer,number:e.target.value})} placeholder="e.g. 14" style={inputStyle()} /></Field>
            <Field label="Bats">
              <div style={{ display:"flex", gap:8 }}>
                {["R","L","S"].map(b=>(
                  <button key={b} onClick={()=>setNewPlayer({...newPlayer,bats:b})}
                    style={{ flex:1, padding:"10px", borderRadius:8, border:`2px solid ${newPlayer.bats===b?C.accent:C.border}`, background: newPlayer.bats===b?`${C.accent}22`:"transparent", color:newPlayer.bats===b?C.accent:C.muted, fontWeight:700, cursor:"pointer" }}>{b}</button>
                ))}
              </div>
            </Field>
            <button onClick={confirmNew} disabled={!newPlayer.name.trim()||!newPlayer.number.trim()}
              style={{ ...btnStyle({ bg: newPlayer.name.trim()&&newPlayer.number.trim() ? C.green : C.border, color: newPlayer.name.trim()&&newPlayer.number.trim() ? "#000":C.muted, padding:"12px", fontWeight:800 }), cursor: newPlayer.name.trim()&&newPlayer.number.trim()?"pointer":"not-allowed" }}>
              + Add & Sub In
            </button>
          </div>
        )}
        <button onClick={onClose} style={{ ...btnStyle({ bg:"transparent", color:C.muted, padding:"10px 0" }), marginTop:14, width:"100%" }}>Cancel</button>
      </div>
    </div>
  );
}
