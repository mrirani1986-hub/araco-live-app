import React, { useState, useEffect, useRef, useCallback } from 'react';

// ─── STATIC DATA ───────────────────────────────────────────────

const DRILLS = [
  // Dribbling
  { id: 'd1', category: 'dribbling', name: 'Basic Dribble', emoji: '🏀', difficulty: 1, duration: 60, points: 10,
    tips: ['Keep your eyes up!', 'Use your fingertips, not your palm', 'Stay low in athletic stance'],
    steps: ['Stand feet shoulder-width apart', 'Bounce ball with your dominant hand', 'Keep ball at hip height', 'Do 30 bounces without stopping!'] },
  { id: 'd2', category: 'dribbling', name: 'Crossover', emoji: '🔀', difficulty: 2, duration: 90, points: 20,
    tips: ['Keep the ball low', 'Protect ball with your body', 'Practice slow first, then fast!'],
    steps: ['Start dribbling with right hand', 'Push ball across to left hand', 'Dribble a few times left', 'Cross back to right – repeat 10x!'] },
  { id: 'd3', category: 'dribbling', name: 'Figure-8', emoji: '8️⃣', difficulty: 2, duration: 90, points: 20,
    tips: ['Keep knees bent', 'Go slow to learn pattern', 'Speed up as you improve!'],
    steps: ['Stand with legs wide apart', 'Pass ball through legs in a figure-8', 'Keep the pattern smooth', 'Try 10 complete figure-8s!'] },
  { id: 'd4', category: 'dribbling', name: 'Speed Dribble', emoji: '⚡', difficulty: 3, duration: 120, points: 30,
    tips: ['Push ball forward', 'Lean slightly forward', 'Control is key!'],
    steps: ['Start at one end of court', 'Dribble as fast as you can to other end', 'Slow down and come back', 'Repeat 5 times!'] },
  // Shooting
  { id: 's1', category: 'shooting', name: 'Free Throw', emoji: '🎯', difficulty: 1, duration: 60, points: 10,
    tips: ['Line up feet with basket', 'Bend your knees', 'Follow through – hold pose!'],
    steps: ['Stand at the free throw line', 'Ball on shooting hand, guide hand on side', 'Bend knees and push up', 'Hold hand up like a "gooseneck"!'] },
  { id: 's2', category: 'shooting', name: 'Layup', emoji: '🚀', difficulty: 2, duration: 90, points: 20,
    tips: ['Aim for the box on backboard', 'Step-step-JUMP!', 'Use a soft touch'],
    steps: ['Start 3 steps from basket', 'Take 2 steps toward basket', 'Jump off one foot', 'Gently lay ball on backboard!'] },
  { id: 's3', category: 'shooting', name: 'Mid-Range Shot', emoji: '🏹', difficulty: 2, duration: 90, points: 20,
    tips: ['Square shoulders to basket', 'Have a consistent routine', 'Aim for back of the rim'],
    steps: ['Start at the elbow (corner of key)', 'Get into shooting stance', 'Jump straight up', 'Release at top of your jump!'] },
  { id: 's4', category: 'shooting', name: '3-Point Challenge', emoji: '⭐', difficulty: 3, duration: 120, points: 30,
    tips: ['You need extra leg power!', 'Start closer if needed', 'Consistency over distance!'],
    steps: ['Set up behind the 3-point line', 'Use your whole body for power', 'Jump and release at peak', 'Try to make 3 out of 10!'] },
  // Passing
  { id: 'p1', category: 'passing', name: 'Chest Pass', emoji: '👐', difficulty: 1, duration: 60, points: 10,
    tips: ["Aim at partner's chest", 'Step into the pass', 'Snap your wrists!'],
    steps: ['Hold ball at chest with two hands', 'Step toward your target', 'Push ball out with both hands', 'Snap wrists so thumbs point down!'] },
  { id: 'p2', category: 'passing', name: 'Bounce Pass', emoji: '⬇️', difficulty: 1, duration: 60, points: 10,
    tips: ['Aim 2/3 of distance to partner', 'Ball bounces to their waist', 'Great for beating defenders!'],
    steps: ['Hold ball at chest level', 'Push ball downward at an angle', 'Ball hits floor 2/3 of way', 'They catch it at waist height!'] },
  { id: 'p3', category: 'passing', name: 'Overhead Pass', emoji: '🙌', difficulty: 2, duration: 60, points: 20,
    tips: ['Keep elbows in', 'Good for passing over defenders', 'Step into the pass!'],
    steps: ['Hold ball above your head', 'Elbows slightly bent', 'Step forward and release', 'Snap wrists to send ball forward!'] },
  // Defense
  { id: 'def1', category: 'defense', name: 'Defensive Stance', emoji: '🛡️', difficulty: 1, duration: 60, points: 10,
    tips: ['Stay low!', 'Spread arms wide', "Watch their belly button, not the ball"],
    steps: ['Bend knees and get low', 'Feet shoulder-width apart', 'Arms out to the sides', 'Hold this position 30 seconds!'] },
  { id: 'def2', category: 'defense', name: 'Slide Steps', emoji: '↔️', difficulty: 2, duration: 90, points: 20,
    tips: ["Don't cross your feet!", 'Stay low throughout', 'Move feet quickly!'],
    steps: ['Start in defensive stance', 'Slide right 3 steps – no crossing!', 'Slide left 3 steps', 'Repeat 10 times!'] },
  { id: 'def3', category: 'defense', name: 'Box Out', emoji: '📦', difficulty: 2, duration: 60, points: 20,
    tips: ['Turn and make contact', 'Use your body, not hands', 'Find your player!'],
    steps: ['Find your player to guard', 'When shot goes up, turn into them', 'Block them from basket with body', 'Jump up to grab the rebound!'] },
  // Conditioning
  { id: 'c1', category: 'conditioning', name: 'Jump Rope', emoji: '🪢', difficulty: 1, duration: 60, points: 10,
    tips: ['Stay on balls of your feet', 'Keep elbows tucked', 'Find your rhythm!'],
    steps: ['Hold rope handles in each hand', 'Swing rope over your head', 'Jump as rope comes under feet', 'Try 50 jumps in a row!'] },
  { id: 'c2', category: 'conditioning', name: 'Agility Ladder', emoji: '🪜', difficulty: 2, duration: 90, points: 20,
    tips: ['Stay on your toes', 'Pump your arms', 'Go as fast as you can!'],
    steps: ['Set up (or imagine) a 10-box ladder', 'Step in and out of each box quickly', 'Complete the whole ladder', 'Rest and repeat 3 times!'] },
  { id: 'c3', category: 'conditioning', name: 'Sprint Drills', emoji: '🏃', difficulty: 3, duration: 120, points: 30,
    tips: ['Drive knees up', 'Pump your arms', 'Give it everything!'],
    steps: ['Mark two points ~20 meters apart', 'Sprint from one end to other', 'Walk back to recover', 'Repeat 5 times!'] },
];

const CATEGORIES = [
  { id: 'dribbling',    name: 'Dribbling',   emoji: '🏀', color: '#FF6B35', bg: '#FFF0EB' },
  { id: 'shooting',     name: 'Shooting',    emoji: '🎯', color: '#7B2D8B', bg: '#F5EBFF' },
  { id: 'passing',      name: 'Passing',     emoji: '👐', color: '#1976D2', bg: '#EBF3FF' },
  { id: 'defense',      name: 'Defense',     emoji: '🛡️', color: '#2E7D32', bg: '#EAFBEA' },
  { id: 'conditioning', name: 'Fitness',     emoji: '🏃', color: '#E65100', bg: '#FFF3E0' },
];

const BADGES = [
  { id: 'first-drill',  name: 'First Step!',     emoji: '👟', desc: 'Complete your first drill',       check: (s) => s.length >= 1 },
  { id: 'hot-shot',     name: 'Hot Shot',         emoji: '🔥', desc: 'Complete 5 shooting drills',      check: (s) => s.filter(x => x.category === 'shooting').length >= 5 },
  { id: 'dribble-king', name: 'Dribble King',     emoji: '👑', desc: 'Complete 5 dribbling drills',     check: (s) => s.filter(x => x.category === 'dribbling').length >= 5 },
  { id: 'team-player',  name: 'Team Player',      emoji: '🤝', desc: 'Complete 5 passing drills',       check: (s) => s.filter(x => x.category === 'passing').length >= 5 },
  { id: 'defender',     name: 'Brick Wall',       emoji: '🧱', desc: 'Complete 5 defense drills',       check: (s) => s.filter(x => x.category === 'defense').length >= 5 },
  { id: 'all-rounder',  name: 'All-Rounder',      emoji: '🌟', desc: 'Try all 5 skill types',           check: (s) => new Set(s.map(x => x.category)).size >= 5 },
  { id: 'ten-drills',   name: 'Getting Serious',  emoji: '💪', desc: 'Complete 10 drills total',        check: (s) => s.length >= 10 },
  { id: 'fifty-drills', name: 'Baller!',          emoji: '🏆', desc: 'Complete 50 drills total',        check: (s) => s.length >= 50 },
  { id: 'hard-worker',  name: 'Hard Worker',      emoji: '😤', desc: 'Complete 3 hard drills',          check: (s) => s.filter(x => x.difficulty === 3).length >= 3 },
  { id: 'consistent',   name: 'Consistent',       emoji: '📅', desc: 'Drill 3 days in a row',           check: (s, profile) => (profile?.streak || 0) >= 3 },
];

const LEVELS = [
  { level: 1, name: 'Rookie',   min: 0,    max: 99,   emoji: '🌱', color: '#78909C' },
  { level: 2, name: 'Starter',  min: 100,  max: 299,  emoji: '⚡', color: '#42A5F5' },
  { level: 3, name: 'Pro',      min: 300,  max: 599,  emoji: '🔥', color: '#FF7043' },
  { level: 4, name: 'All-Star', min: 600,  max: 999,  emoji: '⭐', color: '#AB47BC' },
  { level: 5, name: 'Champion', min: 1000, max: Infinity, emoji: '🏆', color: '#FFD700' },
];

const AVATARS = ['🦁', '🐯', '🦊', '🐺', '🦅', '🦋', '🐉', '🦄', '🐻', '🐸'];

const DAILY_DRILLS = ['d1', 's1', 'p1', 'def1', 'c1', 'd2', 's2', 'p2', 'def2', 'c2'];

function getDailyDrill() {
  const dayIndex = Math.floor(Date.now() / 86400000) % DAILY_DRILLS.length;
  return DRILLS.find(d => d.id === DAILY_DRILLS[dayIndex]);
}

function getLevelInfo(points) {
  return LEVELS.find(l => points >= l.min && points <= l.max) || LEVELS[0];
}

function getNextLevel(points) {
  const curr = getLevelInfo(points);
  return LEVELS.find(l => l.level === curr.level + 1) || null;
}

function difficultyStars(n) {
  return '⭐'.repeat(n) + '☆'.repeat(3 - n);
}

// ─── COMPONENTS ───────────────────────────────────────────────

function BottomNav({ active, onNavigate }) {
  const tabs = [
    { id: 'home',     label: 'Home',    emoji: '🏠' },
    { id: 'drills',   label: 'Drills',  emoji: '🏀' },
    { id: 'progress', label: 'Progress',emoji: '📊' },
    { id: 'rewards',  label: 'Rewards', emoji: '🏅' },
    { id: 'profile',  label: 'Profile', emoji: '👤' },
  ];
  return (
    <nav className="bb-bottom-nav">
      {tabs.map(t => (
        <button key={t.id} className={`bb-nav-item${active === t.id ? ' active' : ''}`} onClick={() => onNavigate(t.id)}>
          <span className="bb-nav-emoji">{t.emoji}</span>
          <span className="bb-nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

function BadgePopup({ badges, onClose }) {
  return (
    <div className="bb-overlay" onClick={onClose}>
      <div className="bb-badge-popup" onClick={e => e.stopPropagation()}>
        <div className="bb-badge-popup-title">🎉 New Badge!</div>
        {badges.map(b => (
          <div key={b.id} className="bb-badge-popup-item">
            <div className="bb-badge-popup-emoji">{b.emoji}</div>
            <div>
              <div className="bb-badge-popup-name">{b.name}</div>
              <div className="bb-badge-popup-desc">{b.desc}</div>
            </div>
          </div>
        ))}
        <button className="bb-btn-primary" onClick={onClose}>Awesome! 🎊</button>
      </div>
    </div>
  );
}

// ─── WELCOME SCREEN ───────────────────────────────────────────

function WelcomeScreen({ onComplete }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('🦁');
  const [age, setAge] = useState(8);

  function finish() {
    if (!name.trim()) return;
    onComplete({ name: name.trim(), avatar, age, points: 0, badges: [], streak: 0, lastActive: new Date().toDateString() });
  }

  if (step === 0) return (
    <div className="bb-welcome">
      <div className="bb-welcome-ball">🏀</div>
      <h1 className="bb-welcome-title">Hoop Stars!</h1>
      <p className="bb-welcome-sub">Train like a pro. Play like a champion!</p>
      <button className="bb-btn-primary bb-btn-xl" onClick={() => setStep(1)}>Let's Go! 🚀</button>
    </div>
  );

  if (step === 1) return (
    <div className="bb-welcome">
      <div className="bb-welcome-step">
        <h2>What's your name? 😊</h2>
        <input
          className="bb-name-input"
          placeholder="Enter your name..."
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && name.trim() && setStep(2)}
          maxLength={20}
          autoFocus
        />
        <button className="bb-btn-primary" disabled={!name.trim()} onClick={() => setStep(2)}>Next →</button>
      </div>
    </div>
  );

  if (step === 2) return (
    <div className="bb-welcome">
      <div className="bb-welcome-step">
        <h2>Pick your avatar! 🎨</h2>
        <div className="bb-avatar-grid">
          {AVATARS.map(a => (
            <button key={a} className={`bb-avatar-btn${avatar === a ? ' selected' : ''}`} onClick={() => setAvatar(a)}>{a}</button>
          ))}
        </div>
        <button className="bb-btn-primary" onClick={() => setStep(3)}>Next →</button>
      </div>
    </div>
  );

  return (
    <div className="bb-welcome">
      <div className="bb-welcome-step">
        <h2>How old are you? 🎂</h2>
        <div className="bb-age-picker">
          <button className="bb-age-btn" onClick={() => setAge(Math.max(6, age - 1))}>−</button>
          <span className="bb-age-display">{age}</span>
          <button className="bb-age-btn" onClick={() => setAge(Math.min(12, age + 1))}>+</button>
        </div>
        <div className="bb-welcome-preview">
          <span className="bb-preview-avatar">{avatar}</span>
          <div>
            <div className="bb-preview-name">{name}</div>
            <div className="bb-preview-age">Age {age} • Level 1 Rookie 🌱</div>
          </div>
        </div>
        <button className="bb-btn-primary" onClick={finish}>Start Training! 🏀</button>
      </div>
    </div>
  );
}

// ─── HOME SCREEN ──────────────────────────────────────────────

function HomeScreen({ profile, sessions, levelInfo, nextLevel, onNavigate, onStartDrill }) {
  const dailyDrill = getDailyDrill();
  const today = new Date().toDateString();
  const todaySessions = sessions.filter(s => new Date(s.completedAt).toDateString() === today);
  const todayPoints = todaySessions.reduce((sum, s) => sum + s.points, 0);
  const progressToNext = nextLevel
    ? Math.round(((profile.points - levelInfo.min) / (nextLevel.min - levelInfo.min)) * 100)
    : 100;

  return (
    <div className="bb-screen">
      <div className="bb-home-header">
        <div className="bb-home-greeting">
          <span className="bb-home-avatar">{profile.avatar}</span>
          <div>
            <div className="bb-home-name">Hey, {profile.name}! 👋</div>
            <div className="bb-home-level">{levelInfo.emoji} {levelInfo.name} • {profile.points} pts</div>
          </div>
        </div>
        <div className="bb-streak-badge">
          🔥 {profile.streak} day{profile.streak !== 1 ? 's' : ''}
        </div>
      </div>

      {nextLevel && (
        <div className="bb-level-card">
          <div className="bb-level-card-header">
            <span>{levelInfo.emoji} {levelInfo.name}</span>
            <span>{nextLevel.emoji} {nextLevel.name}</span>
          </div>
          <div className="bb-progress-bar">
            <div className="bb-progress-fill" style={{ width: `${progressToNext}%`, background: levelInfo.color }} />
          </div>
          <div className="bb-level-card-sub">{nextLevel.min - profile.points} pts to {nextLevel.name}</div>
        </div>
      )}

      <div className="bb-today-card">
        <div className="bb-today-header">☀️ Today's Challenge</div>
        <div className="bb-drill-mini" onClick={() => onStartDrill(dailyDrill)}>
          <span className="bb-drill-mini-emoji">{dailyDrill.emoji}</span>
          <div>
            <div className="bb-drill-mini-name">{dailyDrill.name}</div>
            <div className="bb-drill-mini-sub">{difficultyStars(dailyDrill.difficulty)} • +{dailyDrill.points} pts</div>
          </div>
          <button className="bb-btn-go">GO!</button>
        </div>
        {todaySessions.length > 0 && (
          <div className="bb-today-stats">
            ✅ {todaySessions.length} drill{todaySessions.length > 1 ? 's' : ''} done today • +{todayPoints} pts earned
          </div>
        )}
      </div>

      <div className="bb-section-title">Quick Start</div>
      <div className="bb-category-row">
        {CATEGORIES.map(cat => (
          <button key={cat.id} className="bb-cat-chip" style={{ background: cat.bg, color: cat.color }} onClick={() => { onNavigate('drills'); }}>
            {cat.emoji} {cat.name}
          </button>
        ))}
      </div>

      <div className="bb-section-title">Your Stats</div>
      <div className="bb-stats-grid">
        <div className="bb-stat-box" style={{ background: '#FFF0EB' }}>
          <div className="bb-stat-num">{sessions.length}</div>
          <div className="bb-stat-lab">Drills Done</div>
        </div>
        <div className="bb-stat-box" style={{ background: '#F5EBFF' }}>
          <div className="bb-stat-num">{profile.points}</div>
          <div className="bb-stat-lab">Total Points</div>
        </div>
        <div className="bb-stat-box" style={{ background: '#EAFBEA' }}>
          <div className="bb-stat-num">{profile.streak}</div>
          <div className="bb-stat-lab">Day Streak</div>
        </div>
        <div className="bb-stat-box" style={{ background: '#EBF3FF' }}>
          <div className="bb-stat-num">{(profile.badges || []).length}</div>
          <div className="bb-stat-lab">Badges</div>
        </div>
      </div>
    </div>
  );
}

// ─── DRILLS SCREEN ────────────────────────────────────────────

function DrillsScreen({ selectedCategory, onSelectCategory, onStartDrill, sessions }) {
  const completedIds = new Set(sessions.map(s => s.drillId));
  const filtered = selectedCategory ? DRILLS.filter(d => d.category === selectedCategory) : DRILLS;

  return (
    <div className="bb-screen">
      <div className="bb-screen-title">🏀 Drills</div>

      <div className="bb-cat-tabs">
        <button className={`bb-cat-tab${!selectedCategory ? ' active' : ''}`} onClick={() => onSelectCategory(null)}>All</button>
        {CATEGORIES.map(cat => (
          <button key={cat.id} className={`bb-cat-tab${selectedCategory === cat.id ? ' active' : ''}`}
            style={selectedCategory === cat.id ? { background: cat.color, color: 'white', borderColor: cat.color } : {}}
            onClick={() => onSelectCategory(cat.id === selectedCategory ? null : cat.id)}>
            {cat.emoji} {cat.name}
          </button>
        ))}
      </div>

      <div className="bb-drill-list">
        {filtered.map(drill => {
          const cat = CATEGORIES.find(c => c.id === drill.category);
          const done = completedIds.has(drill.id);
          return (
            <div key={drill.id} className="bb-drill-card" style={{ borderLeft: `4px solid ${cat.color}` }}>
              <div className="bb-drill-emoji" style={{ background: cat.bg }}>{drill.emoji}</div>
              <div className="bb-drill-info">
                <div className="bb-drill-name">{drill.name} {done && '✅'}</div>
                <div className="bb-drill-meta">{difficultyStars(drill.difficulty)} • {drill.duration}s • +{drill.points} pts</div>
                <div className="bb-drill-cat-tag" style={{ color: cat.color }}>{cat.emoji} {cat.name}</div>
              </div>
              <button className="bb-btn-start" style={{ background: cat.color }} onClick={() => onStartDrill(drill)}>Start</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DRILL SCREEN (ACTIVE) ─────────────────────────────────────

function DrillScreen({ drill, onComplete, onBack }) {
  const [phase, setPhase] = useState('ready');   // ready | active | done
  const [timeLeft, setTimeLeft] = useState(drill.duration);
  const [step, setStep] = useState(0);
  const [encouragement, setEncouragement] = useState('');
  const intervalRef = useRef(null);

  const CHEERS = ['Amazing! 🔥', 'Keep going! 💪', "You've got this! ⭐", 'Superstar! 🌟', 'Incredible! 🏆'];

  const startDrill = useCallback(() => {
    setPhase('active');
    setTimeLeft(drill.duration);
    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          setPhase('done');
          return 0;
        }
        if (prev % 15 === 0) setEncouragement(CHEERS[Math.floor(Math.random() * CHEERS.length)]);
        return prev - 1;
      });
    }, 1000);
  }, [drill.duration]);

  useEffect(() => () => clearInterval(intervalRef.current), []);

  const pct = Math.round(((drill.duration - timeLeft) / drill.duration) * 100);
  const cat = CATEGORIES.find(c => c.id === drill.category);

  if (phase === 'ready') return (
    <div className="bb-drill-screen">
      <button className="bb-back-btn" onClick={onBack}>← Back</button>
      <div className="bb-drill-hero-emoji">{drill.emoji}</div>
      <h2 className="bb-drill-hero-name">{drill.name}</h2>
      <div className="bb-drill-hero-meta">{difficultyStars(drill.difficulty)} • {drill.duration}s • +{drill.points} pts</div>

      <div className="bb-drill-section">
        <div className="bb-drill-section-title">📋 Steps</div>
        {drill.steps.map((s, i) => (
          <div key={i} className="bb-drill-step">
            <span className="bb-drill-step-num">{i + 1}</span>
            <span>{s}</span>
          </div>
        ))}
      </div>

      <div className="bb-drill-section">
        <div className="bb-drill-section-title">💡 Coach Tips</div>
        {drill.tips.map((t, i) => (
          <div key={i} className="bb-drill-tip">💬 {t}</div>
        ))}
      </div>

      <button className="bb-btn-primary bb-btn-xl" style={{ background: cat.color }} onClick={startDrill}>
        Start Drill! 🏀
      </button>
    </div>
  );

  if (phase === 'active') return (
    <div className="bb-drill-screen">
      <div className="bb-drill-active-header" style={{ background: cat.color }}>
        <div className="bb-drill-active-name">{drill.emoji} {drill.name}</div>
        <div className="bb-drill-timer">{timeLeft}s</div>
      </div>

      <div className="bb-timer-ring-wrap">
        <svg viewBox="0 0 120 120" className="bb-timer-ring">
          <circle cx="60" cy="60" r="54" fill="none" stroke="#eee" strokeWidth="8" />
          <circle cx="60" cy="60" r="54" fill="none" stroke={cat.color} strokeWidth="8"
            strokeDasharray={339.3} strokeDashoffset={339.3 * (1 - pct / 100)}
            strokeLinecap="round" transform="rotate(-90 60 60)" />
        </svg>
        <div className="bb-timer-center">
          <div className="bb-timer-pct">{pct}%</div>
          <div className="bb-timer-done">done</div>
        </div>
      </div>

      {encouragement && <div className="bb-cheer">{encouragement}</div>}

      <div className="bb-step-current">
        <div className="bb-step-label">Current step:</div>
        <div className="bb-step-text">{drill.steps[step]}</div>
        <div className="bb-step-btns">
          <button className="bb-step-btn" disabled={step === 0} onClick={() => setStep(s => s - 1)}>← Prev</button>
          <button className="bb-step-btn" disabled={step === drill.steps.length - 1} onClick={() => setStep(s => s + 1)}>Next →</button>
        </div>
      </div>

      <button className="bb-btn-secondary" onClick={() => { clearInterval(intervalRef.current); setPhase('done'); }}>Finish Early</button>
    </div>
  );

  return (
    <div className="bb-drill-screen bb-drill-done">
      <div className="bb-done-animation">🎉</div>
      <h2 className="bb-done-title">Drill Complete!</h2>
      <div className="bb-done-points">+{drill.points} points earned!</div>
      <div className="bb-done-emoji">{drill.emoji}</div>
      <div className="bb-done-name">{drill.name}</div>
      <div className="bb-done-tips">
        <div className="bb-done-tip-title">Remember:</div>
        {drill.tips.map((t, i) => <div key={i} className="bb-done-tip">✓ {t}</div>)}
      </div>
      <button className="bb-btn-primary bb-btn-xl" onClick={onComplete}>Claim Points! 🏆</button>
    </div>
  );
}

// ─── PROGRESS SCREEN ──────────────────────────────────────────

function ProgressScreen({ sessions, profile, levelInfo, nextLevel }) {
  const catCounts = {};
  CATEGORIES.forEach(c => { catCounts[c.id] = sessions.filter(s => s.category === c.id).length; });
  const maxCount = Math.max(...Object.values(catCounts), 1);

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const ds = d.toDateString();
    return { label: d.toLocaleDateString('en', { weekday: 'short' }), count: sessions.filter(s => new Date(s.completedAt).toDateString() === ds).length };
  });
  const maxDay = Math.max(...last7.map(d => d.count), 1);

  const progressToNext = nextLevel
    ? Math.round(((profile.points - levelInfo.min) / (nextLevel.min - levelInfo.min)) * 100)
    : 100;

  return (
    <div className="bb-screen">
      <div className="bb-screen-title">📊 Progress</div>

      <div className="bb-level-card big">
        <div className="bb-level-big-emoji">{levelInfo.emoji}</div>
        <div className="bb-level-big-name">{levelInfo.name}</div>
        <div className="bb-level-big-pts">{profile.points} points total</div>
        {nextLevel && <>
          <div className="bb-progress-bar" style={{ margin: '12px 0' }}>
            <div className="bb-progress-fill" style={{ width: `${progressToNext}%`, background: levelInfo.color }} />
          </div>
          <div className="bb-level-card-sub">{nextLevel.min - profile.points} pts to reach {nextLevel.emoji} {nextLevel.name}</div>
        </>}
      </div>

      <div className="bb-section-title">Skills Breakdown</div>
      {CATEGORIES.map(cat => (
        <div key={cat.id} className="bb-skill-bar-row">
          <div className="bb-skill-bar-label">
            <span>{cat.emoji}</span>
            <span>{cat.name}</span>
            <span className="bb-skill-count">{catCounts[cat.id]} drills</span>
          </div>
          <div className="bb-skill-bar-track">
            <div className="bb-skill-bar-fill" style={{ width: `${(catCounts[cat.id] / maxCount) * 100}%`, background: cat.color }} />
          </div>
        </div>
      ))}

      <div className="bb-section-title">This Week</div>
      <div className="bb-week-chart">
        {last7.map((d, i) => (
          <div key={i} className="bb-week-col">
            <div className="bb-week-bar-wrap">
              <div className="bb-week-bar" style={{ height: `${(d.count / maxDay) * 100}%`, background: d.count > 0 ? '#FF6B35' : '#e2e8f0' }} />
            </div>
            <div className="bb-week-day">{d.label}</div>
            {d.count > 0 && <div className="bb-week-count">{d.count}</div>}
          </div>
        ))}
      </div>

      <div className="bb-section-title">All Time</div>
      <div className="bb-stats-grid">
        <div className="bb-stat-box" style={{ background: '#FFF0EB' }}>
          <div className="bb-stat-num">{sessions.length}</div>
          <div className="bb-stat-lab">Total Drills</div>
        </div>
        <div className="bb-stat-box" style={{ background: '#F5EBFF' }}>
          <div className="bb-stat-num">{sessions.reduce((a, s) => a + s.points, 0)}</div>
          <div className="bb-stat-lab">Points Earned</div>
        </div>
        <div className="bb-stat-box" style={{ background: '#EAFBEA' }}>
          <div className="bb-stat-num">{profile.streak}</div>
          <div className="bb-stat-lab">Best Streak</div>
        </div>
        <div className="bb-stat-box" style={{ background: '#EBF3FF' }}>
          <div className="bb-stat-num">{sessions.filter(s => s.difficulty === 3).length}</div>
          <div className="bb-stat-lab">Hard Drills</div>
        </div>
      </div>
    </div>
  );
}

// ─── REWARDS SCREEN ───────────────────────────────────────────

function RewardsScreen({ earnedBadgeIds, sessions }) {
  const levelInfo = getLevelInfo(0);
  return (
    <div className="bb-screen">
      <div className="bb-screen-title">🏅 Rewards</div>

      <div className="bb-rewards-hero">
        <div className="bb-rewards-count">{earnedBadgeIds.length} / {BADGES.length}</div>
        <div className="bb-rewards-sub">Badges Collected</div>
        <div className="bb-rewards-bar">
          <div className="bb-progress-bar">
            <div className="bb-progress-fill" style={{ width: `${(earnedBadgeIds.length / BADGES.length) * 100}%`, background: '#FF6B35' }} />
          </div>
        </div>
      </div>

      <div className="bb-badges-grid">
        {BADGES.map(badge => {
          const earned = earnedBadgeIds.includes(badge.id);
          return (
            <div key={badge.id} className={`bb-badge-card${earned ? ' earned' : ' locked'}`}>
              <div className="bb-badge-emoji">{earned ? badge.emoji : '🔒'}</div>
              <div className="bb-badge-name">{badge.name}</div>
              <div className="bb-badge-desc">{badge.desc}</div>
              {earned && <div className="bb-badge-earned-tag">✅ Earned!</div>}
            </div>
          );
        })}
      </div>

      <div className="bb-section-title">Level Rewards</div>
      <div className="bb-levels-list">
        {LEVELS.map(l => (
          <div key={l.level} className="bb-level-row" style={{ borderLeft: `4px solid ${l.color}` }}>
            <span className="bb-level-row-emoji">{l.emoji}</span>
            <div>
              <div className="bb-level-row-name">Level {l.level}: {l.name}</div>
              <div className="bb-level-row-req">{l.min === 0 ? 'Starting level!' : `${l.min}+ points needed`}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PROFILE SCREEN ───────────────────────────────────────────

function ProfileScreen({ profile, onUpdate, onReset }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const levelInfo = getLevelInfo(profile.points);

  function save() {
    onUpdate({ ...profile, name, avatar });
    setEditing(false);
  }

  return (
    <div className="bb-screen">
      <div className="bb-screen-title">👤 Profile</div>

      <div className="bb-profile-card">
        <div className="bb-profile-avatar">{profile.avatar}</div>
        <div className="bb-profile-name">{profile.name}</div>
        <div className="bb-profile-level">{levelInfo.emoji} {levelInfo.name} • Age {profile.age}</div>
        <button className="bb-btn-secondary sm" onClick={() => setEditing(!editing)}>
          {editing ? 'Cancel' : 'Edit Profile ✏️'}
        </button>
      </div>

      {editing && (
        <div className="bb-edit-card">
          <input className="bb-name-input" value={name} onChange={e => setName(e.target.value)} maxLength={20} />
          <div className="bb-avatar-grid small">
            {AVATARS.map(a => (
              <button key={a} className={`bb-avatar-btn${avatar === a ? ' selected' : ''}`} onClick={() => setAvatar(a)}>{a}</button>
            ))}
          </div>
          <button className="bb-btn-primary" onClick={save}>Save Changes ✅</button>
        </div>
      )}

      <div className="bb-tips-card">
        <div className="bb-tips-title">🏀 Coach's Corner</div>
        <div className="bb-tip-item">🌅 Train every day to build your streak!</div>
        <div className="bb-tip-item">⭐ Try harder drills to earn more points faster.</div>
        <div className="bb-tip-item">🏅 Complete all badge challenges to become a Champion!</div>
        <div className="bb-tip-item">💪 Remember: Practice makes perfect!</div>
      </div>

      <button className="bb-btn-danger" onClick={() => { if (window.confirm('Reset all progress? This cannot be undone!')) onReset(); }}>
        Reset Progress 🗑️
      </button>
    </div>
  );
}

// ─── ROOT ────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState('welcome');
  const [profile, setProfile] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [activeDrill, setActiveDrill] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [newBadges, setNewBadges] = useState([]);
  const [showBadgePopup, setShowBadgePopup] = useState(false);

  useEffect(() => {
    const p = localStorage.getItem('bball_profile');
    const s = localStorage.getItem('bball_sessions');
    if (p) {
      const prof = JSON.parse(p);
      const today = new Date().toDateString();
      if (prof.lastActive !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const newStreak = prof.lastActive === yesterday.toDateString() ? prof.streak + 1 : 0;
        prof.streak = newStreak;
        prof.lastActive = today;
        localStorage.setItem('bball_profile', JSON.stringify(prof));
      }
      setProfile(prof);
      setSessions(JSON.parse(s || '[]'));
      setScreen('home');
    }
  }, []);

  function saveProfile(p) {
    setProfile(p);
    localStorage.setItem('bball_profile', JSON.stringify(p));
  }

  function completeDrill(drill) {
    const session = {
      id: Date.now(), drillId: drill.id, category: drill.category,
      points: drill.points, difficulty: drill.difficulty, completedAt: new Date().toISOString()
    };
    const newSessions = [...sessions, session];
    setSessions(newSessions);
    localStorage.setItem('bball_sessions', JSON.stringify(newSessions));

    const newPoints = (profile.points || 0) + drill.points;
    const today = new Date().toDateString();
    const todaySessions = newSessions.filter(s => new Date(s.completedAt).toDateString() === today);
    const newStreak = todaySessions.length === 1 && profile.lastActive !== today
      ? (profile.streak || 0) + 1
      : (profile.streak || 0);

    const updatedProfile = { ...profile, points: newPoints, streak: newStreak, lastActive: today };

    const earnedBadgeIds = profile.badges || [];
    const justEarned = BADGES.filter(b => !earnedBadgeIds.includes(b.id) && b.check(newSessions, updatedProfile));
    if (justEarned.length > 0) {
      updatedProfile.badges = [...earnedBadgeIds, ...justEarned.map(b => b.id)];
      setNewBadges(justEarned);
      setShowBadgePopup(true);
    }

    saveProfile(updatedProfile);
    setActiveDrill(null);
    setScreen('home');
  }

  if (screen === 'welcome' || !profile) {
    return <WelcomeScreen onComplete={(p) => { saveProfile(p); setScreen('home'); }} />;
  }

  if (activeDrill) {
    return <DrillScreen drill={activeDrill} onComplete={() => completeDrill(activeDrill)} onBack={() => setActiveDrill(null)} />;
  }

  const levelInfo = getLevelInfo(profile.points || 0);
  const nextLevel = getNextLevel(profile.points || 0);

  return (
    <div className="bb-app">
      {showBadgePopup && <BadgePopup badges={newBadges} onClose={() => setShowBadgePopup(false)} />}
      <div className="bb-content">
        {screen === 'home' && (
          <HomeScreen
            profile={profile} sessions={sessions} levelInfo={levelInfo} nextLevel={nextLevel}
            onNavigate={(s) => { setSelectedCategory(null); setScreen(s); }}
            onStartDrill={(drill) => setActiveDrill(drill)}
          />
        )}
        {screen === 'drills' && (
          <DrillsScreen
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            onStartDrill={(drill) => setActiveDrill(drill)}
            sessions={sessions}
          />
        )}
        {screen === 'progress' && (
          <ProgressScreen sessions={sessions} profile={profile} levelInfo={levelInfo} nextLevel={nextLevel} />
        )}
        {screen === 'rewards' && (
          <RewardsScreen earnedBadgeIds={profile.badges || []} sessions={sessions} />
        )}
        {screen === 'profile' && (
          <ProfileScreen
            profile={profile} onUpdate={saveProfile}
            onReset={() => { localStorage.clear(); setProfile(null); setSessions([]); setScreen('welcome'); }}
          />
        )}
      </div>
      <BottomNav active={screen} onNavigate={(s) => { setSelectedCategory(null); setScreen(s); }} />
    </div>
  );
}
