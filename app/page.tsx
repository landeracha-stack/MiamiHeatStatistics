'use client';
import { useEffect, useState } from 'react';

const SEASON = 2025;
const HEAT_ID = 16;

const getApiKey = () => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('apikey') ?? '';
};

const api = async (url: string) => {
    const key = getApiKey();
    if (!key) throw new Error('No API key provided');
    const r = await fetch(url, { headers: { Authorization: key } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
};

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const parseDate = (dateStr: string) => new Date(dateStr + 'T12:00:00');

export default function HeatStats() {
    const [players, setPlayers] = useState<any[]>([]);
    const [lastGame, setLastGame] = useState<any>(null);
    const [lastStats, setLastStats] = useState<any[]>([]);
    const [games, setGames] = useState<any[]>([]);
    const [standings, setStandings] = useState<any>(null);
    const [teamPPG, setTeamPPG] = useState<number>(0);
    const [loadPlayers, setLoadPlayers] = useState(true);
    const [loadGames, setLoadGames] = useState(true);
    const [hasKey, setHasKey] = useState(true);
    const [tab, setTab] = useState('players');
    const [sortKey, setSortKey] = useState('pts');

    useEffect(() => {
        if (!getApiKey()) { setHasKey(false); setLoadPlayers(false); setLoadGames(false); }
    }, []);

    // ── Load games + last game stats + standings ─────────────────
    useEffect(() => {
        if (!hasKey) return;
        async function run() {
            try {
                const gd = await api(
                    `https://api.balldontlie.io/v1/games?team_ids[]=${HEAT_ID}&seasons[]=${SEASON}&per_page=100`
                );
                const heatGames: any[] = (gd.data ?? []).filter((g: any) =>
                    Number(g.home_team?.id) === HEAT_ID || Number(g.visitor_team?.id) === HEAT_ID
                );
                setGames(heatGames);

                const finished = [...heatGames]
                    .filter((g: any) => g.status === 'Final')
                    .sort((a: any, b: any) => parseDate(b.date).getTime() - parseDate(a.date).getTime());

                if (finished.length > 0) {
                    const total = finished.reduce((s: number, g: any) => {
                        const score = Number(g.home_team?.id) === HEAT_ID ? g.home_team_score : g.visitor_team_score;
                        return s + (Number(score) || 0);
                    }, 0);
                    setTeamPPG(total / finished.length);

                    const last = finished[0];
                    setLastGame(last);
                    const sd = await api(`https://api.balldontlie.io/v1/stats?game_ids[]=${last.id}&per_page=100`);
                    setLastStats(
                        (sd.data ?? []).filter((s: any) =>
                            Number(s.team?.id) === HEAT_ID && s.min && s.min !== '0' && s.min !== '00'
                        )
                    );
                }

                try {
                    const std = await api(`https://api.balldontlie.io/v1/standings?season=${SEASON}`);
                    const hs = (std.data ?? []).find((s: any) =>
                        Number(s.team?.id) === HEAT_ID ||
                        s.team?.full_name?.toLowerCase().includes('miami heat')
                    );
                    setStandings(hs ?? null);
                } catch { /* optional */ }
            } catch (e) {
                console.error('Games load error:', e);
            } finally {
                setLoadGames(false);
            }
        }
        run();
    }, [hasKey]);

    // ── Load player stats from game logs ─────────────────────────
    useEffect(() => {
        if (!hasKey) return;
        async function run() {
            try {
                const gd = await api(
                    `https://api.balldontlie.io/v1/games?team_ids[]=${HEAT_ID}&seasons[]=${SEASON}&per_page=100`
                );
                const finishedIds: number[] = (gd.data ?? [])
                    .filter((g: any) =>
                        g.status === 'Final' &&
                        (Number(g.home_team?.id) === HEAT_ID || Number(g.visitor_team?.id) === HEAT_ID)
                    )
                    .map((g: any) => g.id);

                if (finishedIds.length === 0) { setLoadPlayers(false); return; }

                let allStats: any[] = [];
                const chunkSize = 10;
                for (let i = 0; i < finishedIds.length; i += chunkSize) {
                    const chunk = finishedIds.slice(i, i + chunkSize);
                    const q = chunk.map((id: number) => `game_ids[]=${id}`).join('&');
                    try {
                        const sd = await api(`https://api.balldontlie.io/v1/stats?${q}&per_page=100`);
                        const heatRows = (sd.data ?? []).filter((s: any) =>
                            Number(s.team?.id) === HEAT_ID &&
                            s.min && s.min !== '0' && s.min !== '00'
                        );
                        allStats = [...allStats, ...heatRows];
                    } catch { /* skip chunk */ }
                    await wait(200);
                }

                const map: Record<number, any> = {};
                for (const s of allStats) {
                    const pid = s.player?.id;
                    if (!pid) continue;
                    if (!map[pid]) {
                        map[pid] = {
                            player: s.player, games: 0,
                            pts: 0, reb: 0, ast: 0, stl: 0, blk: 0,
                            fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0,
                        };
                    }
                    const p = map[pid];
                    p.games++;
                    p.pts += Number(s.pts) || 0; p.reb += Number(s.reb) || 0;
                    p.ast += Number(s.ast) || 0; p.stl += Number(s.stl) || 0;
                    p.blk += Number(s.blk) || 0; p.fgm += Number(s.fgm) || 0;
                    p.fga += Number(s.fga) || 0; p.fg3m += Number(s.fg3m) || 0;
                    p.fg3a += Number(s.fg3a) || 0; p.ftm += Number(s.ftm) || 0;
                    p.fta += Number(s.fta) || 0;
                }

                const merged = Object.values(map)
                    .filter((p: any) => p.games >= 1)
                    .map((p: any) => ({
                        player: p.player,
                        games_played: p.games,
                        pts: p.pts / p.games, reb: p.reb / p.games,
                        ast: p.ast / p.games, stl: p.stl / p.games,
                        blk: p.blk / p.games,
                        fg_pct: p.fga > 0 ? p.fgm / p.fga : 0,
                        fg3_pct: p.fg3a > 0 ? p.fg3m / p.fg3a : 0,
                        ft_pct: p.fta > 0 ? p.ftm / p.fta : 0,
                        _fgm: p.fgm, _fga: p.fga, _fg3m: p.fg3m, _fg3a: p.fg3a, _ftm: p.ftm, _fta: p.fta,
                    }));

                setPlayers(merged);
            } catch (e) {
                console.error('Player load error:', e);
            } finally {
                setLoadPlayers(false);
            }
        }
        run();
    }, [hasKey]);

    // ── Derived ──────────────────────────────────────────────────
    const pct = (v: number) => v ? (v * 100).toFixed(1) + '%' : '-';
    const num = (v: number) => v != null ? v.toFixed(1) : '-';

    const sortedPlayers = [...players].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
    const sortedLastStats = [...lastStats].sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));

    const today = new Date(); today.setHours(0, 0, 0, 0);

    const finishedGames = games
        .filter((g: any) => g.status === 'Final')
        .sort((a: any, b: any) => parseDate(b.date).getTime() - parseDate(a.date).getTime());

    const upcomingGames = games
        .filter((g: any) => {
            const d = parseDate(g.date); d.setHours(0, 0, 0, 0);
            return g.status !== 'Final' && d >= today;
        })
        .sort((a: any, b: any) => parseDate(a.date).getTime() - parseDate(b.date).getTime())
        .slice(0, 5);

    let wins = 0, losses = 0;
    finishedGames.forEach((g: any) => {
        const home = Number(g.home_team?.id) === HEAT_ID;
        const won = home ? g.home_team_score > g.visitor_team_score : g.visitor_team_score > g.home_team_score;
        won ? wins++ : losses++;
    });

    const heatWon = lastGame
        ? (Number(lastGame.home_team?.id) === HEAT_ID
            ? lastGame.home_team_score > lastGame.visitor_team_score
            : lastGame.visitor_team_score > lastGame.home_team_score)
        : false;

    const gameLabel = lastGame
        ? `${lastGame.visitor_team?.abbreviation} ${lastGame.visitor_team_score} @ ${lastGame.home_team?.abbreviation} ${lastGame.home_team_score} — ${parseDate(lastGame.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : '';

    const wAvg = (k: string) => {
        const q = players.filter(p => p.games_played >= 5);
        if (!q.length) return '-';
        const total = q.reduce((s, p) => s + (Number(p[k]) || 0) * p.games_played, 0);
        const gms = q.reduce((s, p) => s + p.games_played, 0);
        return gms > 0 ? (total / gms).toFixed(1) : '-';
    };
    const pctTeam = (made: string, att: string) => {
        const m = players.reduce((s, p) => s + (p[made] || 0), 0);
        const a = players.reduce((s, p) => s + (p[att] || 0), 0);
        return a > 0 ? (m / a * 100).toFixed(1) + '%' : '-';
    };

    const colHeaders = [
        { label: 'Player', key: 'player' }, { label: 'GP', key: 'games_played' },
        { label: 'PTS', key: 'pts' }, { label: 'REB', key: 'reb' },
        { label: 'AST', key: 'ast' }, { label: 'STL', key: 'stl' },
        { label: 'BLK', key: 'blk' }, { label: 'FG%', key: 'fg_pct' },
        { label: '3P%', key: 'fg3_pct' }, { label: 'FT%', key: 'ft_pct' },
    ];

    const teamCards = [
        { label: 'Points per Game', value: loadGames ? '...' : teamPPG > 0 ? teamPPG.toFixed(1) : '-' },
        { label: 'Rebounds per Game', value: loadPlayers ? '...' : wAvg('reb') },
        { label: 'Assists per Game', value: loadPlayers ? '...' : wAvg('ast') },
        { label: 'Steals per Game', value: loadPlayers ? '...' : wAvg('stl') },
        { label: 'Blocks per Game', value: loadPlayers ? '...' : wAvg('blk') },
        { label: 'Field Goal %', value: loadPlayers ? '...' : pctTeam('_fgm', '_fga') },
        { label: '3-Point %', value: loadPlayers ? '...' : pctTeam('_fg3m', '_fg3a') },
        { label: 'Free Throw %', value: loadPlayers ? '...' : pctTeam('_ftm', '_fta') },
        { label: 'Games Played', value: loadGames ? '...' : finishedGames.length.toString() },
        { label: 'Season Record', value: loadGames ? '...' : `${wins}-${losses}` },
    ];

    const thSt = (active: boolean) => ({
        padding: '13px 16px', textAlign: 'left' as const, color: 'white',
        whiteSpace: 'nowrap' as const, fontWeight: 700, cursor: 'pointer' as const,
        background: active ? '#6b0020' : '#98002E',
    });
    const tdSt = { padding: '11px 16px' };
    const rowBg = (i: number) => ({ background: i % 2 === 0 ? '#1a1a1a' : '#222' });

    return (
        <div style={{ fontFamily: 'Segoe UI, sans-serif', background: '#111', minHeight: '100vh', color: '#f0f0f0' }}>
            <div style={{ background: 'linear-gradient(135deg,#98002E,#F9A01B)', padding: '28px 40px', display: 'flex', alignItems: 'center', gap: 20 }}>
                <span style={{ fontSize: 52 }}>🔥</span>
                <div>
                    <div style={{ fontSize: 30, fontWeight: 800, color: 'white' }}>Miami Heat Stats</div>
                    <div style={{ color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>2025-26 NBA Season · Live Data</div>
                </div>
            </div>

            <div style={{ maxWidth: 1300, margin: '0 auto', padding: '28px 20px' }}>

                {/* No API key warning */}
                {!hasKey && (
                    <div style={{ background: '#2a1a00', border: '1px solid #F9A01B', borderRadius: 8, padding: '20px 24px', color: '#F9A01B', marginBottom: 24, lineHeight: 1.8 }}>
                        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>⚠️ API Key Required</div>
                        <div style={{ color: '#ccc', fontSize: 14 }}>Add your API key to the URL:</div>
                        <code style={{ color: 'white', fontSize: 13, background: '#111', padding: '8px 14px', borderRadius: 6, display: 'block', marginTop: 10, wordBreak: 'break-all' as const }}>
                            {typeof window !== 'undefined' ? window.location.href.split('?')[0] : ''}?apikey=YOUR_API_KEY
                        </code>
                    </div>
                )}

                {/* TABS */}
                {hasKey && (
                    <>
                        <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' as const }}>
                            {[['players', 'Player Averages'], ['lastgame', 'Last Game'], ['record', 'Record & Schedule'], ['team', 'Team Overview']].map(([id, label]) => (
                                <button key={id} onClick={() => setTab(id)} style={{
                                    padding: '10px 22px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                                    background: tab === id ? '#98002E' : '#222', color: tab === id ? 'white' : '#999',
                                }}>{label}</button>
                            ))}
                        </div>

                        {/* ══ PLAYER AVERAGES ══ */}
                        {tab === 'players' && (
                            <>
                                <div style={{ fontSize: 20, fontWeight: 700, color: '#F9A01B', borderLeft: '4px solid #98002E', paddingLeft: 12, marginBottom: 18 }}>
                                    Player Season Averages — 2025-26
                                </div>
                                {loadPlayers
                                    ? <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>⏳ Loading player stats... (may take ~30s)</div>
                                    : players.length === 0
                                        ? <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>No player data found.</div>
                                        : <>
                                            <div style={{ overflowX: 'auto' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                                                    <thead>
                                                        <tr>
                                                            {colHeaders.map(h => (
                                                                <th key={h.key} onClick={() => h.key !== 'player' && setSortKey(h.key)} style={thSt(sortKey === h.key)}>
                                                                    {h.label}{sortKey === h.key ? ' ↓' : ''}
                                                                </th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {sortedPlayers.map((p, i) => (
                                                            <tr key={p.player?.id ?? i} style={rowBg(i)}>
                                                                <td style={{ ...tdSt, fontWeight: 700, whiteSpace: 'nowrap' as const }}>
                                                                    {p.player?.first_name} {p.player?.last_name}
                                                                    <span style={{ color: '#777', fontWeight: 400, marginLeft: 8, fontSize: 12 }}>{p.player?.position}</span>
                                                                </td>
                                                                <td style={{ ...tdSt, color: '#bbb' }}>{p.games_played}</td>
                                                                <td style={{ ...tdSt, color: '#F9A01B', fontWeight: 700 }}>{num(p.pts)}</td>
                                                                <td style={tdSt}>{num(p.reb)}</td>
                                                                <td style={tdSt}>{num(p.ast)}</td>
                                                                <td style={tdSt}>{num(p.stl)}</td>
                                                                <td style={tdSt}>{num(p.blk)}</td>
                                                                <td style={tdSt}>{pct(p.fg_pct)}</td>
                                                                <td style={tdSt}>{pct(p.fg3_pct)}</td>
                                                                <td style={tdSt}>{pct(p.ft_pct)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <div style={{ color: '#555', fontSize: 12, marginTop: 8 }}>
                                                Click column headers to sort · {players.length} players · Calculated from 2025-26 game logs
                                            </div>
                                        </>
                                }
                            </>
                        )}

                        {/* ══ LAST GAME ══ */}
                        {tab === 'lastgame' && (
                            <>
                                <div style={{ fontSize: 20, fontWeight: 700, color: '#F9A01B', borderLeft: '4px solid #98002E', paddingLeft: 12, marginBottom: 12 }}>
                                    Last Game — Miami Heat
                                </div>
                                {lastGame && (
                                    <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
                                        <span style={{ color: '#aaa' }}>{gameLabel}</span>
                                        <span style={{ padding: '3px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700, background: heatWon ? '#0a3a0a' : '#3a0a0a', color: heatWon ? '#4caf50' : '#ff6b6b', border: `1px solid ${heatWon ? '#4caf50' : '#ff6b6b'}` }}>
                                            {heatWon ? 'WIN' : 'LOSS'}
                                        </span>
                                    </div>
                                )}
                                {loadGames
                                    ? <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading last game...</div>
                                    : lastStats.length === 0
                                        ? <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>No player stats for last game.</div>
                                        : <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                                                <thead>
                                                    <tr>
                                                        {['Player', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FGM-FGA', '3PM-3PA', 'FTM-FTA', 'TO'].map(h => (
                                                            <th key={h} style={{ padding: '13px 16px', textAlign: 'left' as const, color: 'white', whiteSpace: 'nowrap' as const, fontWeight: 700, background: '#98002E' }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {sortedLastStats.map((s, i) => (
                                                        <tr key={s.id} style={rowBg(i)}>
                                                            <td style={{ ...tdSt, fontWeight: 700, whiteSpace: 'nowrap' as const }}>
                                                                {s.player?.first_name} {s.player?.last_name}
                                                                <span style={{ color: '#777', fontWeight: 400, marginLeft: 8, fontSize: 12 }}>{s.player?.position}</span>
                                                            </td>
                                                            <td style={{ ...tdSt, color: '#bbb' }}>{s.min}</td>
                                                            <td style={{ ...tdSt, color: '#F9A01B', fontWeight: 700 }}>{s.pts}</td>
                                                            <td style={tdSt}>{s.reb}</td>
                                                            <td style={tdSt}>{s.ast}</td>
                                                            <td style={tdSt}>{s.stl}</td>
                                                            <td style={tdSt}>{s.blk}</td>
                                                            <td style={tdSt}>{s.fgm}-{s.fga}</td>
                                                            <td style={tdSt}>{s.fg3m}-{s.fg3a}</td>
                                                            <td style={tdSt}>{s.ftm}-{s.fta}</td>
                                                            <td style={{ ...tdSt, color: s.turnover > 2 ? '#ff6b6b' : '#aaa' }}>{s.turnover}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                }
                            </>
                        )}

                        {/* ══ RECORD & SCHEDULE ══ */}
                        {tab === 'record' && (
                            <>
                                <div style={{ fontSize: 20, fontWeight: 700, color: '#F9A01B', borderLeft: '4px solid #98002E', paddingLeft: 12, marginBottom: 22 }}>
                                    Season Record & Schedule — 2025-26
                                </div>
                                {loadGames
                                    ? <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading...</div>
                                    : <>
                                        <div style={{ display: 'flex', gap: 14, marginBottom: 28, flexWrap: 'wrap' as const }}>
                                            {[
                                                { val: wins, label: 'Wins', bg: '#0a3a0a', bdr: '#4caf50', clr: '#4caf50' },
                                                { val: losses, label: 'Losses', bg: '#3a0a0a', bdr: '#ff6b6b', clr: '#ff6b6b' },
                                                { val: wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) + '%' : '-', label: 'Win %', bg: '#1a1a1a', bdr: '#F9A01B', clr: '#F9A01B' },
                                                ...(standings ? [{ val: `#${standings.conference_rank ?? '?'}`, label: 'East Rank', bg: '#1a1a1a', bdr: '#98002E', clr: '#F9A01B' }] : []),
                                            ].map((c: any) => (
                                                <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.bdr}`, borderRadius: 12, padding: '20px 32px', textAlign: 'center' as const, minWidth: 140 }}>
                                                    <div style={{ fontSize: 46, fontWeight: 800, color: c.clr }}>{c.val}</div>
                                                    <div style={{ fontSize: 12, color: '#aaa', marginTop: 6, textTransform: 'uppercase' as const, letterSpacing: 1 }}>{c.label}</div>
                                                </div>
                                            ))}
                                        </div>

                                        <div style={{ fontSize: 17, fontWeight: 700, color: '#F9A01B', borderLeft: '4px solid #98002E', paddingLeft: 12, marginBottom: 12 }}>Next 5 Upcoming Games</div>
                                        {upcomingGames.length === 0
                                            ? <div style={{ color: '#888', marginBottom: 24 }}>No upcoming games found.</div>
                                            : <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8, marginBottom: 28 }}>
                                                {upcomingGames.map((g: any) => {
                                                    const home = Number(g.home_team?.id) === HEAT_ID;
                                                    const opp = home ? g.visitor_team : g.home_team;
                                                    const d = parseDate(g.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                                                    return (
                                                        <div key={g.id} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                                                            <div style={{ color: '#F9A01B', fontWeight: 700, minWidth: 200 }}>{d}</div>
                                                            <div style={{ color: '#777', minWidth: 24 }}>{home ? 'vs' : '@'}</div>
                                                            <div style={{ fontWeight: 700, color: 'white' }}>{opp?.full_name ?? opp?.abbreviation}</div>
                                                            <div style={{ marginLeft: 'auto', background: home ? '#1a3a1a' : '#2a1a0a', color: home ? '#4caf50' : '#F9A01B', padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, border: `1px solid ${home ? '#4caf50' : '#F9A01B'}` }}>
                                                                {home ? 'HOME' : 'AWAY'}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        }

                                        <div style={{ fontSize: 17, fontWeight: 700, color: '#F9A01B', borderLeft: '4px solid #98002E', paddingLeft: 12, marginBottom: 12 }}>Last 10 Results</div>
                                        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 7 }}>
                                            {finishedGames.slice(0, 10).map((g: any) => {
                                                const home = Number(g.home_team?.id) === HEAT_ID;
                                                const won = home ? g.home_team_score > g.visitor_team_score : g.visitor_team_score > g.home_team_score;
                                                const opp = home ? g.visitor_team : g.home_team;
                                                const hs = home ? g.home_team_score : g.visitor_team_score;
                                                const os = home ? g.visitor_team_score : g.home_team_score;
                                                const d = parseDate(g.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                                return (
                                                    <div key={g.id} style={{ background: '#1a1a1a', border: `1px solid ${won ? '#1a3a1a' : '#3a1a1a'}`, borderRadius: 8, padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                                                        <span style={{ background: won ? '#0a3a0a' : '#3a0a0a', color: won ? '#4caf50' : '#ff6b6b', padding: '2px 12px', borderRadius: 12, fontWeight: 700, fontSize: 13, minWidth: 32, textAlign: 'center' as const }}>{won ? 'W' : 'L'}</span>
                                                        <span style={{ color: '#aaa', fontSize: 13, minWidth: 55 }}>{d}</span>
                                                        <span style={{ color: home ? '#4caf50' : '#F9A01B', fontSize: 12, minWidth: 44 }}>{home ? 'HOME' : 'AWAY'}</span>
                                                        <span style={{ fontWeight: 600 }}>{opp?.full_name ?? opp?.abbreviation}</span>
                                                        <span style={{ marginLeft: 'auto', fontWeight: 700, color: won ? '#4caf50' : '#ff6b6b', fontSize: 15 }}>{hs} - {os}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>
                                }
                            </>
                        )}

                        {/* ══ TEAM OVERVIEW ══ */}
                        {tab === 'team' && (
                            <>
                                <div style={{ fontSize: 20, fontWeight: 700, color: '#F9A01B', borderLeft: '4px solid #98002E', paddingLeft: 12, marginBottom: 22 }}>
                                    Team Season Averages — 2025-26
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
                                    {teamCards.map(c => (
                                        <div key={c.label} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '24px 18px', textAlign: 'center' as const }}>
                                            <div style={{ fontSize: 38, fontWeight: 800, color: '#F9A01B' }}>{c.value}</div>
                                            <div style={{ fontSize: 12, color: '#888', marginTop: 8, textTransform: 'uppercase' as const, letterSpacing: 1 }}>{c.label}</div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}