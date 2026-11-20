// バスケライセンス学習アプリ（PWA）
// 学習記録は端末の localStorage に保存します。

const STORE_KEY = "bblicense.v1";
const SESSION_SIZE = 10;
const MASTERY_STREAK = 2; // 連続正解でこの回数に達したら「習得」

// ---------- 永続データ ----------
function loadData() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { track: "referee", stats: {}, daily: {}, ...JSON.parse(raw) };
  } catch (_) {}
  return { track: "referee", stats: {}, daily: {} };
}
function saveData() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (_) {}
}
let data = loadData();

const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function recordAnswer(qid, ok) {
  const s = data.stats[qid] || { a: 0, c: 0, streak: 0 };
  s.a += 1;
  if (ok) { s.c += 1; s.streak += 1; } else { s.streak = 0; }
  s.lastOk = ok;
  s.last = Date.now();
  data.stats[qid] = s;
  const k = todayKey();
  const d = data.daily[k] || { a: 0, c: 0 };
  d.a += 1; if (ok) d.c += 1;
  data.daily[k] = d;
  saveData();
}

// ---------- 分析 ----------
const trackQs = () => QUESTIONS.filter((q) => q.track === data.track);

function summarize(qs) {
  let a = 0, c = 0, mastered = 0, tried = 0;
  for (const q of qs) {
    const s = data.stats[q.id];
    if (!s) continue;
    tried += 1; a += s.a; c += s.c;
    if (s.streak >= MASTERY_STREAK) mastered += 1;
  }
  return { a, c, acc: a ? c / a : null, mastered, tried, total: qs.length };
}

function categoryStats() {
  return CATEGORIES[data.track].map((name) => ({
    name,
    ...summarize(trackQs().filter((q) => q.category === name)),
  }));
}

// 苦手度が高い順（未解答も優先）にカテゴリを返す
function weakCategories() {
  return categoryStats()
    .filter((c) => c.a >= 2 && c.acc < 0.8)
    .sort((x, y) => x.acc - y.acc);
}

const wrongList = () => trackQs().filter((q) => data.stats[q.id] && data.stats[q.id].lastOk === false);

// 問題ごとの「出題優先度」。高いほど苦手。
function priority(q, catAcc) {
  const s = data.stats[q.id];
  const cat = catAcc[q.category];
  const catWeak = cat == null ? 0.5 : 1 - cat;
  if (!s) return 1.2 + catWeak;
  let p = (1 - s.c / s.a) * 2 + catWeak;
  if (!s.lastOk) p += 1;
  if (s.streak >= MASTERY_STREAK) p -= 1;
  // しばらく解いていない問題は少し優先（忘却対策）
  const days = (Date.now() - (s.last || 0)) / 86400000;
  p += Math.min(days / 7, 0.5);
  return p;
}

function weakSet(n = SESSION_SIZE) {
  const catAcc = Object.fromEntries(categoryStats().map((c) => [c.name, c.acc]));
  return trackQs()
    .map((q) => ({ q, p: priority(q, catAcc) + Math.random() * 0.3 }))
    .sort((x, y) => y.p - x.p)
    .slice(0, n)
    .map((x) => x.q);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 画面状態 ----------
let quiz = null; // { title, list, idx, results: [{q, ok}], order, picked }
const $app = document.getElementById("app");
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);

function startQuiz(title, list) {
  if (!list.length) return;
  quiz = { title, list, idx: 0, results: [], picked: null };
  quiz.order = shuffle(list[0].choices.map((_, i) => i));
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (!quiz) return renderHome();
  if (quiz.idx >= quiz.list.length) return renderResult();
  renderQuestion();
}

// ---------- ホーム ----------
function renderHome() {
  const qs = trackQs();
  const sum = summarize(qs);
  const cats = categoryStats();
  const weak = weakCategories();
  const wrong = wrongList();
  const weakNames = new Set(weak.map((w) => w.name));

  $app.innerHTML = `
    <header class="top">
      <h1>バスケ ライセンス学習</h1>
      <div class="seg" role="tablist" aria-label="対象ライセンス">
        <button role="tab" aria-selected="${data.track === "referee"}" data-track="referee">審判</button>
        <button role="tab" aria-selected="${data.track === "coach"}" data-track="coach">コーチ</button>
      </div>
    </header>

    <section class="kpis">
      <div class="kpi"><span class="kpi-label">正答率</span><span class="kpi-value">${pct(sum.acc)}</span></div>
      <div class="kpi"><span class="kpi-label">習得</span><span class="kpi-value">${sum.mastered}<small>/${sum.total}</small></span></div>
      <div class="kpi"><span class="kpi-label">解答数</span><span class="kpi-value">${sum.a}</span></div>
    </section>

    <section class="card">
      <h2>苦手分析</h2>
      ${
        sum.a === 0
          ? `<p class="muted">まだ記録がありません。まずは問題を解いてみましょう。</p>`
          : weak.length
          ? `<p>苦手な分野：${weak.map((w) => `<strong>${w.name}</strong>（${pct(w.acc)}）`).join("、")}</p>`
          : `<p class="muted">正答率80%未満の分野はありません。この調子で習得を増やしましょう。</p>`
      }
      <div class="actions">
        <button class="btn primary" data-act="weak">苦手克服 ${SESSION_SIZE}問</button>
        <button class="btn" data-act="wrong" ${wrong.length ? "" : "disabled"}>間違えた問題（${wrong.length}）</button>
        <button class="btn" data-act="random">ランダム ${SESSION_SIZE}問</button>
      </div>
    </section>

    <section class="card">
      <h2>分野別の理解度</h2>
      <p class="muted small">分野をタップするとその分野だけを出題します。</p>
      <ul class="cats">
        ${cats
          .map((c) => {
            const w = c.acc == null ? 0 : Math.round(c.acc * 100);
            const level = c.acc == null ? "none" : c.acc >= 0.8 ? "good" : c.acc >= 0.6 ? "mid" : "low";
            return `
            <li>
              <button class="cat" data-cat="${c.name}">
                <span class="cat-head">
                  <span class="cat-name">${c.name}${weakNames.has(c.name) ? ' <span class="tag">苦手</span>' : ""}</span>
                  <span class="cat-meta">${pct(c.acc)}・習得 ${c.mastered}/${c.total}</span>
                </span>
                <span class="bar"><span class="bar-fill ${level}" style="width:${w}%"></span></span>
              </button>
            </li>`;
          })
          .join("")}
      </ul>
    </section>

    <section class="card">
      <h2>直近14日の学習</h2>
      ${renderDaily()}
    </section>

    <footer class="foot">
      <p class="muted small">収録問題はオリジナルの練習問題です。競技規則は改訂されるため、最新のJBA/FIBA規則書で確認してください。</p>
      <button class="link" data-act="reset">学習記録をリセット</button>
    </footer>
  `;

  $app.querySelectorAll("[data-track]").forEach((b) =>
    b.addEventListener("click", () => { data.track = b.dataset.track; saveData(); render(); })
  );
  $app.querySelectorAll("[data-cat]").forEach((b) =>
    b.addEventListener("click", () => {
      const name = b.dataset.cat;
      startQuiz(name, shuffle(trackQs().filter((q) => q.category === name)));
    })
  );
  $app.querySelector('[data-act="weak"]').onclick = () => startQuiz("苦手克服", weakSet());
  $app.querySelector('[data-act="wrong"]').onclick = () => startQuiz("間違えた問題", shuffle(wrongList()));
  $app.querySelector('[data-act="random"]').onclick = () =>
    startQuiz("ランダム", shuffle(trackQs()).slice(0, SESSION_SIZE));
  $app.querySelector('[data-act="reset"]').onclick = () => {
    if (confirm("すべての学習記録を削除します。よろしいですか？")) {
      data = { track: data.track, stats: {}, daily: {} };
      saveData();
      render();
    }
  };
}

function renderDaily() {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const v = data.daily[todayKey(d)] || { a: 0, c: 0 };
    days.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, ...v });
  }
  const max = Math.max(5, ...days.map((d) => d.a));
  const total = days.reduce((s, d) => s + d.a, 0);
  const active = days.filter((d) => d.a > 0).length;
  return `
    <p class="small muted">${total}問 解答・${active}日 学習</p>
    <div class="daily" role="img" aria-label="直近14日の解答数">
      ${days
        .map(
          (d) => `
        <div class="day" title="${d.label}：${d.a}問（正解${d.c}）">
          <div class="day-col">
            <div class="day-bar" style="height:${(d.a / max) * 100}%">
              <div class="day-ok" style="height:${d.a ? (d.c / d.a) * 100 : 0}%"></div>
            </div>
          </div>
          <span class="day-label">${d.label.split("/")[1]}</span>
        </div>`
        )
        .join("")}
    </div>
    <div class="legend small muted"><span><i class="sw ok"></i>正解</span><span><i class="sw ng"></i>不正解</span></div>
  `;
}

// ---------- 出題 ----------
function renderQuestion() {
  const q = quiz.list[quiz.idx];
  const answered = quiz.picked != null;
  const progress = (quiz.idx / quiz.list.length) * 100;

  $app.innerHTML = `
    <header class="quiz-top">
      <button class="link" data-act="quit">← やめる</button>
      <span class="small muted">${quiz.title}・${quiz.idx + 1} / ${quiz.list.length}</span>
    </header>
    <div class="progress"><span style="width:${progress}%"></span></div>

    <section class="card">
      <span class="tag soft">${q.category}</span>
      <p class="question">${q.q}</p>
      <div class="choices">
        ${quiz.order
          .map((ci, n) => {
            let cls = "choice";
            if (answered) {
              if (ci === q.answer) cls += " correct";
              else if (ci === quiz.picked) cls += " wrong";
            }
            return `<button class="${cls}" data-ci="${ci}" ${answered ? "disabled" : ""}>
              <span class="num">${n + 1}</span><span>${q.choices[ci]}</span></button>`;
          })
          .join("")}
      </div>
      ${
        answered
          ? `<div class="feedback ${quiz.picked === q.answer ? "ok" : "ng"}">
               <strong>${quiz.picked === q.answer ? "正解！" : "不正解"}</strong>
               <p>${q.exp}</p>
             </div>
             <button class="btn primary block" data-act="next">${
               quiz.idx + 1 < quiz.list.length ? "次の問題へ" : "結果を見る"
             }</button>`
          : ""
      }
    </section>
  `;

  $app.querySelector('[data-act="quit"]').onclick = () => {
    if (quiz.results.length === 0 || confirm("途中でやめますか？（解答済みの記録は保存されます）")) {
      quiz = null; render();
    }
  };
  $app.querySelectorAll("[data-ci]").forEach((b) =>
    b.addEventListener("click", () => {
      if (quiz.picked != null) return;
      quiz.picked = Number(b.dataset.ci);
      const ok = quiz.picked === q.answer;
      recordAnswer(q.id, ok);
      quiz.results.push({ q, ok });
      render();
    })
  );
  const next = $app.querySelector('[data-act="next"]');
  if (next) {
    next.onclick = () => {
      quiz.idx += 1;
      quiz.picked = null;
      if (quiz.idx < quiz.list.length) quiz.order = shuffle(quiz.list[quiz.idx].choices.map((_, i) => i));
      render();
      window.scrollTo(0, 0);
    };
    next.focus();
  }
}

// ---------- 結果 ----------
function renderResult() {
  const r = quiz.results;
  const ok = r.filter((x) => x.ok).length;
  const wrong = r.filter((x) => !x.ok).map((x) => x.q);
  const byCat = {};
  for (const x of r) {
    byCat[x.q.category] = byCat[x.q.category] || { a: 0, c: 0 };
    byCat[x.q.category].a += 1;
    if (x.ok) byCat[x.q.category].c += 1;
  }

  $app.innerHTML = `
    <section class="card result">
      <p class="small muted">${quiz.title}</p>
      <p class="score">${ok}<small> / ${r.length}</small></p>
      <p>${ok === r.length ? "全問正解！" : ok / r.length >= 0.8 ? "よくできました。" : "間違えた問題を復習しましょう。"}</p>
    </section>

    <section class="card">
      <h2>分野別</h2>
      <ul class="plain">
        ${Object.entries(byCat)
          .map(([k, v]) => `<li><span>${k}</span><span>${v.c} / ${v.a}</span></li>`)
          .join("")}
      </ul>
    </section>

    ${
      wrong.length
        ? `<section class="card">
            <h2>間違えた問題</h2>
            <ul class="review">
              ${wrong
                .map((q) => `<li><p>${q.q}</p><p class="small"><strong>正解：</strong>${q.choices[q.answer]}</p></li>`)
                .join("")}
            </ul>
          </section>`
        : ""
    }

    <div class="actions">
      ${wrong.length ? `<button class="btn primary" data-act="retry">間違えた問題をもう一度</button>` : ""}
      <button class="btn" data-act="home">ホームへ</button>
    </div>
  `;
  const retry = $app.querySelector('[data-act="retry"]');
  if (retry) retry.onclick = () => startQuiz("復習", shuffle(wrong));
  $app.querySelector('[data-act="home"]').onclick = () => { quiz = null; render(); window.scrollTo(0, 0); };
}

render();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
