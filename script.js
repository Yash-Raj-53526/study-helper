/* Study Helper: UI logic. Pure helpers live in helpers.js. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const store = {
    get(key, fallback = '') { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
  };
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const el = {
    sheet: $('#sheet'), drop: $('#drop'), preview: $('#preview'), clearBtn: $('#clearBtn'),
    fileInput: $('#fileInput'), cameraInput: $('#cameraInput'), generateBtn: $('#generateBtn'),
    generateLabel: $('#generateLabel'), empty: $('#empty'), results: $('#results'), errorBox: $('#errorBox'),
    settingsBtn: $('#settingsBtn'), settings: $('#settings'), settingsForm: $('#settingsForm'),
    apiKey: $('#apiKey'), toggleKey: $('#toggleKey'), modelSel: $('#modelSel'), cancelSettings: $('#cancelSettings'),
    toast: $('#toast'), status: $('#status'),
  };

  const state = { image: null, result: null, loading: false };
  let deck = null;
  let toastTimer = null;

  /* ---------- small utilities ---------- */
  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200);
  }

  function showError(message) {
    el.errorBox.textContent = message;
    el.errorBox.hidden = false;
  }
  function clearError() { el.errorBox.hidden = true; el.errorBox.textContent = ''; }

  function selected(name) { return $(`input[name="${name}"]:checked`).value; }

  /* ---------- settings ---------- */
  function openSettings() {
    el.apiKey.value = store.get('sh_api_key');
    el.modelSel.value = store.get('sh_model', 'gemma-4-26b-a4b-it');
    el.apiKey.type = 'password';
    el.toggleKey.textContent = 'Show';
    if (typeof el.settings.showModal === 'function') el.settings.showModal();
    else el.settings.setAttribute('open', '');
    setTimeout(() => el.apiKey.focus(), 50);
  }
  function closeSettings() {
    if (typeof el.settings.close === 'function') el.settings.close();
    else el.settings.removeAttribute('open');
  }

  el.settingsBtn.addEventListener('click', openSettings);
  el.cancelSettings.addEventListener('click', closeSettings);
  el.toggleKey.addEventListener('click', () => {
    const show = el.apiKey.type === 'password';
    el.apiKey.type = show ? 'text' : 'password';
    el.toggleKey.textContent = show ? 'Hide' : 'Show';
  });
  el.settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    store.set('sh_api_key', el.apiKey.value.trim());
    store.set('sh_model', el.modelSel.value);
    closeSettings();
    toast('Settings saved.');
  });
  el.settings.addEventListener('click', (event) => { if (event.target === el.settings) closeSettings(); });

  /* ---------- image handling ---------- */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  /* Shrink big phone photos so the request stays small and fast. */
  async function prepareImage(file) {
    const { img, url } = await loadImage(file);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    return { dataUrl, base64: dataUrl.split(',')[1], mime: 'image/jpeg' };
  }

  async function setImage(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please choose an image file.'); return; }
    try {
      state.image = await prepareImage(file);
    } catch {
      toast('Couldn’t read that image. Try a JPG or PNG.');
      return;
    }
    el.preview.src = state.image.dataUrl;
    el.preview.hidden = false;
    el.drop.hidden = true;
    el.clearBtn.hidden = false;
    el.sheet.classList.add('has-image');
    el.generateBtn.disabled = false;
    clearError();
  }

  function clearImage() {
    state.image = null;
    el.preview.hidden = true;
    el.preview.removeAttribute('src');
    el.drop.hidden = false;
    el.clearBtn.hidden = true;
    el.sheet.classList.remove('has-image');
    el.generateBtn.disabled = true;
    el.fileInput.value = '';
    el.cameraInput.value = '';
  }

  el.fileInput.addEventListener('change', () => setImage(el.fileInput.files[0]));
  el.cameraInput.addEventListener('change', () => setImage(el.cameraInput.files[0]));
  el.clearBtn.addEventListener('click', clearImage);

  ['dragenter', 'dragover'].forEach((type) => el.sheet.addEventListener(type, (e) => {
    e.preventDefault(); el.sheet.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((type) => el.sheet.addEventListener(type, (e) => {
    e.preventDefault(); el.sheet.classList.remove('dragover');
  }));
  el.sheet.addEventListener('drop', (e) => setImage(e.dataTransfer.files[0]));

  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) setImage(item.getAsFile());
  });

  /* ---------- Gemma 4 call ---------- */
  async function callGemma({ apiKey, model, image, prompt }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { inline_data: { mime_type: image.mime, data: image.base64 } },
            { text: prompt },
          ] }],
        }),
      });
    } catch {
      throw new Error('Couldn’t reach Google’s API. Check your internet connection and try again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const apiMessage = data?.error?.message || '';
      if (res.status === 429) throw new Error('You’ve hit the rate limit. Wait a minute and try again.');
      if (res.status === 400 && /api key/i.test(apiMessage)) throw new Error('Google rejected that API key. Check it in Settings.');
      if (res.status === 401 || res.status === 403) throw new Error('This API key can’t use that model. Check the key in Settings, or try the other model.');
      if (res.status === 404) throw new Error('That model isn’t available for your key. Pick the other model in Settings.');
      throw new Error(apiMessage || `The request failed (error ${res.status}).`);
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('\n');
    if (!text) throw new Error('The model sent back an empty reply. Try again.');
    return text;
  }

  async function generate() {
    if (state.loading || !state.image) return;
    const apiKey = store.get('sh_api_key');
    if (!apiKey) { openSettings(); toast('Add your Gemini API key to continue.'); return; }

    clearError();
    setLoading(true);
    const prompt = buildPrompt(selected('count'), selected('difficulty'));
    const model = store.get('sh_model', 'gemma-4-26b-a4b-it');

    try {
      let result = null;
      for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
        const text = await callGemma({ apiKey, model, image: state.image, prompt });
        try { result = normalizeResult(extractJson(text)); } catch { result = null; }
      }
      if (!result) throw new Error('The reply wasn’t in the format the app expects. Try again.');
      if (!result.summary && !result.questions.length) {
        showError('No readable study content found in that image. Try a clearer, well-lit photo.');
        return;
      }
      state.result = result;
      renderResults(result);
    } catch (err) {
      showError(err.message || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  function setLoading(on) {
    state.loading = on;
    el.generateBtn.classList.toggle('loading', on);
    el.generateBtn.disabled = on || !state.image;
    el.generateLabel.textContent = on ? 'Reading your page…' : 'Generate study material';
    el.sheet.classList.toggle('scanning', on);
    el.status.textContent = on ? 'Reading your page.' : 'Your study material is ready.';
  }

  el.generateBtn.addEventListener('click', generate);

  /* ---------- results ---------- */
  const chevron = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  function renderResults(r) {
    el.empty.hidden = true;
    el.results.hidden = false;
    el.results.classList.remove('play');

    const termsHtml = r.keyTerms.length ? `
      <h3>Key terms</h3>
      <ul class="glossary">
        ${r.keyTerms.map((t, i) => `
          <li data-i="${i}">
            <button class="term-btn" type="button" aria-expanded="false">${esc(t.term)}${chevron}</button>
            <div class="term-panel"><div><p>${esc(t.meaning)}</p></div></div>
          </li>`).join('')}
      </ul>` : '';

    el.results.innerHTML = `
      <header class="res-head">
        <h2>${esc(r.topic || 'Your summary')}</h2>
        <button class="btn ghost" id="copyBtn" type="button">Copy as text</button>
      </header>
      <p class="summary-text">${highlightTerms(r.summary, r.keyTerms)}</p>
      ${r.keyTerms.length ? '<p class="hint-line">Select a highlighted term to see what it means.</p>' : ''}
      ${termsHtml}
      ${r.questions.length ? '<h3>Practice questions</h3><div id="deck"></div>' : ''}
    `;

    // Restart the highlighter animation on every new result.
    void el.results.offsetWidth;
    el.results.classList.add('play');

    $('#copyBtn').addEventListener('click', copyText);
    $$('.term-btn', el.results).forEach((btn) => btn.addEventListener('click', () => toggleTerm(btn.closest('li'))));
    $('.summary-text', el.results).addEventListener('click', onMarkActivate);
    $('.summary-text', el.results).addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('mark.hl')) { e.preventDefault(); onMarkActivate(e); }
    });

    if (r.questions.length) startDeck(r.questions.map((_, i) => i));

    if (window.matchMedia('(max-width: 900px)').matches) {
      el.results.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function toggleTerm(li, forceOpen) {
    const open = forceOpen ?? !li.classList.contains('open');
    li.classList.toggle('open', open);
    $('.term-btn', li).setAttribute('aria-expanded', String(open));
  }

  function onMarkActivate(event) {
    const mark = event.target.closest('mark.hl');
    if (!mark) return;
    const li = $(`.glossary li[data-i="${mark.dataset.term}"]`, el.results);
    if (!li) return;
    toggleTerm(li, true);
    li.classList.remove('pulse');
    void li.offsetWidth;
    li.classList.add('pulse');
    li.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(resultToText(state.result));
      toast('Copied to your clipboard.');
    } catch {
      toast('Couldn’t copy. Select the text and copy it manually.');
    }
  }

  /* ---------- flashcards ---------- */
  function startDeck(order) {
    deck = { order, pos: 0, flipped: false, got: 0, missed: [], busy: false };
    buildDeckShell();
    fillCard();
  }

  function buildDeckShell() {
    const host = $('#deck');
    host.innerHTML = `
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${deck.order.length}" aria-valuenow="0"><div class="bar"></div></div>
      <p class="count" id="deckCount"></p>
      <button class="card" id="card" type="button" aria-label="Flashcard. Select to flip.">
        <span class="inner">
          <span class="face front"><span class="tag">Question</span><span class="text" id="qText"></span><span class="hint">Select the card to reveal the answer.</span></span>
          <span class="face back"><span class="tag">Answer</span><span class="text" id="aText"></span><span class="hint">How did you do?</span></span>
        </span>
      </button>
      <div class="grade">
        <button class="btn miss" id="missBtn" type="button" disabled>Review again</button>
        <button class="btn got" id="gotBtn" type="button" disabled>Got it</button>
      </div>`;
    $('#card').addEventListener('click', flipCard);
    $('#missBtn').addEventListener('click', () => gradeCard(false));
    $('#gotBtn').addEventListener('click', () => gradeCard(true));
  }

  function fillCard() {
    const q = state.result.questions[deck.order[deck.pos]];
    $('#qText').textContent = q.question;
    $('#aText').textContent = q.answer;
    $('#deckCount').textContent = `Question ${deck.pos + 1} of ${deck.order.length}`;
    const bar = $('.bar');
    bar.style.width = `${(deck.pos / deck.order.length) * 100}%`;
    $('.progress').setAttribute('aria-valuenow', String(deck.pos));
    $('#missBtn').disabled = true;
    $('#gotBtn').disabled = true;
  }

  function flipCard() {
    if (!deck || deck.busy) return;
    deck.flipped = !deck.flipped;
    $('#card').classList.toggle('flipped', deck.flipped);
    if (deck.flipped) { $('#missBtn').disabled = false; $('#gotBtn').disabled = false; }
  }

  function gradeCard(gotIt) {
    if (!deck || deck.busy || !deck.flipped) return;
    deck.busy = true;
    if (gotIt) deck.got += 1; else deck.missed.push(deck.order[deck.pos]);
    deck.pos += 1;
    $('#missBtn').disabled = true;
    $('#gotBtn').disabled = true;
    $('.bar').style.width = `${(deck.pos / deck.order.length) * 100}%`;

    const card = $('#card');
    card.classList.add('leaving');
    setTimeout(() => {
      if (deck.pos >= deck.order.length) { renderScore(); return; }
      card.classList.add('snap');
      card.classList.remove('leaving', 'flipped');
      card.classList.add('entering');
      deck.flipped = false;
      fillCard();
      void card.offsetWidth;
      card.classList.remove('snap');
      requestAnimationFrame(() => { card.classList.remove('entering'); deck.busy = false; });
    }, reducedMotion() ? 0 : 190);
  }

  function renderScore() {
    const total = deck.order.length;
    const ratio = deck.got / total;
    const circumference = 2 * Math.PI * 52;
    const message = ratio === 1 ? 'You got every question. Nice work.'
      : ratio >= 0.6 ? 'Solid. Go over the ones you missed.'
      : 'Worth another pass. Try the missed ones again.';
    const missedCount = deck.missed.length;

    $('#deck').innerHTML = `
      <div class="score">
        <svg class="ring" viewBox="0 0 132 132" role="img" aria-label="Score: ${deck.got} of ${total}">
          <circle class="track" cx="66" cy="66" r="52" fill="none" stroke-width="12"/>
          <circle class="value" cx="66" cy="66" r="52" fill="none" stroke-width="12"
            stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}" transform="rotate(-90 66 66)"/>
          <text x="66" y="66" text-anchor="middle" dominant-baseline="central">${deck.got}/${total}</text>
        </svg>
        <h4>${deck.got} of ${total} correct</h4>
        <p>${message}</p>
        <div class="row">
          ${missedCount ? `<button class="btn solid" id="reviewMissed" type="button">Review ${missedCount} missed</button>` : ''}
          <button class="btn ghost" id="restartDeck" type="button">Start over</button>
        </div>
      </div>`;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      $('.ring .value').style.strokeDashoffset = String(circumference * (1 - ratio));
    }));
    const missed = [...deck.missed];
    const all = state.result.questions.map((_, i) => i);
    const reviewBtn = $('#reviewMissed');
    if (reviewBtn) reviewBtn.addEventListener('click', () => startDeck(missed));
    $('#restartDeck').addEventListener('click', () => startDeck(all));
  }

  /* ---------- init ---------- */
  if (!store.get('sh_api_key')) {
    // First visit: nudge once, without blocking the page.
    setTimeout(() => toast('Tip: add your Gemini API key in Settings before you generate.'), 900);
  }
})();
