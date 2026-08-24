(() => {
  'use strict';

  const STORAGE_KEY = 'phrases_v1';
  const TODAY_KEY = 'todayPhrase_v1';

  /* ---------- Elements ---------- */
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const previewThumbs = document.getElementById('previewThumbs');
  const ocrProgress = document.getElementById('ocrProgress');
  const ocrBarFill = document.getElementById('ocrBarFill');
  const ocrStatus = document.getElementById('ocrStatus');
  const reviewBox = document.getElementById('reviewBox');
  const ocrTextarea = document.getElementById('ocrTextarea');
  const cancelReviewBtn = document.getElementById('cancelReviewBtn');
  const saveReviewBtn = document.getElementById('saveReviewBtn');

  const todayContent = document.getElementById('todayContent');

  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');

  const phraseListEl = document.getElementById('phraseList');
  const emptyState = document.getElementById('emptyState');
  const countBadge = document.getElementById('countBadge');

  const toastEl = document.getElementById('toast');
  const installBtn = document.getElementById('installBtn');

  /* ---------- Storage helpers ---------- */
  function loadPhrases() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to load phrases', e);
      return [];
    }
  }

  function savePhrases(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  let phrases = loadPhrases();

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  /* ---------- Text-to-speech (US native voice) ---------- */
  let cachedVoice = null;
  function pickUSVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    const preferred = [
      v => /en-US/i.test(v.lang) && /Google US English/i.test(v.name),
      v => /en-US/i.test(v.lang) && /Samantha|Alex|Ava|Nathan/i.test(v.name),
      v => /en-US/i.test(v.lang),
      v => /^en(-|_)?/i.test(v.lang),
    ];
    for (const test of preferred) {
      const found = voices.find(test);
      if (found) return found;
    }
    return voices[0];
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      cachedVoice = pickUSVoice();
    };
    cachedVoice = pickUSVoice();
  }

  function speak(text, btnEl) {
    if (!('speechSynthesis' in window)) {
      showToast('이 브라우저는 음성 재생을 지원하지 않아요');
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const voice = cachedVoice || pickUSVoice();
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = 'en-US';
    }
    utter.rate = 0.95;
    utter.pitch = 1;

    document.querySelectorAll('.speak-btn.playing, .mini-speak.playing')
      .forEach(el => el.classList.remove('playing'));

    if (btnEl) btnEl.classList.add('playing');
    utter.onend = () => { if (btnEl) btnEl.classList.remove('playing'); };
    utter.onerror = () => { if (btnEl) btnEl.classList.remove('playing'); };
    window.speechSynthesis.speak(utter);
  }

  /* ---------- Today's phrase ---------- */
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function getTodayPhrase({ forceReroll = false } = {}) {
    if (!phrases.length) return null;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(TODAY_KEY) || 'null'); } catch (e) {}

    if (!forceReroll && saved && saved.date === todayStr()) {
      const existing = phrases.find(p => p.id === saved.id);
      if (existing) return existing;
    }
    const pick = phrases[Math.floor(Math.random() * phrases.length)];
    localStorage.setItem(TODAY_KEY, JSON.stringify({ date: todayStr(), id: pick.id }));
    return pick;
  }

  function renderToday({ forceReroll = false } = {}) {
    const phrase = getTodayPhrase({ forceReroll });
    if (!phrase) {
      todayContent.innerHTML = `<p class="today-empty">사진을 업로드하면 오늘의 표현이 추천돼요. 아래에서 표현이 담긴 사진을 올려보세요 📸</p>`;
      return;
    }
    const expr = extractField(phrase.content, 'Expression');
    const meaning = extractField(phrase.content, 'Meaning');
    const example = extractField(phrase.content, 'Example');
    todayContent.innerHTML = `
      <div class="expr-row">
        <div class="expr">${escapeHtml(expr)}</div>
        <button class="speak-btn" id="todaySpeakBtn" aria-label="발음 듣기">🔊</button>
      </div>
      ${meaning ? `<div class="meaning">${escapeHtml(meaning)}</div>` : ''}
      ${example ? `<div class="example">"${escapeHtml(example)}"</div>` : ''}
      <div class="refresh-row">
        <button class="today-refresh" id="todayRefreshBtn">🔀 다른 표현 보기</button>
      </div>
    `;
    document.getElementById('todaySpeakBtn').addEventListener('click', (e) => {
      speak(expr, e.currentTarget);
    });
    document.getElementById('todayRefreshBtn').addEventListener('click', () => {
      renderToday({ forceReroll: true });
    });
  }

  /* ---------- List rendering ---------- */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Phrases are stored as one combined "content" field
  // ("Expression: ...\nMeaning: ...\nExample: ...") rather than separate
  // columns; this pulls a single labeled line back out for display/TTS.
  function extractField(content, label) {
    const re = new RegExp('^' + label + ':\\s*(.*)$', 'im');
    const m = (content || '').match(re);
    return m ? m[1].trim() : '';
  }

  function renderList() {
    const query = searchInput.value.trim().toLowerCase();
    let list = phrases.slice().sort((a, b) => b.createdAt - a.createdAt);

    if (query) {
      list = list.filter(p => (p.content || '').toLowerCase().includes(query));
    }

    countBadge.textContent = `${phrases.length}개`;

    if (!list.length) {
      phraseListEl.innerHTML = '';
      emptyState.style.display = 'block';
      emptyState.querySelector('.txt').innerHTML = query
        ? `'${escapeHtml(searchInput.value.trim())}'에 대한 검색 결과가 없어요.`
        : '아직 저장된 표현이 없어요.<br>사진을 업로드해서 첫 표현을 추가해보세요.';
      return;
    }
    emptyState.style.display = 'none';

    phraseListEl.innerHTML = list.map(p => {
      const expr = extractField(p.content, 'Expression');
      const meaning = extractField(p.content, 'Meaning');
      const example = extractField(p.content, 'Example');
      return `
      <div class="phrase-card" data-id="${p.id}">
        <div class="top-row">
          <div class="expr">${escapeHtml(expr)}</div>
          <button class="mini-speak" aria-label="발음 듣기" data-action="speak">🔊</button>
        </div>
        ${meaning ? `<div class="meaning">${escapeHtml(meaning)}</div>` : ''}
        ${example ? `<div class="example">"${escapeHtml(example)}"</div>` : ''}
        <div class="bottom-row">
          <span class="src-tag">${p.source ? '📷 사진에서 추가됨' : ''}</span>
          <button class="del-btn" data-action="delete">삭제</button>
        </div>
      </div>
    `;
    }).join('');
  }

  phraseListEl.addEventListener('click', (e) => {
    const card = e.target.closest('.phrase-card');
    if (!card) return;
    const id = card.dataset.id;
    const phrase = phrases.find(p => p.id === id);
    if (!phrase) return;
    const expr = extractField(phrase.content, 'Expression');

    if (e.target.closest('[data-action="speak"]')) {
      speak(expr, e.target.closest('[data-action="speak"]'));
    } else if (e.target.closest('[data-action="delete"]')) {
      if (confirm(`'${expr}' 표현을 삭제할까요?`)) {
        phrases = phrases.filter(p => p.id !== id);
        savePhrases(phrases);
        renderList();
        renderToday();
        showToast('삭제했어요');
      }
    }
  });

  /* ---------- Search ---------- */
  searchInput.addEventListener('input', () => {
    searchClear.classList.toggle('show', !!searchInput.value);
    renderList();
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.remove('show');
    renderList();
    searchInput.focus();
  });

  /* ---------- OCR text labeling ---------- */
  // Every source photo has the same 3-line layout: line 1 is the
  // expression, line 2 is the meaning, line 3 (and anything after, in case
  // the example wraps) is the example. Label them positionally right after
  // extraction so the review textarea already shows Expression:/Meaning:/
  // Example: — no word/symbol-based guessing needed.
  function labelExtractedText(rawText) {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return '';
    const expr = lines[0] || '';
    const meaning = lines[1] || '';
    const example = lines.slice(2).join(' ');
    return [
      `Expression: ${expr}`,
      `Meaning: ${meaning}`,
      `Example: ${example}`,
    ].join('\n');
  }

  /* ---------- Upload + OCR flow ---------- */
  let pendingFiles = [];

  dropZone.addEventListener('click', (e) => {
    // label already triggers input via 'for', avoid double-trigger on some browsers
  });

  fileInput.addEventListener('change', () => {
    handleFiles(Array.from(fileInput.files || []));
  });

  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
  });
  dropZone.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) handleFiles(files);
  });

  function handleFiles(files) {
    const images = files.filter(f => f.type.startsWith('image/'));
    if (!images.length) return;
    pendingFiles = images;

    previewThumbs.innerHTML = '';
    images.forEach(file => {
      const url = URL.createObjectURL(file);
      const img = document.createElement('img');
      img.src = url;
      previewThumbs.appendChild(img);
    });

    runOcr(images);
  }

  async function runOcr(images) {
    if (typeof Tesseract === 'undefined') {
      showToast('텍스트 인식 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인해주세요.');
      return;
    }
    ocrProgress.classList.add('show');
    reviewBox.classList.remove('show');
    ocrBarFill.style.width = '0%';
    ocrStatus.textContent = '텍스트 인식 준비 중…';

    let combinedText = '';

    try {
      for (let i = 0; i < images.length; i++) {
        const file = images[i];
        ocrStatus.textContent = `사진 ${i + 1}/${images.length} 인식 중…`;

        const { data } = await Tesseract.recognize(file, 'eng+kor', {
          logger: (m) => {
            if (m.status && typeof m.progress === 'number') {
              const pct = Math.round(m.progress * 100);
              ocrBarFill.style.width = pct + '%';
              const statusMap = {
                'loading tesseract core': '엔진 불러오는 중',
                'initializing tesseract': '초기화 중',
                'loading language traineddata': '언어 데이터 불러오는 중',
                'initializing api': '준비 중',
                'recognizing text': '글자 인식 중',
              };
              const label = statusMap[m.status] || m.status;
              ocrStatus.textContent = `사진 ${i + 1}/${images.length} · ${label} (${pct}%)`;
            }
          },
        });

        combinedText += (combinedText ? '\n\n' : '') + labelExtractedText(data.text || '');
      }

      ocrStatus.textContent = '인식 완료!';
      ocrBarFill.style.width = '100%';

      setTimeout(() => {
        ocrProgress.classList.remove('show');
        ocrTextarea.value = combinedText.trim();
        reviewBox.classList.add('show');
        reviewBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 400);
    } catch (err) {
      console.error(err);
      ocrProgress.classList.remove('show');
      showToast('텍스트 인식 중 문제가 발생했어요. 다시 시도해주세요.');
    }
  }

  cancelReviewBtn.addEventListener('click', () => {
    reviewBox.classList.remove('show');
    ocrTextarea.value = '';
    previewThumbs.innerHTML = '';
    fileInput.value = '';
    pendingFiles = [];
  });

  saveReviewBtn.addEventListener('click', () => {
    const text = ocrTextarea.value.trim();
    if (!text) {
      showToast('저장할 텍스트가 없어요');
      return;
    }
    // Whatever is in the (possibly hand-edited) textarea is saved as-is,
    // as a single phrase entry — it's never split back apart.
    const phrase = {
      id: uid(),
      content: text,
      source: pendingFiles.length ? `사진 ${pendingFiles.length}장` : '',
      createdAt: Date.now(),
    };
    phrases = phrases.concat([phrase]);
    savePhrases(phrases);
    renderList();
    renderToday();

    reviewBox.classList.remove('show');
    ocrTextarea.value = '';
    previewThumbs.innerHTML = '';
    fileInput.value = '';
    pendingFiles = [];

    showToast('표현을 저장했어요');
  });

  /* ---------- PWA install prompt ---------- */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.classList.add('show');
  });
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.remove('show');
  });
  window.addEventListener('appinstalled', () => {
    installBtn.classList.remove('show');
    showToast('홈 화면에 설치되었어요!');
  });

  /* ---------- Service worker ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => {
        console.error('Service worker registration failed:', err);
      });
    });
  }

  /* ---------- Init ---------- */
  renderToday();
  renderList();
})();
