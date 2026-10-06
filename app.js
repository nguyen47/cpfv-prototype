/* Attachment 7-B · interactive prototype shell.
 * Data: window.SCREENS / SCREEN_META / SCREEN_ORDER (dist/screens.js, generated)
 *       window.FLOWS / FLOW_META (content/flows.js, hand-written)
 * No build step for the shell itself; works from file:// and from any static server.
 */
(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };

  const SCREENS = window.SCREENS || {};
  const META = window.SCREEN_META || {};
  const NOTES = window.SCREEN_NOTES || {};   // title + note per screen, from the design file
  const FLOWS = window.FLOWS || [];
  const FLOW_META = window.FLOW_META || {};
  const BEZEL = 10; // phone frame draws a 10px bezel via box-shadow
  const narrowMq = window.matchMedia('(max-width: 1024px)'); // phones and small tablets: drawers, one frame, fit to width
  const isNarrow = () => narrowMq.matches;

  // ---------- indexes ----------
  const steps = []; // flat list with flow pointers
  FLOWS.forEach((f, fi) => f.steps.forEach((s, si) => {
    s.flow = f; s.fi = fi; s.si = si; s.index = steps.length;
    s.primary = s.focus || (s.app && !s.portal ? 'app' : s.portal && !s.app ? 'portal' : 'portal');
    s.primaryId = s[s.primary];
    steps.push(s);
  }));
  const stepByScreen = {}; // first step whose primary is this screen; else any step containing it
  steps.forEach(s => { if (s.primaryId && !stepByScreen[s.primaryId]) stepByScreen[s.primaryId] = s; });
  steps.forEach(s => ['app', 'portal'].forEach(k => { if (s[k] && !stepByScreen[s[k]]) stepByScreen[s[k]] = s; }));
  const titleByScreen = {};
  steps.forEach(s => ['app', 'portal'].forEach(k => { if (s[k] && !titleByScreen[s[k]]) titleByScreen[s[k]] = s.title; }));
  Object.entries(NOTES).forEach(([id, n]) => { if (n.title) titleByScreen[id] = n.title; }); // the design file's own names win

  // ---------- state ----------
  const state = {
    step: steps[0],
    explore: null,       // { app?: id, portal?: id, primary } when the user tapped away from the step
    layout: null,        // 'app' | 'portal' | 'both' override for the current step
    history: [],         // stack of {app, portal} views for data-go="back"
    taps: false,
    tour: false,
    tourTimer: null,
    tourStart: 0,
  };
  const TOUR_MS = 7000;

  // ---------- current view ----------
  function currentView() {
    if (state.explore) return state.explore;
    const s = state.step;
    return { app: s.app, portal: s.portal, primary: s.primary };
  }
  function effectiveLayout(view) {
    if (view.app && view.portal) return state.layout || (isNarrow() ? view.primary : 'both');
    return view.app ? 'app' : 'portal';
  }

  // ---------- rendering: rail ----------
  const railEl = $('#rail');
  function renderRail() {
    railEl.innerHTML = '';
    railEl.append(h('div', { class: 'rail-head' }, 'FLOWS · ' + steps.length + ' STEPS'));
    FLOWS.forEach(f => {
      const open = f === state.step.flow;
      const done = open ? state.step.si + 1 : 0;
      const kinds = f.steps;
      const flowEl = h('div', { class: 'flow' + (open ? ' open' : '') },
        h('button', { class: 'flow-head', onclick: () => goStep(f.steps[0]) },
          h('span', { class: 'flow-sn' }, f.sn),
          h('span', {}, h('div', { class: 'flow-title' }, f.title), h('div', { class: 'flow-meta' }, f.phase)),
          h('span', { class: 'flow-count' }, open ? `${done}/${kinds.length}` : String(kinds.length))),
        open ? h('div', { class: 'flow-progress' }, h('i', { style: `width:${(done / kinds.length) * 100}%` })) : null,
        open ? h('ol', { class: 'steps' }, f.steps.map(s => h('li', {},
          h('button', { class: 'step' + (s === state.step && !state.explore ? ' active' : ''), onclick: () => goStep(s), 'data-step': s.index },
            h('span', { class: 'step-n' }, String(s.si + 1)),
            h('span', {}, s.title),
            h('span', { class: 'step-kind' + (s.app && s.portal ? ' both' : '') }, s.app && s.portal ? 'both' : s.app ? 'app' : 'portal'))))) : null,
      );
      railEl.append(flowEl);
    });
    const active = $('.step.active', railEl);
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  // ---------- rendering: stage ----------
  const stageBody = $('#stage-body');
  const stageTitle = $('#stage-title');
  const stageTools = $('#stage-tools');
  const crumb = $('#crumb');

  function buildFrame(id, role, scale, isPrimary, caption) {
    const meta = META[id];
    const [w, hgt] = meta.size;
    const pad = meta.kind === 'app' ? BEZEL : 0;
    const vw = (w + pad * 2) * scale, vh = (hgt + pad * 2) * scale;
    const screen = h('div', { class: 'frame-screen enter', 'data-screen': id, html: SCREENS[id] });
    screen.style.cssText = `width:${w}px;height:${hgt}px;margin:${pad}px;`;
    const pins = h('div', { class: 'pins ' + meta.kind });
    const scaler = h('div', { class: 'frame-scaler' }, screen, pins);
    scaler.style.transform = `scale(${scale})`;
    const viewport = h('div', { class: 'frame-viewport' }, scaler);
    viewport.style.cssText = `width:${vw}px;height:${vh}px;`;
    const cap = h('div', { class: 'frame-cap' },
      h('span', { class: 'k ' + meta.kind }, meta.kind.toUpperCase()),
      h('span', { class: 'id' }, id),
      h('span', { class: 'cap' }, caption || titleByScreen[id] || ''),
      !isPrimary ? h('span', { class: 'link' }, '· linked') : null,
      !isPrimary ? h('button', { class: 'enlarge', title: 'Show only this screen', onclick: e => { e.stopPropagation(); state.layout = meta.kind; renderStage(); } }, 'Enlarge') : null,
      meta.truncated ? h('span', { title: 'The source file was cut off here; the lower half of this screen was reconstructed.' }, '· partly reconstructed') : null);
    const frame = h('div', { class: 'frame ' + role + (isPrimary ? ' primary' : ' secondary') }, viewport, cap);
    frame.dataset.kind = meta.kind;
    frame.dataset.screen = id;
    return frame;
  }

  function fitScales(view, layout) {
    const rect = stageBody.getBoundingClientRect();
    const narrow = isNarrow();
    const W = Math.max(280, rect.width - (narrow ? 20 : 32)), H = Math.max(240, rect.height - 56); // caption room
    const app = [393 + BEZEL * 2, 852 + BEZEL * 2], por = [1440, 900];
    const fit = (d, w, hh) => narrow ? Math.min(w / d[0], 1) : Math.min(hh / d[1], w / d[0], 1); // phones: fill the width, scroll if tall
    if (layout === 'app') return { mode: 'single', app: fit(app, W, H) };
    if (layout === 'portal') return { mode: 'single', portal: fit(por, W, H) };
    if (W >= 1200) {
      // wide stage: side by side, portal takes what is left after a readable phone
      const sApp = Math.min(H / app[1], view.primary === 'app' ? 0.8 : 0.62);
      const sPor = Math.min(H / por[1], (W - 24 - app[0] * sApp) / por[0]);
      return { mode: 'side', app: Math.max(0.3, sApp), portal: Math.max(0.3, sPor) };
    }
    // narrow stage: the primary screen fills the stage, the linked one floats bottom-right (picture-in-picture)
    if (view.primary === 'app') return { mode: 'pip', app: fit(app, W, H), portal: Math.min(0.27, (W * 0.44) / por[0]) };
    return { mode: 'pip', portal: fit(por, W, H), app: Math.min(0.4, (H * 0.5) / app[1]) };
  }

  function renderStage() {
    const view = currentView();
    const layout = effectiveLayout(view);
    const scales = fitScales(view, layout);
    stageBody.innerHTML = '';
    const s = state.step;
    const captions = {};
    if (!state.explore) { if (s.app) captions[s.app] = s.title; if (s.portal) captions[s.portal] = s.title; }

    if (layout === 'both') {
      const pk = view.primary === 'app' ? 'app' : 'portal', sk = pk === 'app' ? 'portal' : 'app';
      const pf = buildFrame(view[pk], pk, scales[pk], true, captions[view[pk]]);
      const sf = buildFrame(view[sk], sk, scales[sk], false, captions[view[sk]]);
      if (scales.mode === 'pip') { sf.classList.add('pip'); stageBody.append(pf, sf); }
      else stageBody.append(pk === 'portal' ? pf : sf, pk === 'portal' ? sf : pf); // portal left, phone right
    } else {
      const id = layout === 'app' ? view.app : view.portal;
      stageBody.append(buildFrame(id, layout, scales[layout], true, captions[id]));
    }
    document.body.classList.toggle('show-taps', state.taps);
    requestAnimationFrame(placePins);
    if (isNarrow() && layout !== 'app' && !state.hintedPortal) { state.hintedPortal = true; toast('Desktop screen: pinch to zoom, or turn your phone sideways'); }

    // head
    stageTitle.innerHTML = '';
    const f = s.flow;
    if (state.explore) {
      const ids = [view.portal, view.app].filter(Boolean);
      stageTitle.append(h('div', { class: 't' }, ids.map(i => titleByScreen[i] || i).join(' · ')),
        h('div', { class: 's' }, h('span', { class: 'explore' }, 'Exploring'), h('span', {}, ids.join(' + ')), h('span', {}, '· from step ' + (s.si + 1) + ' of ' + f.steps.length)));
    } else {
      stageTitle.append(h('div', { class: 't' }, s.title),
        h('div', { class: 's' }, h('span', {}, `${f.sn} · ${f.title}`), h('span', {}, `· Step ${s.si + 1} of ${f.steps.length}`),
          s.app && s.portal ? h('span', {}, '· Portal and app linked') : null));
    }
    stageTools.innerHTML = '';
    if (view.app && view.portal) {
      const seg = h('div', { class: 'seg' });
      [['portal', 'Portal'], ['both', 'Both'], ['app', 'App']].forEach(([k, label]) => {
        seg.append(h('button', { class: layout === k ? 'on' : '', onclick: () => { state.layout = k; renderStage(); } }, label));
      });
      stageTools.append(seg);
    }
    $('#btn-prev').disabled = s.index === 0 && !state.explore;
    $('#btn-next').disabled = s.index === steps.length - 1;

    crumb.innerHTML = '';
    crumb.append(h('span', { class: 'sn' }, f.sn), h('span', {}, f.title), h('span', { class: 'sep' }, '·'), h('span', {}, `${s.si + 1} / ${f.steps.length}`));
  }

  // ---------- pins ----------
  function findByText(root, needle) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue.includes(needle) && n.parentElement && !n.parentElement.closest('.pins')) return n.parentElement;
    }
    return null;
  }
  function placePins() {
    document.querySelectorAll('.pin-target').forEach(el => el.classList.remove('pin-target'));
    if (state.explore) { renderNotes(); return; }
    const s = state.step;
    const pins = s.pins || [];
    const view = currentView();
    pins.forEach((p, i) => {
      const kind = p.in || (view.primary && view[view.primary] ? view.primary : (s.app ? 'app' : 'portal'));
      const frame = stageBody.querySelector(`.frame[data-kind="${kind}"]`);
      p._el = null;
      if (!frame) return;
      const screen = frame.querySelector('.frame-screen');
      const layer = frame.querySelector('.pins');
      const target = findByText(screen, p.match);
      if (!target) return;
      const scale = parseFloat(frame.querySelector('.frame-scaler').style.transform.replace(/[^\d.]/g, '')) || 1;
      const sr = screen.getBoundingClientRect(), tr = target.getBoundingClientRect();
      const pad = META[screen.dataset.screen].kind === 'app' ? BEZEL : 0;
      const x = (tr.left - sr.left) / scale + pad;
      const y = (tr.top - sr.top) / scale + pad;
      const pin = h('div', { class: 'pin', 'data-pin': i, title: p.text }, String(i + 1));
      pin.style.left = x + 'px'; pin.style.top = y + 'px';
      pin.addEventListener('mouseenter', () => hotPin(i, true));
      pin.addEventListener('mouseleave', () => hotPin(i, false));
      layer.append(pin);
      p._el = target;
    });
    renderNotes();
  }
  function hotPin(i, on) {
    const s = state.step; const p = (s.pins || [])[i]; if (!p) return;
    document.querySelectorAll(`.pin[data-pin="${i}"]`).forEach(el => el.classList.toggle('hot', on));
    document.querySelectorAll(`.pins-list li[data-pin="${i}"]`).forEach(el => el.classList.toggle('hot', on));
    if (p._el) p._el.classList.toggle('pin-target', on);
  }

  // ---------- notes ----------
  const notesEl = $('#notes');
  function renderNotes() {
    const s = state.step, f = s.flow;
    notesEl.innerHTML = '';
    if (state.explore) {
      const view = state.explore;
      const ids = [view.portal, view.app].filter(Boolean);
      notesEl.append(
        h('div', { class: 'sn-row' }, h('span', { class: 'sn' }, 'EXPLORING'), h('span', { class: 'phase' }, ids.join(' + '))),
        h('h2', {}, ids.map(i => titleByScreen[i] || i).join(' · ')),
        h('div', { class: 'explore-box' }, 'You tapped away from the scripted walkthrough. Keep tapping to explore, or jump back.',
          h('div', {}, h('button', { onclick: () => goStep(s) }, `Back to step ${s.si + 1}: ${s.title}`))),
      );
      ids.forEach(id => { if (NOTES[id] && NOTES[id].note) notesEl.append(h('div', { class: 'lbl' }, `${(NOTES[id].sn || '').toUpperCase()} · SCREEN ${id}`), h('p', {}, NOTES[id].note)); });
      const home = stepByScreen[ids[0]];
      if (home && home !== s) notesEl.append(h('p', {}, 'This screen is step ', String(home.si + 1), ' of ', home.flow.sn, ' · ', home.flow.title, '. ',
        h('a', { href: '#', onclick: e => { e.preventDefault(); goStep(home); } }, 'Open its notes')));
      notesEl.append(h('div', { class: 'lbl' }, 'TIP'), h('p', {}, 'Press T to outline everything tappable on the current screen.'));
      return;
    }
    notesEl.append(
      h('div', { class: 'sn-row' }, h('span', { class: 'sn' }, f.sn), h('span', { class: 'phase' }, f.phase), s.actor ? h('span', { class: 'actor' }, s.actor) : null),
      h('h2', {}, s.title),
      h('div', { class: 'ids' }, [s.portal, s.app].filter(Boolean).join(' · ')),
      h('p', {}, s.note || ''),
    );
    if (s.pins && s.pins.length) {
      notesEl.append(h('div', { class: 'lbl' }, 'ON THIS SCREEN'));
      notesEl.append(h('ol', { class: 'pins-list' }, s.pins.map((p, i) => h('li', {
        'data-pin': i, class: p._el ? '' : 'missing', title: p._el ? '' : 'Text not found on the current frame',
        onmouseenter: () => hotPin(i, true), onmouseleave: () => hotPin(i, false),
      }, h('span', { class: 'n' }, String(i + 1)), h('span', {}, h('b', { style: 'font-weight:500;color:var(--ink)' }, p.match), ' — ', p.text)))));
    }
    const designNotes = [s.portal, s.app].filter(id => id && NOTES[id] && NOTES[id].note);
    if (designNotes.length) {
      notesEl.append(h('div', { class: 'lbl' }, 'DESIGN NOTE' + (designNotes.length > 1 ? 'S' : '')));
      designNotes.forEach(id => notesEl.append(h('p', { class: 'design-note' }, designNotes.length > 1 ? h('b', { style: 'font-weight:500' }, id + ' · ') : null, NOTES[id].note)));
    }
    if (s.tryIt) notesEl.append(h('div', { class: 'lbl' }, 'TRY IT'), h('div', { class: 'try' }, h('b', {}, '→ '), s.tryIt));
    if (s.ref) notesEl.append(h('div', { class: 'ref' }, 'Proposal reference: ' + s.ref));
    const shown = h('div', { class: 'shown' });
    if (s.portal) shown.append(h('span', {}, h('span', { class: 'k portal' }, 'PORTAL'), `${s.portal} · ${titleByScreen[s.portal] || ''}`));
    if (s.app) shown.append(h('span', {}, h('span', { class: 'k' }, 'APP'), `${s.app} · ${titleByScreen[s.app] || ''}`));
    notesEl.append(h('div', { class: 'lbl' }, 'SHOWN'), shown);
    const det = h('details', { open: s.si === 0 ? '' : false }, h('summary', {}, `About ${f.sn} · ${f.title}`), h('p', { style: 'margin-top:8px' }, f.intro || ''));
    if (f.rules && f.rules.length) det.append(h('div', { class: 'lbl' }, 'RULES SHOWN IN THIS FLOW'), h('ul', {}, f.rules.map(r => h('li', {}, r))));
    notesEl.append(det);
  }

  // ---------- navigation ----------
  function setHash(id) { try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// quirks */ } }

  function goStep(s, opts = {}) {
    if (!s) return;
    const changedFlow = s.flow !== state.step.flow;
    state.step = s; state.explore = null; state.layout = null; state.history = [];
    closeDrawers();
    renderRail(); renderStage(); setHash(s.primaryId);
    if (!opts.keepTour && state.tour) restartTour();
    if (changedFlow) toast(`${s.flow.sn} · ${s.flow.title}`);
  }
  function next() { if (state.explore) return goStep(state.step); goStep(steps[Math.min(steps.length - 1, state.step.index + 1)]); }
  function prev() { if (state.explore) return goStep(state.step); goStep(steps[Math.max(0, state.step.index - 1)]); }

  function showScreen(id, fromKind) {
    // tapped a hotspot: if the target is a step's primary screen inside the current flow, move the walkthrough there.
    const target = META[id] ? id : null;
    if (!target) return toast('Unknown screen ' + id);
    const step = stepByScreen[target];
    if (step && step.flow === state.step.flow && step.primaryId === target && !(step === state.step)) return goStep(step);
    // otherwise: explore (a screen from another flow, or a secondary screen of a step)
    const cur = currentView();
    state.history.push({ app: cur.app, portal: cur.portal, primary: cur.primary, explore: !!state.explore });
    const kind = META[target].kind;
    const view = { app: cur.app, portal: cur.portal, primary: kind };
    view[kind] = target;
    // single-frame step: switch frame kind rather than pairing with a stale screen
    if (!(cur.app && cur.portal)) { view.app = kind === 'app' ? target : undefined; view.portal = kind === 'portal' ? target : undefined; }
    state.explore = view;
    renderRail(); renderStage(); setHash(target);
  }
  // cause → effect: move this surface to `go` (if any) and the other surface to `link`, show both
  function showLinked(go, link, fromKind, msg) {
    if (!META[link]) return toast('Unknown screen ' + link);
    const cur = currentView();
    state.history.push({ app: cur.app, portal: cur.portal, primary: cur.primary, explore: !!state.explore });
    const view = { app: cur.app, portal: cur.portal };
    if (go && META[go]) view[META[go].kind] = go;
    view[META[link].kind] = link;
    if (!view.app || !view.portal) { const k = META[link].kind; view[k] = link; }
    view.primary = META[link].kind; // the effect is what the viewer should see large
    state.explore = view; state.layout = null;
    renderRail(); renderStage(); setHash(link);
    if (msg) toast(msg);
  }
  function back() {
    const prevView = state.history.pop();
    if (!prevView) { if (state.explore) return goStep(state.step); return prev(); }
    if (!prevView.explore) return goStep(state.step);
    state.explore = { app: prevView.app, portal: prevView.portal, primary: prevView.primary };
    renderRail(); renderStage();
  }

  stageBody.addEventListener('click', e => {
    const el = e.target.closest('[data-go]');
    if (!el || !stageBody.contains(el)) return;
    e.preventDefault();
    const go = el.getAttribute('data-go'), link = el.getAttribute('data-go-link'), msg = el.getAttribute('data-go-toast');
    el.classList.remove('tap-flash'); void el.offsetWidth; el.classList.add('tap-flash');
    if (state.tour) stopTour();
    if (go.startsWith('none:')) return toast(go.slice(5));
    if (go === 'back') return back();
    if (go === 'home') return showScreen('23-01');
    const frame = el.closest('.frame');
    if (link) return showLinked(go === 'link' ? null : go, link, frame ? frame.dataset.kind : null, msg);
    if (go === 'link') return;
    if (msg) toast(msg);
    showScreen(go, frame ? frame.dataset.kind : null);
  });

  // ---------- toast ----------
  const toastEl = $('#toast'); let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  // ---------- tour ----------
  const tourBtn = $('#btn-tour'), tourFill = $('#tour-fill');
  function tick() {
    const p = Math.min(1, (Date.now() - state.tourStart) / TOUR_MS);
    tourFill.style.width = (p * 100) + '%';
    if (p >= 1) {
      if (state.step.index >= steps.length - 1) return stopTour();
      goStep(steps[state.step.index + 1], { keepTour: true }); state.tourStart = Date.now();
    }
    state.tourTimer = requestAnimationFrame(tick);
  }
  function startTour() { state.tour = true; tourBtn.classList.add('on'); state.tourStart = Date.now(); cancelAnimationFrame(state.tourTimer); state.tourTimer = requestAnimationFrame(tick); toast('Tour: advances every 7 s. Click anything to stop.'); }
  function stopTour() { state.tour = false; tourBtn.classList.remove('on'); cancelAnimationFrame(state.tourTimer); tourFill.style.width = '0'; }
  function restartTour() { state.tourStart = Date.now(); }
  tourBtn.addEventListener('click', () => state.tour ? stopTour() : startTour());

  // ---------- tappable areas ----------
  const tapsBtn = $('#btn-taps');
  function setTaps(on) { state.taps = on; tapsBtn.classList.toggle('on', on); document.body.classList.toggle('show-taps', on); }
  tapsBtn.addEventListener('click', () => setTaps(!state.taps));

  // ---------- overlay: flow map and help ----------
  const overlay = $('#overlay'), overlayBody = $('#overlay-body'), overlayTitle = $('#overlay-title');
  function openOverlay(title, node) { overlayTitle.textContent = title; overlayBody.innerHTML = ''; overlayBody.append(node); overlay.hidden = false; if (state.tour) stopTour(); }
  function closeOverlay() { overlay.hidden = true; }
  $('#overlay-close').addEventListener('click', closeOverlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });

  function thumb(id, scale) {
    const meta = META[id]; const [w, hgt] = meta.size; const pad = meta.kind === 'app' ? BEZEL : 0;
    const screen = h('div', { class: 'frame-screen', html: SCREENS[id] });
    screen.style.cssText = `width:${w}px;height:${hgt}px;margin:${pad}px;`;
    const scaler = h('div', { class: 'frame-scaler' }, screen); scaler.style.transform = `scale(${scale})`;
    const t = h('div', { class: 'thumb' }, scaler);
    t.style.cssText = `width:${(w + pad * 2) * scale}px;height:${(hgt + pad * 2) * scale}px;`;
    return t;
  }
  function renderMap() {
    const wrap = h('div', {});
    FLOWS.forEach(f => {
      const row = h('div', { class: 'map-row' });
      f.steps.forEach((s, i) => {
        const inner = s.app && s.portal
          ? h('div', { class: 'thumb-both' }, thumb(s.portal, 0.062), thumb(s.app, 0.085))
          : s.app ? thumb(s.app, 0.13) : thumb(s.portal, 0.082);
        const cell = h('div', { class: 'map-step' + (s === state.step ? ' active' : ''), onclick: () => { closeOverlay(); goStep(s); } },
          inner, h('div', { class: 'map-cap' }, h('b', {}, `${i + 1} · ${[s.portal, s.app].filter(Boolean).join('+')}`), s.title));
        row.append(cell);
        if (i < f.steps.length - 1) row.append(h('span', { class: 'map-arrow' }, '→'));
      });
      wrap.append(h('div', { class: 'map-flow' },
        h('div', { class: 'map-flow-head' }, h('span', { class: 'sn' }, f.sn), h('span', { class: 't' }, f.title), h('span', { class: 'm' }, `${f.phase} · ${f.steps.length} steps`)),
        row));
    });
    openOverlay('Flow map · every step in order', wrap);
  }
  $('#btn-map').addEventListener('click', renderMap);

  function renderHelp() {
    const n = h('div', { class: 'help' },
      h('p', {}, 'This is a clickable prototype of the Table 3 S/N 23–30 enhancements. Follow the steps in the left rail, or tap inside the screens to explore; the notes on the right explain what each screen proves.'),
      h('h3', {}, 'Keyboard'),
      h('table', {}, [
        ['→ / ←', 'Next / previous step'], ['T', 'Outline every tappable area on the current screen'], ['M', 'Flow map'],
        ['P', 'Tour: auto-advance every 7 seconds'], ['/', 'Jump to a screen id (e.g. 25-03)'], ['Esc', 'Close this panel or the flow map'],
        ['[ / ]', 'Hide or show the left rail / right notes'],
      ].map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d)))),
      h('h3', {}, 'Linked screens'),
      h('p', {}, 'Where a Portal setting causes what the volunteer sees, both are shown side by side and the step is marked “both”. Tap a highlighted Portal control to jump the phone to the result.'),
      h('h3', {}, 'Sharing a position'),
      h('p', {}, 'The address bar always carries the current screen id (for example #25-03). Send that link to open the prototype at the same step.'),
    );
    openOverlay('How to use this prototype', n);
  }
  $('#btn-help').addEventListener('click', renderHelp);

  // ---------- jump box ----------
  const jump = $('#jump');
  jump.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const id = jump.value.trim().toUpperCase().replace(/^SN?\s*/, '');
      if (META[id]) { const s = stepByScreen[id]; s && s.primaryId === id ? goStep(s) : showScreen(id); jump.value = ''; jump.blur(); }
      else toast('No screen ' + id);
    }
    if (e.key === 'Escape') jump.blur();
  });

  // ---------- keys ----------
  document.addEventListener('keydown', e => {
    if (e.target === jump) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowRight': next(); break;
      case 'ArrowLeft': prev(); break;
      case 't': case 'T': setTaps(!state.taps); break;
      case 'm': case 'M': overlay.hidden ? renderMap() : closeOverlay(); break;
      case 'p': case 'P': state.tour ? stopTour() : startTour(); break;
      case '?': overlay.hidden ? renderHelp() : closeOverlay(); break;
      case '/': e.preventDefault(); jump.focus(); break;
      case 'Escape': closeOverlay(); break;
      case '[': document.getElementById('app').classList.toggle('rail-collapsed'); renderStage(); break;
      case ']': document.getElementById('app').classList.toggle('notes-collapsed'); renderStage(); break;
      default: return;
    }
  });
  $('#btn-prev').addEventListener('click', prev);
  $('#btn-next').addEventListener('click', next);
  window.addEventListener('resize', () => renderStage());

  // ---------- drawers (phones and small tablets) ----------
  const shell = document.getElementById('app');
  function closeDrawers() { shell.classList.remove('rail-open', 'notes-open'); }
  function toggleDrawer(name) { const on = !shell.classList.contains(name); closeDrawers(); if (on) shell.classList.add(name); }
  $('#btn-rail').addEventListener('click', () => toggleDrawer('rail-open'));
  $('#btn-notes').addEventListener('click', () => toggleDrawer('notes-open'));
  $('#scrim').addEventListener('click', closeDrawers);
  narrowMq.addEventListener('change', () => { closeDrawers(); state.layout = null; renderStage(); });

  // ---------- boot ----------
  $('#meta-title').textContent = FLOW_META.title || document.title;
  $('#meta-sub').textContent = FLOW_META.subtitle || '';
  const start = (location.hash || '').replace('#', '').toUpperCase();
  if (start && META[start]) {
    const s = stepByScreen[start];
    if (s && s.primaryId === start) { state.step = s; renderRail(); renderStage(); }
    else { state.step = s || steps[0]; renderRail(); showScreen(start); }
  } else {
    renderRail(); renderStage();
  }
  if (/\bmap=1\b/.test(location.search)) renderMap();

  // ---------- self-test: index.html?selftest=1 → <pre id="selftest"> with a JSON report ----------
  if (/\bselftest=1\b/.test(location.search)) {
    const out = { steps: steps.length, screens: Object.keys(SCREENS).length, hotspots: 0, pinsChecked: 0, pinsMissing: [], hotspotBad: [], errors: [] };
    window.addEventListener('error', e => out.errors.push(String(e.message)));
    try {
      steps.forEach(s => {
        goStep(s);
        (s.pins || []).forEach((p, i) => {
          out.pinsChecked++;
          const kind = p.in || s.primary;
          const frame = stageBody.querySelector(`.frame[data-kind="${kind}"]`);
          const screen = frame && frame.querySelector('.frame-screen');
          if (!screen || !findByText(screen, p.match)) out.pinsMissing.push(`${s.flow.sn} step ${s.si + 1} (${s.primaryId}) pin ${i + 1}: ${p.match}`);
        });
      });
      Object.entries(SCREENS).forEach(([id, html]) => {
        const tmp = document.createElement('div'); tmp.innerHTML = html;
        tmp.querySelectorAll('[data-go]').forEach(el => {
          out.hotspots++;
          const g = el.getAttribute('data-go'), l = el.getAttribute('data-go-link');
          if (!(g.startsWith('none:') || g === 'back' || g === 'home' || g === 'link' || META[g])) out.hotspotBad.push(id + ' → ' + g);
          if (l && !META[l]) out.hotspotBad.push(id + ' link → ' + l);
        });
      });
      // click every tap target once and check the stage ends up where the attribute says
      out.clicks = 0; out.clickBad = [];
      const forceView = id => { const k = META[id].kind; state.step = stepByScreen[id] || steps[0]; state.explore = { [k]: id, primary: k }; state.layout = null; state.history = []; renderStage(); };
      Object.keys(SCREENS).forEach(id => {
        forceView(id);
        const n = stageBody.querySelectorAll(`.frame[data-screen="${id}"] [data-go]`).length;
        for (let i = 0; i < n; i++) {
          forceView(id);
          const el = stageBody.querySelectorAll(`.frame[data-screen="${id}"] [data-go]`)[i];
          if (!el) { out.clickBad.push(`${id} #${i}: element vanished`); continue; }
          const g = el.getAttribute('data-go'), l = el.getAttribute('data-go-link');
          out.clicks++;
          try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }
          catch (e) { out.clickBad.push(`${id} #${i} (${g}): ${e.message}`); continue; }
          const want = l || (META[g] ? g : null);
          if (want && !stageBody.querySelector(`.frame[data-screen="${want}"]`)) out.clickBad.push(`${id} "${(el.textContent || '').trim().slice(0, 24)}" → ${g}${l ? ' +' + l : ''}: not shown`);
        }
      });
      goStep(steps[0]);
    } catch (e) { out.errors.push(String(e && e.stack || e)); }
    const pre = document.createElement('pre'); pre.id = 'selftest'; pre.textContent = JSON.stringify(out, null, 1);
    document.body.append(pre);
  }
})();
