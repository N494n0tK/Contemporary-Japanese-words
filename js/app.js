/* ============================================================
   現代文単語 — app
   ============================================================ */
(() => {
  "use strict";

  // ---------- データ ----------
  const WORDS = (() => {
    const seen = new Set();
    const seenNo = new Set();
    const list = (window.WORDS || [])
      .filter((w) => w && w.word && w.meaning && !seen.has(w.word) && seen.add(w.word))
      .map((w) => ({
        no: w.no === undefined || w.no === null || w.no === "" ? null : w.no,
        word: String(w.word),
        reading: w.reading ? String(w.reading) : "",
        meaning: String(w.meaning),
        example: w.example ? String(w.example) : "",
        category: w.category ? String(w.category) : "その他",
        synonyms: Array.isArray(w.synonyms) ? w.synonyms : [],
        antonyms: Array.isArray(w.antonyms) ? w.antonyms : [],
      }));
    list.forEach((w) => {
      if (w.no === null) return;
      if (seenNo.has(String(w.no))) console.warn(`整理番号 ${w.no} が重複しています（${w.word}）`);
      seenNo.add(String(w.no));
    });
    // 整理番号順に並べる（番号のない語は末尾、書いた順のまま）
    return list
      .map((w, i) => [w, i])
      .sort(([a, i], [b, j]) => {
        if (a.no === null || b.no === null) return a.no === null && b.no === null ? i - j : a.no === null ? 1 : -1;
        return String(a.no).localeCompare(String(b.no), "ja", { numeric: true }) || i - j;
      })
      .map(([w]) => w);
  })();
  // 見出し語の文字数（.fit が1行に収まる文字サイズを計算するのに使う）
  const fitLen = (w) => `--len:${[...w.word].length}`;
  const noLabel = (w) => (w.no === null ? "" : `No.${w.no}`);
  const CATEGORIES = [...new Set(WORDS.map((w) => w.category))];
  const BY_WORD = new Map(WORDS.map((w) => [w.word, w]));

  // ---------- 保存 ----------
  const STORE_KEY = "gendaibun-words.v1";
  const NEW = 0, LEARNING = 1, MASTERED = 2;
  const STATUS_LABEL = ["未学習", "学習中", "覚えた"];
  const STATUS_CLASS = ["c-new", "c-learning", "c-mastered"];

  let store = { progress: {}, settings: { quizCount: 10, quizMode: "mix", cardMode: "w2m" } };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && typeof saved === "object") {
      store.progress = saved.progress || {};
      store.settings = Object.assign(store.settings, saved.settings || {});
    }
  } catch (_) { /* 保存領域が使えない環境ではメモリのみ */ }

  const save = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) {}
  };
  const prog = (word) => store.progress[word] || { s: NEW, ok: 0, ng: 0, streak: 0, star: false };
  const setProg = (word, patch) => {
    store.progress[word] = Object.assign(prog(word), patch, { t: Date.now() });
    save();
  };
  const statusOf = (word) => prog(word).s || NEW;
  const isWeak = (word) => {
    const p = prog(word);
    return p.star || (p.ng > 0 && p.s !== MASTERED);
  };

  // ---------- ユーティリティ ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const counts = (list = WORDS) => {
    const c = [0, 0, 0];
    list.forEach((w) => c[statusOf(w.word)]++);
    return c;
  };

  const view = $("#view");
  const titleEl = $("#viewTitle");
  const badgeEl = $("#topBadge");

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  // 押した位置から光が広がる
  document.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".press");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, { passive: true });

  // ---------- ルーティング（履歴は使わない＝戻る操作でアプリを離れない） ----------
  let current = "home";
  const TITLES = { home: "ホーム", cards: "単語カード", quiz: "4択クイズ", list: "単語一覧", weak: "苦手な単語", settings: "設定" };

  function go(name, params = {}) {
    current = name;
    closeSheet();
    titleEl.textContent = TITLES[name] || "";
    badgeEl.textContent = "";
    $$(".drawer-nav button").forEach((b) => b.classList.toggle("on", b.dataset.nav === name));
    enterAnim();
    window.scrollTo(0, 0);
    (VIEWS[name] || VIEWS.home)(params);
    updateDrawerSub();
  }

  // 画面を出すときの「ふわっと出る」演出。終わったら外す
  // （付けたままだと、あとから差し込んだ要素＝裏で用意した次のカードなどにも演出がかかってしまう）
  let enterTimer;
  function enterAnim() {
    view.classList.remove("enter");
    void view.offsetWidth;
    view.classList.add("enter");
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => view.classList.remove("enter"), 900);
  }

  function updateDrawerSub() {
    const c = counts();
    $("#drawerSub").textContent = `${WORDS.length}語中 ${c[MASTERED]}語 習得`;
  }

  // ---------- 部品 ----------
  const chipRow = (items, active, attr) =>
    `<div class="chips" data-noswipe>${items
      .map(([val, label]) => `<button class="chip glass press ${val === active ? "on" : ""}" data-${attr}="${esc(val)}"><span>${esc(label)}</span></button>`)
      .join("")}</div>`;

  const catChips = (active, attr = "cat") =>
    chipRow([["all", "すべて"], ...CATEGORIES.map((c) => [c, c])], active, attr);

  const relHtml = (w) => {
    let h = "";
    if (w.synonyms.length) h += `<div class="rel"><span class="lbl">類</span>${w.synonyms.map((s) => `<span class="pill">${esc(s)}</span>`).join("")}</div>`;
    if (w.antonyms.length) h += `<div class="rel"><span class="lbl">対</span>${w.antonyms.map((s) => `<span class="pill anti">${esc(s)}</span>`).join("")}</div>`;
    return h;
  };

  const wordRow = (w) => {
    const p = prog(w.word);
    return `<div class="word-row glass press" data-word="${esc(w.word)}" role="button" tabindex="0">
      <span class="dot ${STATUS_CLASS[p.s || 0]}"></span>
      <div class="grow">
        <div class="w">${w.no !== null ? `<span class="num">${esc(noLabel(w))}</span>` : ""}${esc(w.word)} <span class="r">${esc(w.reading)}</span></div>
        <div class="m">${esc(w.meaning)}</div>
      </div>
      <button class="star ${p.star ? "on" : ""}" data-star="${esc(w.word)}" aria-label="お気に入り">${p.star ? "★" : "☆"}</button>
    </div>`;
  };

  function bindWordRows(root, onChange) {
    root.addEventListener("click", (e) => {
      const star = e.target.closest("[data-star]");
      if (star) {
        e.stopPropagation();
        const word = star.dataset.star;
        const on = !prog(word).star;
        setProg(word, { star: on });
        star.classList.toggle("on", on);
        star.textContent = on ? "★" : "☆";
        toast(on ? "★ 苦手リストに追加" : "苦手リストから外しました");
        onChange && onChange();
        return;
      }
      const row = e.target.closest("[data-word]");
      if (row) openWordSheet(row.dataset.word, onChange);
    });
  }

  // ---------- 詳細シート ----------
  const sheetWrap = $("#sheetWrap");
  const sheet = $("#sheet");

  function openWordSheet(word, onChange) {
    const w = BY_WORD.get(word);
    if (!w) return;
    const render = () => {
      const p = prog(word);
      sheet.innerHTML = `
        <div class="grab-zone" aria-label="下に引っ張って閉じる"><div class="grabber"></div></div>
        <div class="sheet-body">
        <div class="sheet-tag">${w.no !== null ? `${esc(noLabel(w))} ・ ` : ""}${esc(w.category)}</div>
        <div class="back-word fit" style="margin-top:10px;${fitLen(w)}">${esc(w.word)}</div>
        <div class="back-reading">${esc(w.reading)}</div>
        <div class="back-meaning">${esc(w.meaning)}</div>
        ${w.example ? `<div class="back-example">${esc(w.example)}</div>` : ""}
        ${relHtml(w)}
        <div class="status-seg">${STATUS_LABEL.map((l, i) => `<button data-s="${i}" class="${(p.s || 0) === i ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="btn-row">
          <button class="btn small glass press" data-act="star"><span>${p.star ? "★ 苦手から外す" : "☆ 苦手に追加"}</span></button>
          <button class="btn small glass press" data-act="close"><span>閉じる</span></button>
        </div>
        <div style="text-align:center;font-size:12px;color:var(--ink-3);margin-top:12px">正解 ${p.ok || 0} ・ 不正解 ${p.ng || 0}</div>
        </div>`;
    };
    render();
    sheet.onclick = (e) => {
      const s = e.target.closest("[data-s]");
      if (s) {
        setProg(word, { s: Number(s.dataset.s), streak: 0 });
        render();
        onChange && onChange();
        return;
      }
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "star") {
        setProg(word, { star: !prog(word).star });
        render();
        onChange && onChange();
      } else closeSheet();
    };
    sheetWrap.classList.add("open");
  }
  function closeSheet() { sheetWrap.classList.remove("open"); }
  sheetWrap.addEventListener("click", (e) => { if (e.target === sheetWrap) closeSheet(); });
  const sheetOpen = () => sheetWrap.classList.contains("open");

  // 上の掴み部分を下に引っ張って閉じる
  let sd = null;
  sheet.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".grab-zone") || !sheetOpen()) return;
    const now = performance.now();
    sd = { id: e.pointerId, y0: e.clientY, y: e.clientY, py: e.clientY, pt: now, v: 0 };
    sheet.setPointerCapture(e.pointerId);
    sheetWrap.classList.add("dragging");
  });
  sheet.addEventListener("pointermove", (e) => {
    if (!sd || e.pointerId !== sd.id) return;
    const now = performance.now();
    if (now > sd.pt) sd.v = (e.clientY - sd.py) / (now - sd.pt);
    sd.py = e.clientY;
    sd.pt = now;
    sd.y = e.clientY;
    const dy = sd.y - sd.y0;
    // 上方向は少しだけ動くゴムのような抵抗
    const shown = dy >= 0 ? dy : -Math.sqrt(-dy) * 2;
    sheet.style.transform = `translateY(${shown}px)`;
    sheetWrap.style.setProperty("--dim", String(Math.max(0, 1 - Math.max(0, dy) / sheet.offsetHeight)));
  });
  const endSheetDrag = (e) => {
    if (!sd || e.pointerId !== sd.id) return;
    const dy = sd.y - sd.y0;
    const v = sd.v;
    sd = null;
    sheetWrap.classList.remove("dragging");
    sheet.style.transform = "";
    sheetWrap.style.removeProperty("--dim");
    if (v > 0.5 || (dy > Math.min(120, sheet.offsetHeight * 0.3) && v > -0.2)) closeSheet();
  };
  sheet.addEventListener("pointerup", endSheetDrag);
  sheet.addEventListener("pointercancel", endSheetDrag);

  // ============================================================
  // 画面
  // ============================================================
  const VIEWS = {};

  // ---------- ホーム ----------
  VIEWS.home = () => {
    const c = counts();
    const total = WORDS.length || 1;
    const pct = Math.round((c[MASTERED] / total) * 100);
    const R = 48, L = 2 * Math.PI * R;
    const h = new Date().getHours();
    const greet = h < 5 ? "夜更かしの<br>ひと勉強" : h < 11 ? "おはよう。<br>朝の1セット" : h < 17 ? "すきま時間に<br>コツコツと" : "今日の仕上げに<br>もう一歩";
    const weak = WORDS.filter((w) => isWeak(w.word)).length;

    view.innerHTML = `
      <section class="hero glass">
        <div class="ring">
          <svg viewBox="0 0 112 112">
            <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs>
            <circle class="track" cx="56" cy="56" r="${R}" fill="none" stroke-width="10"/>
            <circle class="bar" cx="56" cy="56" r="${R}" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${L}"/>
          </svg>
          <div class="ring-label"><div><b>${pct}<span style="font-size:15px">%</span></b><small>習得率</small></div></div>
        </div>
        <div class="hero-stats">
          <div class="hero-greet">${greet}</div>
          <div class="stat-row">
            <span class="stat"><span class="dot c-mastered"></span>覚えた <b>${c[MASTERED]}</b></span>
            <span class="stat"><span class="dot c-learning"></span>学習中 <b>${c[LEARNING]}</b></span>
            <span class="stat"><span class="dot c-new"></span>未学習 <b>${c[NEW]}</b></span>
          </div>
        </div>
      </section>

      <div class="section-title">学習する</div>
      <div class="tiles">
        <button class="tile glass press" data-go="cards"><span class="tile-ico" style="--c1:#5b6cff;--c2:#9b5cff">❏</span><span><div class="tile-name">単語カード</div><div class="tile-desc">めくって覚える</div></span></button>
        <button class="tile glass press" data-go="quiz"><span class="tile-ico" style="--c1:#ff6b9a;--c2:#ff9f5a">✎</span><span><div class="tile-name">4択クイズ</div><div class="tile-desc">${store.settings.quizCount}問でチェック</div></span></button>
        <button class="tile glass press" data-go="list"><span class="tile-ico" style="--c1:#14b8a6;--c2:#3b82f6">☰</span><span><div class="tile-name">単語一覧</div><div class="tile-desc">${WORDS.length}語を検索</div></span></button>
        <button class="tile glass press" data-go="weak"><span class="tile-ico" style="--c1:#f59e0b;--c2:#ef4444">!</span><span><div class="tile-name">苦手な単語</div><div class="tile-desc">${weak}語を復習</div></span></button>
      </div>

      <div class="section-title">カテゴリ別</div>
      <div class="cat-list">
        ${CATEGORIES.map((cat) => {
          const ws = WORDS.filter((w) => w.word && w.category === cat);
          const m = counts(ws)[MASTERED];
          return `<button class="cat-item glass press" data-cat-go="${esc(cat)}">
            <div class="grow">
              <div style="display:flex;justify-content:space-between;gap:8px"><span class="cat-name">${esc(cat)}</span><span class="cat-count">${m} / ${ws.length}</span></div>
              <div class="mini-bar"><i style="width:${(m / ws.length) * 100}%"></i></div>
            </div>
          </button>`;
        }).join("")}
      </div>`;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      const bar = $(".ring .bar", view);
      if (bar) bar.style.strokeDashoffset = String(L * (1 - c[MASTERED] / total));
    }));

    view.onclick = (e) => {
      const t = e.target.closest("[data-go]");
      if (t) return go(t.dataset.go);
      const c2 = e.target.closest("[data-cat-go]");
      if (c2) go("cards", { cat: c2.dataset.catGo });
    };
  };

  // ---------- 単語カード ----------
  const cardOpts = { cat: "all", onlyUnmastered: false, shuffle: true };
  let deck = null;

  function buildDeck(words) {
    let ws = words || WORDS.filter((w) => cardOpts.cat === "all" || w.category === cardOpts.cat);
    if (!words && cardOpts.onlyUnmastered) ws = ws.filter((w) => statusOf(w.word) !== MASTERED);
    if (cardOpts.shuffle) ws = shuffle(ws);
    deck = { list: ws, i: 0, known: 0, unknown: 0, custom: !!words };
  }

  VIEWS.cards = (params = {}) => {
    if (params.cat) { cardOpts.cat = params.cat; deck = null; }
    if (params.words) buildDeck(params.words);
    if (!deck) buildDeck();
    renderCards();
  };

  function renderCards() {
    const total = deck.list.length;
    let head = deck.custom
      ? `<div class="count-note">苦手な単語を復習中</div>`
      : `${catChips(cardOpts.cat)}`;
    // 表に出す面の切り替え（タップするたびに 語→意味 / 意味→語 が入れ替わる）
    const dirChip = `<button class="chip glass press" data-dir aria-label="表に出す面を切り替え"><span>⇄ ${store.settings.cardMode === "m2w" ? "意味 → 語" : "語 → 意味"}</span></button>`;
    head += deck.custom
      ? `<div class="toggles">${dirChip}</div>`
      : `
        <div class="toggles">
          ${dirChip}
          <button class="chip glass press ${cardOpts.onlyUnmastered ? "on" : ""}" data-opt="only"><span>未習得のみ</span></button>
          <button class="chip glass press ${cardOpts.shuffle ? "on" : ""}" data-opt="shuffle"><span>シャッフル</span></button>
        </div>`;

    if (!total) {
      badgeEl.textContent = "";
      view.innerHTML = `${head}<div class="glass result"><div class="msg">該当する単語がありません</div><p style="color:var(--ink-2)">条件を変えてみてください。</p></div>`;
      bindCardHead();
      return;
    }

    if (deck.i >= total) {
      badgeEl.textContent = "";
      enterAnim();
      view.innerHTML = `${head}
        <div class="glass result">
          <div style="font-size:44px">🎉</div>
          <div class="msg">${total}枚 完了！</div>
          <p style="color:var(--ink-2);margin:4px 0 18px">覚えた ${deck.known} ・ まだ ${deck.unknown}</p>
          <button class="btn primary block press" data-act="again"><span>もう一度</span></button>
          <div class="btn-row">
            <button class="btn glass press" data-act="quiz"><span>クイズで確認</span></button>
            <button class="btn glass press" data-act="home"><span>ホーム</span></button>
          </div>
        </div>`;
      bindCardHead();
      return;
    }

    const w = deck.list[deck.i];
    badgeEl.textContent = `${deck.i + 1} / ${total}`;
    view.innerHTML = `${head}
      <div class="progress-line"><i style="width:${(deck.i / total) * 100}%"></i></div>
      <div class="flip-scene">
        ${flipHtml(w, "", "in")}
      </div>
      <div class="answer-row">
        <button class="btn glass press tint-bad" data-ans="0"><span>まだ</span></button>
        <button class="btn glass press tint-good" data-ans="1"><span>覚えた</span></button>
      </div>`;
    bindCardHead();
    requestAnimationFrame(preloadNext);
  }

  function cardFace(w, back, enter = "") {
    const s = statusOf(w.word);
    if (!back) {
      return `<div class="face glass press ${enter}" data-flip>
        <span class="tag">${w.no !== null ? `${esc(noLabel(w))} ・ ` : ""}${esc(w.category)}</span>
        <span class="status-dot ${STATUS_CLASS[s]}"></span>
        ${store.settings.cardMode === "m2w"
          ? `<div class="front-meaning">${esc(w.meaning)}</div>
        <div class="tap-hint">タップで語を表示</div>`
          : `<div class="big-word fit" style="${fitLen(w)}">${esc(w.word)}</div>
        <div class="tap-hint">タップで意味を表示</div>`}
      </div>`;
    }
    return `<div class="face back glass press is-hidden" data-flip>
      <span class="tag">${w.no !== null ? `${esc(noLabel(w))} ・ ` : ""}${esc(w.category)}</span>
      <div class="back-word fit" style="${fitLen(w)}">${esc(w.word)}</div>
      <div class="back-reading">${esc(w.reading)}</div>
      <div class="back-meaning">${esc(w.meaning)}</div>
      ${w.example ? `<div class="back-example">${esc(w.example)}</div>` : ""}
      ${relHtml(w)}
    </div>`;
  }

  function flipCard() {
    const flip = $("#flip");
    if (!flip || flip.dataset.busy) return;
    flip.dataset.busy = "1";
    // 表と裏は最初から両方描画しておき、半分回ったところで見える面を入れ替えるだけにする
    // （途中で DOM を作り直すとガラスの再描画が走り、めくりがもたつく）
    const [front, back] = $$(".face", flip);
    const toBack = !flip.dataset.back;
    const a = flip.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: 110, easing: "cubic-bezier(.4,0,.9,.6)", fill: "forwards" });
    a.onfinish = () => {
      front.classList.remove("in", "next");
      front.classList.toggle("is-hidden", toBack);
      back.classList.toggle("is-hidden", !toBack);
      if (toBack) flip.dataset.back = "1"; else delete flip.dataset.back;
      const b = flip.animate(
        [{ transform: "scaleX(0)" }, { transform: "scaleX(1.03)", offset: 0.7 }, { transform: "scaleX(1)" }],
        { duration: 300, easing: "cubic-bezier(.15,.8,.3,1)" }
      );
      a.cancel();
      b.onfinish = () => delete flip.dataset.busy;
    };
  }

  // 次のカード（opacity をほぼ 0 にして下に置いておく）。ガラスの描画を先に済ませておくため
  const flipHtml = (w, cls, enter = "") => `<div class="flip ${cls}"${cls ? "" : ' id="flip"'}>${cardFace(w, false, enter)}${cardFace(w, true)}</div>`;

  function preloadNext() {
    const scene = $(".flip-scene", view);
    const next = deck.list[deck.i + 1];
    if (!scene || !next || $(".flip.queued", scene)) return;
    scene.insertAdjacentHTML("afterbegin", flipHtml(next, "queued"));
  }

  function answerCard(known) {
    const flip = $("#flip");
    if (!flip) return;
    const w = deck.list[deck.i];
    const p = prog(w.word);
    if (known) {
      setProg(w.word, { s: MASTERED, ok: (p.ok || 0) + 1 });
      deck.known++;
    } else {
      setProg(w.word, { s: LEARNING, ng: (p.ng || 0) + 1, streak: 0 });
      deck.unknown++;
    }

    // 1) 今のカードを判定の方向へスッと飛ばす（覚えた → 右 / まだ → 左）
    flip.removeAttribute("id");
    flip.classList.add("leaving");
    const dir = known ? 1 : -1;
    const out = flip.animate(
      [
        { transform: "translateX(0) rotate(0deg)", opacity: 1 },
        { transform: `translateX(${dir * 70}%) rotate(${dir * 7}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translateX(${dir * 125}%) rotate(${dir * 12}deg)`, opacity: 0 },
      ],
      { duration: 300, easing: "cubic-bezier(.2,.75,.35,1)", fill: "forwards" }
    );
    out.onfinish = () => flip.remove();

    deck.i++;
    if (deck.i >= deck.list.length) {
      setTimeout(() => current === "cards" && renderCards(), 240);
      return;
    }

    // 2) 用意しておいた次のカードを同じ瞬間に前へ出す
    let next = $(".flip.queued", view);
    if (next) {
      next.classList.remove("queued");
      next.id = "flip";
    } else {
      flip.insertAdjacentHTML("beforebegin", flipHtml(deck.list[deck.i], "", "next"));
    }
    badgeEl.textContent = `${deck.i + 1} / ${deck.list.length}`;
    const bar = $(".progress-line i", view);
    if (bar) bar.style.width = `${(deck.i / deck.list.length) * 100}%`;

    // 3) 飛ばすアニメーションが走り出してから、さらに次のカードを裏で用意する
    requestAnimationFrame(() => requestAnimationFrame(preloadNext));
  }


  function bindCardHead() {
    view.onclick = (e) => {
      const cat = e.target.closest("[data-cat]");
      if (cat) { cardOpts.cat = cat.dataset.cat; buildDeck(); return renderCards(); }
      const dir = e.target.closest("[data-dir]");
      if (dir) {
        store.settings.cardMode = store.settings.cardMode === "m2w" ? "w2m" : "m2w";
        save();
        return renderCards();
      }
      const opt = e.target.closest("[data-opt]");
      if (opt) {
        if (opt.dataset.opt === "only") cardOpts.onlyUnmastered = !cardOpts.onlyUnmastered;
        else cardOpts.shuffle = !cardOpts.shuffle;
        buildDeck();
        return renderCards();
      }
      if (e.target.closest("[data-flip]")) return flipCard();
      const ans = e.target.closest("[data-ans]");
      if (ans) return answerCard(ans.dataset.ans === "1");
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "again") { deck.custom ? buildDeck(deck.list) : buildDeck(); renderCards(); }
      else if (act.dataset.act === "quiz") go("quiz", { cat: cardOpts.cat });
      else go("home");
    };
  }

  // ---------- クイズ ----------
  const quizOpts = { cat: "all" };
  let quiz = null;

  VIEWS.quiz = (params = {}) => {
    if (params.cat) quizOpts.cat = params.cat;
    if (params.words) return startQuiz(params.words);
    quiz = null;
    renderQuizSetup();
  };

  function renderQuizSetup() {
    const st = store.settings;
    const pool = WORDS.filter((w) => quizOpts.cat === "all" || w.category === quizOpts.cat);
    view.innerHTML = `
      <div class="section-title" style="margin-top:4px">出題範囲</div>
      ${catChips(quizOpts.cat)}
      <div class="section-title">問題数</div>
      <div class="seg">${[5, 10, 20, 30].map((n) => `<button class="chip glass press ${st.quizCount === n ? "on" : ""}" data-count="${n}"><span>${n}問</span></button>`).join("")}</div>
      <div class="section-title">形式</div>
      <div class="seg">${[["mix", "ミックス"], ["w2m", "語 → 意味"], ["m2w", "意味 → 語"]].map(([v, l]) => `<button class="chip glass press ${st.quizMode === v ? "on" : ""}" data-mode="${v}"><span>${l}</span></button>`).join("")}</div>
      <div style="height:26px"></div>
      <button class="btn primary block press" data-act="start" ${pool.length < 2 ? "disabled" : ""}><span>スタート（${Math.min(st.quizCount, pool.length)}問）</span></button>
      <div class="btn-row"><button class="btn glass press" data-act="weak"><span>苦手から出題</span></button></div>`;

    view.onclick = (e) => {
      const cat = e.target.closest("[data-cat]");
      if (cat) { quizOpts.cat = cat.dataset.cat; return renderQuizSetup(); }
      const cnt = e.target.closest("[data-count]");
      if (cnt) { st.quizCount = Number(cnt.dataset.count); save(); return renderQuizSetup(); }
      const md = e.target.closest("[data-mode]");
      if (md) { st.quizMode = md.dataset.mode; save(); return renderQuizSetup(); }
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "start") startQuiz(shuffle(pool).slice(0, st.quizCount));
      else {
        const weak = WORDS.filter((w) => isWeak(w.word));
        if (!weak.length) return toast("苦手な単語はまだありません");
        startQuiz(shuffle(weak).slice(0, st.quizCount));
      }
    };
  }

  function makeQuestion(w) {
    const mode = store.settings.quizMode === "mix" ? (Math.random() < 0.5 ? "w2m" : "m2w") : store.settings.quizMode;
    const same = shuffle(WORDS.filter((x) => x.word !== w.word && x.category === w.category));
    const other = shuffle(WORDS.filter((x) => x.word !== w.word && x.category !== w.category));
    const distract = [...same, ...other].slice(0, 3);
    return { w, mode, options: shuffle([w, ...distract]), answered: null };
  }

  function startQuiz(words) {
    if (!words.length) return toast("出題できる単語がありません");
    quiz = { qs: words.map(makeQuestion), i: 0, score: 0, missed: [] };
    renderQuestion();
  }

  function renderQuestion() {
    if (quiz.i >= quiz.qs.length) return renderQuizResult();
    const q = quiz.qs[quiz.i];
    badgeEl.textContent = `Q ${quiz.i + 1} / ${quiz.qs.length}`;
    enterAnim();
    const isW2M = q.mode === "w2m";
    view.innerHTML = `
      <div class="progress-line"><i style="width:${(quiz.i / quiz.qs.length) * 100}%"></i></div>
      <div class="q-card glass">
        ${q.w.no !== null ? `<div class="q-no">${esc(noLabel(q.w))}</div>` : ""}
        <div class="q-kind">${isW2M ? "この語の意味は？" : "この意味を表す語は？"}</div>
        ${isW2M ? `<div class="q-word fit" style="${fitLen(q.w)}">${esc(q.w.word)}</div>` : `<div class="q-meaning">${esc(q.w.meaning)}</div>`}
      </div>
      <div class="options">
        ${q.options.map((o, i) => `<button class="opt glass press ${isW2M ? "" : "serif"}" data-opt="${i}"><span class="no">${i + 1}</span><span>${esc(isW2M ? o.meaning : o.word)}</span></button>`).join("")}
      </div>
      <div id="fb"></div>`;

    view.onclick = (e) => {
      const b = e.target.closest("[data-opt]");
      if (b && q.answered === null) return answerQuiz(Number(b.dataset.opt));
      if (e.target.closest("[data-act=next]")) { quiz.i++; renderQuestion(); }
    };
  }

  function answerQuiz(idx) {
    const q = quiz.qs[quiz.i];
    q.answered = idx;
    const correct = q.options[idx] === q.w;
    const p = prog(q.w.word);
    if (correct) {
      quiz.score++;
      const streak = (p.streak || 0) + 1;
      setProg(q.w.word, { ok: (p.ok || 0) + 1, streak, s: streak >= 2 ? MASTERED : Math.max(p.s || 0, LEARNING) });
    } else {
      quiz.missed.push(q.w);
      setProg(q.w.word, { ng: (p.ng || 0) + 1, streak: 0, s: LEARNING });
    }
    $$(".opt", view).forEach((el, i) => {
      el.disabled = true;
      if (q.options[i] === q.w) el.classList.add("correct");
      else if (i === idx) el.classList.add("wrong");
      else el.classList.add("dim");
    });
    if (navigator.vibrate) navigator.vibrate(correct ? 12 : [20, 40, 20]);
    const last = quiz.i === quiz.qs.length - 1;
    $("#fb").innerHTML = `
      <div class="feedback glass">
        <div style="font-weight:700;color:${correct ? "var(--good)" : "var(--bad)"};margin-bottom:4px">${correct ? "正解！" : "不正解"}</div>
        <div>${q.w.no !== null ? `<span class="fb-no">${esc(noLabel(q.w))}</span>` : ""}<b>${esc(q.w.word)}</b>（${esc(q.w.reading)}）</div>
        <div style="margin-top:2px">${esc(q.w.meaning)}</div>
        ${q.w.example ? `<div style="margin-top:6px;color:var(--ink-2);font-family:var(--font-serif)">例）${esc(q.w.example)}</div>` : ""}
      </div>
      <div style="height:12px"></div>
      <button class="btn primary block press" data-act="next"><span>${last ? "結果を見る" : "次へ"}</span></button>`;
    $("#fb").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderQuizResult() {
    badgeEl.textContent = "";
    enterAnim();
    const n = quiz.qs.length;
    const r = quiz.score / n;
    const msg = r === 1 ? "パーフェクト！" : r >= 0.8 ? "すばらしい！" : r >= 0.5 ? "いい調子。" : "復習してもう一度！";
    view.innerHTML = `
      <div class="glass result">
        <div class="score">${quiz.score}<span style="font-size:28px"> / ${n}</span></div>
        <div class="msg">${msg}</div>
        <p style="color:var(--ink-2);margin:0 0 18px">正答率 ${Math.round(r * 100)}%</p>
        <button class="btn primary block press" data-act="retry"><span>もう一度</span></button>
        ${quiz.missed.length ? `<div class="btn-row"><button class="btn glass press" data-act="miss"><span>間違えた${quiz.missed.length}問を解き直す</span></button></div>` : ""}
      </div>
      ${quiz.missed.length ? `<div class="section-title">間違えた単語</div><div class="word-list" id="missList">${quiz.missed.map(wordRow).join("")}</div>` : ""}`;
    view.onclick = (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "retry") renderQuizSetup();
      else startQuiz(shuffle(quiz.missed));
    };
    const ml = $("#missList");
    if (ml) bindWordRows(ml);
  }

  // ---------- 単語一覧 ----------
  const listOpts = { q: "", cat: "all", st: "all" };

  VIEWS.list = () => {
    view.innerHTML = `
      <label class="search glass">
        <svg width="18" height="18" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input id="q" type="search" placeholder="語・読み・意味・番号で検索" value="${esc(listOpts.q)}" autocomplete="off" enterkeyhint="search">
      </label>
      <div id="listCats">${catChips(listOpts.cat)}</div>
      <div id="listSt">${chipRow([["all", "すべて"], ["0", "未学習"], ["1", "学習中"], ["2", "覚えた"], ["star", "★"]], listOpts.st, "st")}</div>
      <div class="count-note" id="countNote"></div>
      <div class="word-list" id="wordList"></div>`;

    const listEl = $("#wordList");
    const renderList = () => {
      const q = listOpts.q.trim().toLowerCase();
      const ws = WORDS.filter((w) => {
        if (listOpts.cat !== "all" && w.category !== listOpts.cat) return false;
        const p = prog(w.word);
        if (listOpts.st === "star" && !p.star) return false;
        if (/^\d$/.test(listOpts.st) && (p.s || 0) !== Number(listOpts.st)) return false;
        if (q && String(w.no ?? "").toLowerCase() !== q.replace(/^no\.?\s*/, "") && !(w.word + w.reading + w.meaning + w.synonyms.join("") + w.antonyms.join("")).toLowerCase().includes(q)) return false;
        return true;
      });
      $("#countNote").textContent = `${ws.length}語`;
      listEl.innerHTML = ws.length ? ws.map(wordRow).join("") : `<div class="empty">見つかりませんでした</div>`;
    };
    renderList();
    bindWordRows(listEl, renderList);

    $("#q").addEventListener("input", (e) => { listOpts.q = e.target.value; renderList(); });
    view.onclick = (e) => {
      const cat = e.target.closest("[data-cat]");
      if (cat) {
        listOpts.cat = cat.dataset.cat;
        $$("[data-cat]", view).forEach((b) => b.classList.toggle("on", b === cat));
        return renderList();
      }
      const st = e.target.closest("[data-st]");
      if (st) {
        listOpts.st = st.dataset.st;
        $$("[data-st]", view).forEach((b) => b.classList.toggle("on", b === st));
        renderList();
      }
    };
  };

  // ---------- 苦手 ----------
  VIEWS.weak = () => {
    const render = () => {
      const ws = WORDS.filter((w) => isWeak(w.word));
      view.innerHTML = ws.length
        ? `<div class="glass setting">
            <h3>苦手な単語 ${ws.length}語</h3>
            <p>カードやクイズで間違えた語と、★をつけた語がここに集まります。</p>
            <div class="btn-row" style="margin-top:0">
              <button class="btn glass press" data-act="cards"><span>カードで復習</span></button>
              <button class="btn primary press" data-act="quiz"><span>クイズ</span></button>
            </div>
          </div>
          <div class="word-list" id="weakList">${ws.map(wordRow).join("")}</div>`
        : `<div class="glass result"><div style="font-size:44px">✨</div><div class="msg">苦手な単語はありません</div><p style="color:var(--ink-2)">カードやクイズで間違えた語、★をつけた語がここに表示されます。</p></div>`;
      const wl = $("#weakList");
      if (wl) bindWordRows(wl, render);
      view.onclick = (e) => {
        const act = e.target.closest("[data-act]");
        if (!act) return;
        if (act.dataset.act === "cards") go("cards", { words: ws });
        else go("quiz", { words: shuffle(ws).slice(0, store.settings.quizCount) });
      };
    };
    render();
  };

  // ---------- 設定 ----------
  VIEWS.settings = () => {
    view.innerHTML = `
      <div class="glass setting">
        <h3>収録データ</h3>
        <p>${WORDS.length}語 ・ ${CATEGORIES.length}カテゴリ<br>${CATEGORIES.map(esc).join(" / ")}</p>
      </div>
      <div class="glass setting">
        <h3>単語の追加</h3>
        <p><code>data/words.js</code> の配列に <code>{ no, word, reading, meaning, example, category }</code> を追加すると自動で反映されます。</p>
      </div>
      <div class="glass setting">
        <h3>ホーム画面に追加</h3>
        <p>共有メニューから「ホーム画面に追加」すると、全画面のアプリとして使えます（ブラウザの「戻る」も出ません）。</p>
      </div>
      <div class="glass setting">
        <h3>学習記録をリセット</h3>
        <p>すべての進み具合・★をこの端末から消去します。</p>
        <button class="btn glass press tint-bad block" data-act="reset"><span>リセットする</span></button>
      </div>`;
    view.onclick = (e) => {
      if (!e.target.closest("[data-act=reset]")) return;
      if (!confirm("学習記録をすべて消去しますか？")) return;
      store.progress = {};
      save();
      deck = null;
      toast("リセットしました");
      updateDrawerSub();
    };
  };

  // ============================================================
  // サイドバー（左→右スワイプ）＋ 戻る操作の抑止
  // ============================================================
  const body = document.body;
  const drawer = $("#drawer");
  const scrim = $("#scrim");
  const isOpen = () => body.classList.contains("drawer-open");

  function openDrawer() {
    body.classList.add("drawer-open");
    drawer.setAttribute("aria-hidden", "false");
    drawer.style.transform = "";
    scrim.style.opacity = "";
  }
  function closeDrawer() {
    body.classList.remove("drawer-open");
    drawer.setAttribute("aria-hidden", "true");
    drawer.style.transform = "";
    scrim.style.opacity = "";
  }

  $("#menuBtn").addEventListener("click", () => (isOpen() ? closeDrawer() : openDrawer()));
  scrim.addEventListener("click", closeDrawer);
  drawer.addEventListener("click", (e) => {
    const b = e.target.closest("[data-nav]");
    if (!b) return;
    closeDrawer();
    go(b.dataset.nav);
  });

  const EDGE = 28; // iOS Safari の「戻る」スワイプが反応する左端の幅
  let g = null;

  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { g = null; return; }
    const t = e.touches[0];
    const edge = t.clientX < EDGE || t.clientX > window.innerWidth - EDGE;
    // 画面端から始まるタッチは既定動作（＝ブラウザの戻る/進む）を止める
    if (edge && !e.target.closest("input")) e.preventDefault();
    g = {
      x0: t.clientX, y0: t.clientY, x: t.clientX, t0: performance.now(),
      edge, mode: null, open: isOpen(), target: e.target,
      w: drawer.getBoundingClientRect().width + 24,
    };
  }, { passive: false });

  document.addEventListener("touchmove", (e) => {
    if (!g) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    g.x = t.clientX;

    if (g.mode === null) {
      // 右向きの横スワイプは、方向が決まる前の最初の動きから既定動作（ブラウザの戻る）を止める
      if (!g.open && dx > 0 && Math.abs(dx) >= Math.abs(dy) && !sheetOpen()) e.preventDefault();
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      const horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
      const scroller = g.target.closest && g.target.closest("[data-noswipe]");
      const scrollerAtStart = !scroller || scroller.scrollLeft <= 1;
      if (horizontal && ((!g.open && dx > 0 && scrollerAtStart) || (g.open && dx < 0)) && !sheetOpen()) {
        g.mode = "drawer";
        body.classList.add("dragging");
      } else {
        g.mode = "none";
      }
    }

    if (g.mode === "drawer") {
      e.preventDefault();
      let p = g.open ? 1 + dx / g.w : dx / g.w;
      p = Math.max(0, Math.min(1, p));
      // 端まで引いたときのゴムのような抵抗
      const over = g.open ? 0 : Math.max(0, dx - g.w);
      drawer.style.transform = `translateX(${-(1 - p) * g.w + Math.sqrt(over) * 2}px)`;
      scrim.style.opacity = String(p);
      scrim.style.pointerEvents = "none";
      g.p = p;
    } else if (g.mode === "none" && g.edge && Math.abs(dx) > Math.abs(dy)) {
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("touchend", (e) => {
    if (!g) return;
    const gg = g;
    g = null;
    scrim.style.pointerEvents = "";

    if (gg.mode === "drawer") {
      body.classList.remove("dragging");
      const dt = Math.max(1, performance.now() - gg.t0);
      const v = (gg.x - gg.x0) / dt; // px/ms
      const shouldOpen = v > 0.35 ? true : v < -0.35 ? false : gg.p > 0.5;
      shouldOpen ? openDrawer() : closeDrawer();
      return;
    }

    // 端で止めたタッチがタップだった場合はクリックを補う
    if (gg.edge && gg.mode === null) {
      const t = e.changedTouches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY }));
    }
  }, { passive: true });

  document.addEventListener("touchcancel", () => {
    if (g && g.mode === "drawer") {
      body.classList.remove("dragging");
      g.open ? openDrawer() : closeDrawer();
    }
    scrim.style.pointerEvents = "";
    g = null;
  });

  // 履歴ガード：戻る操作が起きてもページを離れず、サイドバーの開閉に置き換える
  // ホーム画面アプリでは履歴が無ければスワイプで戻れないので、履歴を一切作らない
  // （ガード用の履歴を積むと、それ自体が「戻る」先になってしまう）
  const standalone = navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches;
  const GUARD = { gendaibunGuard: true };
  const armGuard = () => {
    if (standalone) return;
    if (!(history.state && history.state.gendaibunGuard)) history.pushState(GUARD, "");
  };
  history.replaceState({ gendaibunBase: true }, "");
  armGuard();
  window.addEventListener("popstate", () => {
    armGuard();
    if (sheetOpen()) closeSheet();
    else if (isOpen()) closeDrawer();
    else openDrawer();
  });
  // ユーザー操作があるたびにガードを確認（操作なしの pushState を無視するブラウザ対策）
  ["click", "touchend", "keydown"].forEach((ev) => document.addEventListener(ev, armGuard, { passive: true }));

  // デスクトップ用：Esc で閉じる
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (sheetOpen()) closeSheet();
    else if (isOpen()) closeDrawer();
  });

  // ---------- 起動 ----------
  go("home");

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
