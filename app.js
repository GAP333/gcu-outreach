// ============================================================================
// School of Hard Knocks Pipeline — app.js
// ----------------------------------------------------------------------------
// All data lives in Supabase (see supabase/schema.sql) so that everyone on
// the team sees the same live list. This file: loads data, subscribes to
// realtime changes, renders the three views (hero / list / detail), and
// handles every write (add/edit/delete prospect, tier, stage, emails,
// touchpoints).
// ============================================================================

import { getSupabase, isConfigured } from './config.js';

// ── STATE ────────────────────────────────────────────────────────────────
let supabase = null;
let people = [];                 // cached prospects (both lists combined), refreshed from Supabase
let touchpointsByProspect = {};  // { [prospect_id]: [touchpoint, ...] } newest first
let goals = [];                  // cached goals/KPIs, refreshed from Supabase

let currentSection = 'prospects'; // 'prospects' | 'goals'
let currentFilter = 'all';       // hero CTA filter: all | high | medium | faith | contacted
let lastListFilter = 'all';
let editingId = null;
let currentDetailId = null;
let filteredPeopleCache = [];

const FOLLOWUP_DAYS = 14;                       // flag as "needs follow-up" after this many days of silence
const STAGE_OPTIONS = ['Needs to be Contacted', 'Emailed', 'Interested', 'Met with', 'Confirmed'];
const ENGAGED_STAGES = ['Needs to be Contacted', 'Emailed', 'Interested', 'Met with']; // "Confirmed" = done, no follow-up needed
const TOUCHPOINT_TYPES = ['Email', 'Call', 'Meeting', 'Text', 'Other'];
const LIST_LABELS = { SOHK: 'School of Hard Knocks', KIC: 'Kingdom Impact Council' };

// ── SECTION SWITCHING (Prospects <-> Goals) ─────────────────────────────────
function showSection(section) {
  currentSection = section;
  document.getElementById('tab-prospects').classList.toggle('nav-tab-active', section === 'prospects');
  document.getElementById('tab-goals').classList.toggle('nav-tab-active', section === 'goals');

  if (section === 'goals') {
    document.getElementById('page-hero').style.display = 'none';
    document.getElementById('page-list').classList.remove('active');
    document.getElementById('page-detail').classList.remove('active');
    document.getElementById('page-goals').style.display = '';
    renderGoals();
  } else {
    document.getElementById('page-goals').style.display = 'none';
    showHero();
  }
}

// ── INIT ─────────────────────────────────────────────────────────────────
async function init() {
  document.getElementById('tab-prospects').classList.add('nav-tab-active');
  if (!isConfigured) {
    showConnectionBanner();
    updateStats();
    return;
  }

  supabase = await getSupabase();
  setLiveStatus('connecting');

  await reloadAll();
  setLiveStatus('live');
  subscribeRealtime();
}

async function reloadAll() {
  await Promise.all([reloadProspects(), reloadTouchpoints(), reloadGoals()]);
  populateCatFilter();
  renderCurrentView();
  updateStats();
}

async function reloadProspects() {
  const { data, error } = await supabase.from('prospects').select('*').order('id', { ascending: true });
  if (error) { console.error('Failed to load prospects:', error); return; }
  people = data || [];
}

async function reloadTouchpoints() {
  const { data, error } = await supabase.from('touchpoints').select('*').order('touch_date', { ascending: false }).order('created_at', { ascending: false });
  if (error) { console.error('Failed to load touchpoints:', error); return; }
  touchpointsByProspect = {};
  (data || []).forEach(t => {
    if (!touchpointsByProspect[t.prospect_id]) touchpointsByProspect[t.prospect_id] = [];
    touchpointsByProspect[t.prospect_id].push(t);
  });
}

async function reloadGoals() {
  const { data, error } = await supabase.from('goals').select('*').order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });
  if (error) { console.error('Failed to load goals:', error); return; }
  goals = data || [];
}

function subscribeRealtime() {
  supabase
    .channel('prospects-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'prospects' }, async () => {
      await reloadProspects();
      populateCatFilter();
      renderCurrentView();
      updateStats();
    })
    .subscribe();

  supabase
    .channel('touchpoints-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'touchpoints' }, async () => {
      await reloadTouchpoints();
      renderCurrentView();
      updateStats();
    })
    .subscribe();

  supabase
    .channel('goals-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'goals' }, async () => {
      await reloadGoals();
      if (currentSection === 'goals') renderGoals();
    })
    .subscribe();
}

function renderCurrentView() {
  if (currentSection === 'goals') { renderGoals(); return; }
  const detailVisible = document.getElementById('page-detail').classList.contains('active');
  const listVisible = document.getElementById('page-list').classList.contains('active');
  if (detailVisible && currentDetailId != null && people.find(p => p.id === currentDetailId)) {
    showDetail(currentDetailId);
  } else if (listVisible) {
    renderList();
  }
}

function showConnectionBanner() {
  const el = document.getElementById('connection-banner');
  if (el) el.style.display = 'flex';
  setLiveStatus('offline');
}

function setLiveStatus(state) {
  const dot = document.getElementById('nav-live-dot');
  const label = document.getElementById('nav-live-label');
  if (!dot || !label) return;
  if (state === 'live') { dot.className = 'nav-live-dot'; label.textContent = 'Live sync'; }
  else if (state === 'connecting') { dot.className = 'nav-live-dot nav-live-connecting'; label.textContent = 'Connecting…'; }
  else { dot.className = 'nav-live-dot nav-live-offline'; label.textContent = 'Not connected — see README'; }
}

// ── FOLLOW-UP LOGIC ─────────────────────────────────────────────────────────
function lastTouchpointDate(prospectId) {
  const list = touchpointsByProspect[prospectId];
  if (!list || !list.length) return null;
  return list[0].touch_date; // already sorted newest-first
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const ms = Date.now() - new Date(dateStr + 'T00:00:00').getTime();
  return Math.floor(ms / 86400000);
}

function needsFollowup(p) {
  if (!ENGAGED_STAGES.includes(p.stage)) return false;
  const last = lastTouchpointDate(p.id) || (p.updated_at ? p.updated_at.slice(0, 10) : null);
  return daysSince(last) >= FOLLOWUP_DAYS;
}

// ── NAVIGATION ──────────────────────────────────────────────────────────────
function showHero() {
  document.getElementById('page-hero').style.display = '';
  document.getElementById('page-list').classList.remove('active');
  document.getElementById('page-detail').classList.remove('active');
  updateStats();
}

function showList(filter) {
  filter = filter || lastListFilter || 'all';
  lastListFilter = filter;
  currentFilter = filter;
  document.getElementById('page-hero').style.display = 'none';
  document.getElementById('page-list').classList.add('active');
  document.getElementById('page-detail').classList.remove('active');

  const titles = { high: 'High Priority Prospects', medium: 'Medium Prospects', faith: 'Faith Confirmed Prospects', needscontact: 'Needs to be Contacted', contacted: 'Contacted Prospects', all: 'All Prospects' };
  const badgeClasses = { high: 'badge-green', medium: 'badge-yellow', faith: 'badge-all', needscontact: 'badge-all', contacted: 'badge-all', all: 'badge-all' };
  document.getElementById('list-title').textContent = titles[filter] || 'All Prospects';

  populateCatFilter();
  renderList();
  window.scrollTo(0, 0);
}

function populateCatFilter() {
  const cats = [...new Set(people.map(p => p.category).filter(Boolean))].sort();

  const sel = document.getElementById('list-cat');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Categories</option>';
    cats.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; if (c === cur) o.selected = true; sel.appendChild(o); });
  }

  const datalist = document.getElementById('category-suggestions');
  if (datalist) datalist.innerHTML = cats.map(c => `<option value="${c}"></option>`).join('');
}

// ── FILTERING ───────────────────────────────────────────────────────────────
function getFilteredPeople() {
  const q = document.getElementById('list-search') ? document.getElementById('list-search').value.toLowerCase() : '';
  const cat = document.getElementById('list-cat') ? document.getElementById('list-cat').value : '';
  const faithOnly = document.getElementById('list-faith') ? document.getElementById('list-faith').value === 'faith' : false;
  const azOnly = document.getElementById('list-az') ? document.getElementById('list-az').value === 'az' : false;
  const tierFilter = document.getElementById('list-tier') ? document.getElementById('list-tier').value : '';
  const stageFilter = document.getElementById('list-stage') ? document.getElementById('list-stage').value : '';
  const followupOnly = document.getElementById('list-followup') ? document.getElementById('list-followup').value === 'followup' : false;
  const sourceFilter = document.getElementById('list-source') ? document.getElementById('list-source').value : '';
  const emailSearch = document.getElementById('email-search') ? document.getElementById('email-search').value.toLowerCase().trim() : '';

  return people.filter(p => {
    if (currentFilter === 'high' && p.priority !== 'high') return false;
    if (currentFilter === 'medium' && p.priority !== 'medium') return false;
    if (currentFilter === 'faith' && !p.faith_confirmed) return false;
    if (currentFilter === 'needscontact' && p.stage !== 'Needs to be Contacted') return false;
    if (currentFilter === 'contacted' && !(p.stage && p.stage !== 'Needs to be Contacted')) return false;
    if (sourceFilter && p.list !== sourceFilter) return false;
    if (cat && p.category !== cat) return false;
    if (faithOnly && !p.faith_confirmed) return false;
    if (tierFilter && (p.tier || '') !== tierFilter) return false;
    if (stageFilter === 'none' && p.stage) return false;
    if (stageFilter && stageFilter !== 'none' && p.stage !== stageFilter) return false;
    if (followupOnly && !needsFollowup(p)) return false;
    if (emailSearch && !(p.email || '').toLowerCase().includes(emailSearch)) return false;
    if (azOnly) {
      const loc = (p.location || '').toLowerCase();
      if (!loc.includes('az') && !loc.includes('arizona') && !loc.includes('scottsdale') && !loc.includes('phoenix') && !loc.includes('tempe') && !loc.includes('mesa') && !loc.includes('chandler') && !loc.includes('gilbert')) return false;
    }
    const txt = [p.name, p.org, p.category, p.role, p.bio, p.location, ...(p.tags || [])].join(' ').toLowerCase();
    if (q && !txt.includes(q)) return false;
    return true;
  });
}

// ── LIST VIEW ───────────────────────────────────────────────────────────────
function renderList() {
  const filtered = getFilteredPeople();

  const badgeClasses = { high: 'badge-green', medium: 'badge-yellow', faith: 'badge-all', all: 'badge-all' };
  const badge = document.getElementById('list-badge');
  badge.textContent = filtered.length;
  badge.className = 'list-count-badge ' + (badgeClasses[currentFilter] || 'badge-all');

  const container = document.getElementById('prospect-list');
  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state">No prospects match your filters.</div>';
    return;
  }

  container.innerHTML = filtered.map(p => `
    <div class="prospect-row" data-id="${p.id}" style="cursor:pointer">
      <div class="row-avatar">${initials(p.name)}</div>
      <div class="row-info">
        <div class="row-name">${p.name}</div>
        ${p.location ? `<div class="row-location">${p.location}</div>` : ''}
        <div class="row-sub">${[p.role, p.org].filter(Boolean).join(' · ')}</div>
      </div>
      <div class="row-right">
        ${needsFollowup(p) ? '<span class="row-followup" title="No touch in ' + FOLLOWUP_DAYS + '+ days">⚠ Follow up</span>' : ''}
        ${p.faith_confirmed ? '<span class="row-faith">Faith</span>' : ''}
        ${p.stage ? `<span class="row-stage ${getStageClass(p.stage)}">${p.stage}</span>` : ''}
        <span id="tier-badge-${p.id}" class="row-tier ${getTierRowClass(p.tier || '')}">${getTierLabel(p.tier || '')}</span>
        <span class="row-score ${scoreColor(p)}">${p.score || '-'}</span>
        <div class="row-actions" onclick="event.stopPropagation()">
          <button class="row-btn row-btn-edit" onclick="openEdit(${p.id})">Edit</button>
          <button class="row-btn row-btn-del" onclick="deletePerson(${p.id})">Delete</button>
        </div>
        <span class="row-arrow">›</span>
      </div>
    </div>`).join('');
}

// ── DETAIL VIEW ─────────────────────────────────────────────────────────────
function showDetail(id) {
  const p = people.find(x => x.id === id);
  if (!p) return;
  currentDetailId = id;
  filteredPeopleCache = getFilteredPeople();

  document.getElementById('page-list').classList.remove('active');
  document.getElementById('page-detail').classList.add('active');

  const idx = filteredPeopleCache.findIndex(x => x.id === id);
  document.getElementById('d-counter').textContent = (idx + 1) + ' of ' + filteredPeopleCache.length;
  document.getElementById('btn-prev').disabled = idx <= 0;
  document.getElementById('btn-next').disabled = idx >= filteredPeopleCache.length - 1;

  document.getElementById('d-name').textContent = p.name;
  document.getElementById('d-role').textContent = p.role || '';
  document.getElementById('d-org').innerHTML = (p.location ? `<span style="font-size:13px;color:#4f46e5;font-weight:600;display:block;margin-bottom:2px">${p.location}</span>` : '') + (p.org || '');

  const score = p.score || 0;
  document.getElementById('d-score-label').textContent = score;
  document.getElementById('d-progress').style.width = score + '%';
  document.getElementById('d-progress').className = 'detail-progress-fill ' + (p.priority === 'high' ? 'bar-green' : p.priority === 'medium' ? 'bar-yellow' : 'bar-low');

  // Badges: reach priority, stage select, tier select
  const reachClass = p.priority === 'high' ? 'badge-reach-green' : 'badge-reach-yellow';
  const reachLabel = p.priority === 'high' ? 'Reach out now' : p.priority === 'medium' ? 'High potential' : 'Low priority';
  const currentStage = p.stage || '';
  const currentTier = p.tier || '';
  document.getElementById('d-badges').innerHTML = `
    ${needsFollowup(p) ? '<div class="detail-badge badge-followup">⚠ Needs follow-up</div>' : ''}
    <div class="detail-badge ${reachClass}">${reachLabel}</div>
    <select id="stage-sel-${p.id}" class="stage-select ${getStageClass(currentStage)}" onchange="updateStage(${p.id}, this.value)">
      <option value="" ${!currentStage ? 'selected' : ''}>Not started</option>
      ${STAGE_OPTIONS.map(o => `<option value="${o}" ${o === currentStage ? 'selected' : ''}>${o}</option>`).join('')}
    </select>
    <select id="tier-sel-${p.id}" class="tier-select ${getTierClass(currentTier)}" onchange="updateTier(${p.id}, this.value)">
      ${['', 'Whale', 'Review', 'Contact'].map(t => `<option value="${t}" ${t === currentTier ? 'selected' : ''}>${t ? getTierLabel(t) : 'Set Tier'}</option>`).join('')}
    </select>`;

  document.getElementById('d-bio').textContent = p.bio || 'No biography available.';
  document.getElementById('d-approach').textContent = p.approach || 'No approach strategy added yet.';
  setEmailField(1, p.email || '');
  setEmailField(2, p.email2 || '');
  document.getElementById('d-gcu').textContent = p.angle || 'No GCU connection angle added yet.';
  document.getElementById('d-faith').textContent = p.faith || 'Faith background not confirmed.';

  const notableEl = document.getElementById('d-notable');
  if (p.notable) { notableEl.style.display = ''; notableEl.textContent = p.notable; }
  else { notableEl.style.display = 'none'; }

  const originNotes = [];
  if (p.list) originNotes.push(`<span class="origin-note origin-${p.list}">From: ${LIST_LABELS[p.list] || p.list}</span>`);
  if (p.manually_added) originNotes.push('<span class="origin-note origin-added">✚ Manually added prospect</span>');
  document.getElementById('d-origin-notes').innerHTML = originNotes.join('');

  const faithCheck = document.getElementById('d-faith-confirmed-check');
  if (faithCheck) faithCheck.checked = !!p.faith_confirmed;

  const draftCard = document.getElementById('d-draftemail-card');
  if (p.draft_email) { draftCard.style.display = ''; document.getElementById('d-draftemail').textContent = p.draft_email; }
  else { draftCard.style.display = 'none'; }

  const verifiedWrap = document.getElementById('d-verified-wrap');
  if (p.source_urls && p.source_urls.length) {
    verifiedWrap.style.display = '';
    document.getElementById('d-verified').innerHTML = p.source_urls.map(u =>
      `<a class="detail-verified-link" href="${u}" target="_blank" rel="noopener">${u}</a>`).join('');
  } else {
    verifiedWrap.style.display = 'none';
  }

  document.getElementById('d-tags').innerHTML = (p.tags || []).map(t => {
    const isFaith = t.toLowerCase().includes('faith') || t.toLowerCase().includes('christian') || t.toLowerCase().includes('biblical');
    return `<span class="sidebar-tag ${isFaith ? 'sidebar-tag-faith' : ''}">${t}</span>`;
  }).join('');

  const newsBox = document.getElementById('d-news');
  const newsName = encodeURIComponent(p.name);
  if (p.news && p.news.length) {
    newsBox.innerHTML = p.news.map(n => {
      const titleHtml = n.url ? `<a href="${n.url}" target="_blank" rel="noopener">${n.title}</a>` : n.title;
      return `
      <div class="detail-news-item">
        <div><div class="detail-news-title">${titleHtml}</div><div class="detail-news-source">${n.source}</div></div>
        <div class="detail-news-date">${n.date}</div>
      </div>`;
    }).join('') +
      `<div style="margin-top:10px"><a class="detail-news-link" href="https://news.google.com/search?q=${newsName}" target="_blank"> Search Google News for ${p.name} →</a></div>`;
  } else {
    newsBox.innerHTML = `<div class="detail-news-empty">No recent articles found automatically.</div>
      <a class="detail-news-link" href="https://news.google.com/search?q=${newsName}" target="_blank"> Search Google News for ${p.name} →</a>`;
  }

  renderTouchpoints(p.id);
  window.scrollTo(0, 0);
}

function navigateDetail(dir) {
  const list = filteredPeopleCache;
  const idx = list.findIndex(p => p.id === currentDetailId);
  const newIdx = idx + dir;
  if (newIdx >= 0 && newIdx < list.length) showDetail(list[newIdx].id);
}

// ── TOUCHPOINTS ─────────────────────────────────────────────────────────────
function renderTouchpoints(prospectId) {
  const list = touchpointsByProspect[prospectId] || [];
  const box = document.getElementById('d-touchpoints-list');
  if (!box) return;

  if (!list.length) {
    box.innerHTML = '<div class="touchpoint-empty">No touchpoints logged yet.</div>';
  } else {
    box.innerHTML = list.map(t => `
      <div class="touchpoint-item">
        <div class="touchpoint-type-badge tp-${t.type.toLowerCase()}">${t.type}</div>
        <div class="touchpoint-body">
          <div class="touchpoint-meta">${formatDate(t.touch_date)}${t.logged_by ? ' · ' + escapeHtml(t.logged_by) : ''}</div>
          ${t.note ? `<div class="touchpoint-note">${escapeHtml(t.note)}</div>` : ''}
        </div>
        <button class="touchpoint-del" title="Delete" onclick="deleteTouchpoint(${t.id}, ${prospectId})">×</button>
      </div>`).join('');
  }

  const lastDate = lastTouchpointDate(prospectId);
  const lastEl = document.getElementById('d-touchpoints-last');
  if (lastEl) {
    lastEl.textContent = lastDate ? `Last touch: ${formatDate(lastDate)} (${daysSince(lastDate)}d ago)` : 'No touchpoints logged yet';
  }

  const savedName = localStorage.getItem('gcu_logged_by') || '';
  const nameInput = document.getElementById('tp-logged-by');
  if (nameInput && !nameInput.value) nameInput.value = savedName;
  const dateInput = document.getElementById('tp-date');
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
}

async function addTouchpoint() {
  if (!requireConnection()) return;
  const prospectId = currentDetailId;
  if (prospectId == null) return;
  const type = document.getElementById('tp-type').value;
  const date = document.getElementById('tp-date').value || new Date().toISOString().slice(0, 10);
  const note = document.getElementById('tp-note').value.trim();
  const loggedBy = document.getElementById('tp-logged-by').value.trim();

  localStorage.setItem('gcu_logged_by', loggedBy);

  const { error } = await supabase.from('touchpoints').insert({
    prospect_id: prospectId, type, touch_date: date, note: note || null, logged_by: loggedBy || null
  });
  if (error) { alert('Could not save touchpoint: ' + error.message); return; }

  document.getElementById('tp-note').value = '';
  await reloadTouchpoints();
  showDetail(prospectId);
  updateStats();
}

async function deleteTouchpoint(id, prospectId) {
  if (!requireConnection()) return;
  if (!confirm('Delete this touchpoint?')) return;
  const { error } = await supabase.from('touchpoints').delete().eq('id', id);
  if (error) { alert('Could not delete: ' + error.message); return; }
  await reloadTouchpoints();
  showDetail(prospectId);
  updateStats();
}

// ── TIER / STAGE / EMAIL UPDATES ─────────────────────────────────────────────
async function updateTier(id, tier) {
  if (!requireConnection()) return;
  const p = people.find(x => x.id === id);
  if (!p) return;
  p.tier = tier; // optimistic
  const sel = document.getElementById('tier-sel-' + id);
  if (sel) sel.className = 'tier-select ' + getTierClass(tier);
  const badge = document.getElementById('tier-badge-' + id);
  if (badge) { badge.className = 'row-tier ' + getTierRowClass(tier); badge.textContent = getTierLabel(tier); }
  updateStats();
  const { error } = await supabase.from('prospects').update({ tier: tier || null }).eq('id', id);
  if (error) console.error('updateTier failed:', error);
}

async function updateStage(id, stage) {
  if (!requireConnection()) return;
  const p = people.find(x => x.id === id);
  if (!p) return;
  p.stage = stage || null; // optimistic
  updateStats();
  const { error } = await supabase.from('prospects').update({ stage: stage || null }).eq('id', id);
  if (error) console.error('updateStage failed:', error);
  showDetail(id);
}

async function toggleFaithConfirmed(checked) {
  if (!requireConnection()) return;
  const id = currentDetailId;
  const p = people.find(x => x.id === id);
  if (!p) return;
  p.faith_confirmed = checked; // optimistic
  updateStats();
  const { error } = await supabase.from('prospects').update({ faith_confirmed: checked }).eq('id', id);
  if (error) console.error('toggleFaithConfirmed failed:', error);
}

function setEmailField(num, val) {
  const input = document.getElementById('d-email' + num);
  const display = document.getElementById('d-email' + num + '-display');
  const valSpan = document.getElementById('d-email' + num + '-val');
  if (val) {
    input.style.display = 'none';
    display.style.display = 'flex';
    valSpan.textContent = val;
    input.value = val;
  } else {
    input.style.display = 'block';
    display.style.display = 'none';
    input.value = '';
  }
}

function unlockEmail(num) {
  const input = document.getElementById('d-email' + num);
  const display = document.getElementById('d-email' + num + '-display');
  display.style.display = 'none';
  input.style.display = 'block';
  input.classList.add('unlocked');
  input.focus();
  input.select();
}

async function copyDraftEmail() {
  const text = document.getElementById('d-draftemail').textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('d-draftemail-copy');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 2000);
  } catch (e) {
    alert('Could not copy automatically — select the text and copy manually.');
  }
}

async function saveEmails() {
  if (!requireConnection()) return;
  const p = people.find(x => x.id === currentDetailId);
  if (!p) return;
  const email1 = document.getElementById('d-email1').value.trim();
  const email2 = document.getElementById('d-email2').value.trim();
  p.email = email1; p.email2 = email2;
  setEmailField(1, email1); setEmailField(2, email2);
  document.getElementById('d-email1').classList.remove('unlocked');
  document.getElementById('d-email2').classList.remove('unlocked');

  const btn = document.getElementById('email-save-btn');
  btn.textContent = 'Saving…';
  const { error } = await supabase.from('prospects').update({ email: email1 || null, email2: email2 || null }).eq('id', currentDetailId);
  if (error) { alert('Could not save emails: ' + error.message); btn.textContent = 'Save Emails'; return; }
  btn.textContent = 'Saved!'; btn.classList.add('saved');
  setTimeout(() => { btn.textContent = 'Save Emails'; btn.classList.remove('saved'); }, 2000);
}

// ── ADD / EDIT / DELETE PROSPECT ──────────────────────────────────────────────
function openForm() {
  editingId = null;
  clearForm();
  document.getElementById('form-title').textContent = 'Add Prospect';
  document.getElementById('form-overlay').classList.add('open');
}

function openEdit(id) {
  const p = people.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById('f-name').value = p.name || '';
  document.getElementById('f-role').value = p.role || '';
  document.getElementById('f-org').value = p.org || '';
  document.getElementById('f-category').value = p.category || '';
  document.getElementById('f-location').value = p.location || '';
  document.getElementById('f-email').value = p.email || '';
  document.getElementById('f-bio').value = p.bio || '';
  document.getElementById('f-approach').value = p.approach || '';
  document.getElementById('f-faith').value = p.faith || '';
  document.getElementById('f-angle').value = p.angle || '';
  document.getElementById('f-tags').value = (p.tags || []).join(', ');
  document.getElementById('f-priority').value = p.priority || 'medium';
  document.getElementById('f-list').value = p.list || 'SOHK';
  document.getElementById('form-title').textContent = 'Edit Prospect';
  document.getElementById('form-overlay').classList.add('open');
}

function closeForm() {
  document.getElementById('form-overlay').classList.remove('open');
  clearForm(); editingId = null;
}

function clearForm() {
  ['f-name', 'f-role', 'f-org', 'f-location', 'f-email', 'f-bio', 'f-approach', 'f-faith', 'f-angle', 'f-tags'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-category').value = '';
  document.getElementById('f-priority').value = 'medium';
  document.getElementById('f-list').value = 'SOHK';
}

async function savePerson() {
  if (!requireConnection()) return;
  const name = document.getElementById('f-name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  const faith = document.getElementById('f-faith').value.trim();
  const tags = document.getElementById('f-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const priority = document.getElementById('f-priority').value;
  const data = {
    name, role: document.getElementById('f-role').value.trim(), org: document.getElementById('f-org').value.trim(),
    category: document.getElementById('f-category').value || null, location: document.getElementById('f-location').value.trim(),
    email: document.getElementById('f-email').value.trim() || null, bio: document.getElementById('f-bio').value.trim(),
    approach: document.getElementById('f-approach').value.trim(), faith, angle: document.getElementById('f-angle').value.trim(),
    tags, priority, score: priority === 'high' ? 80 : priority === 'medium' ? 60 : 40, news: []
  };

  if (editingId !== null) {
    const { error } = await supabase.from('prospects').update(data).eq('id', editingId);
    if (error) { alert('Could not save: ' + error.message); return; }
  } else {
    const maxId = people.reduce((m, p) => Math.max(m, p.id), 0);
    const list = document.getElementById('f-list').value;
    const { error } = await supabase.from('prospects').insert({
      id: maxId + 1, list, manually_added: true, faith_confirmed: false, ...data
    });
    if (error) { alert('Could not add prospect: ' + error.message); return; }
  }

  closeForm();
  await reloadProspects();
  populateCatFilter(); renderList(); updateStats();
}

async function deletePerson(id) {
  if (!requireConnection()) return;
  if (!confirm('Remove this prospect?')) return;
  const { error } = await supabase.from('prospects').delete().eq('id', id);
  if (error) { alert('Could not delete: ' + error.message); return; }
  await reloadProspects();
  populateCatFilter(); renderList(); updateStats();
}

function requireConnection() {
  if (!supabase) { alert('Not connected to Supabase yet — see README.md to finish setup.'); return false; }
  return true;
}

// ── GOALS / KPIs ─────────────────────────────────────────────────────────────
function renderGoals() {
  const openList = document.getElementById('goals-open-list');
  const doneList = document.getElementById('goals-done-list');
  if (!openList || !doneList) return;

  const open = goals.filter(g => !g.completed);
  const done = goals.filter(g => g.completed);

  openList.innerHTML = open.length
    ? open.map(goalRowHtml).join('')
    : '<div class="touchpoint-empty">No open goals yet — add one above.</div>';

  doneList.innerHTML = done.length
    ? done.map(goalRowHtml).join('')
    : '<div class="touchpoint-empty">Nothing completed yet.</div>';
}

function goalRowHtml(g) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !g.completed && g.due_date && g.due_date < today;
  return `
    <div class="goal-row ${g.completed ? 'goal-row-done' : ''} ${overdue ? 'goal-row-overdue' : ''}">
      <input type="checkbox" ${g.completed ? 'checked' : ''} onchange="toggleGoalComplete(${g.id}, this.checked)"/>
      <div class="goal-row-text">
        <div class="goal-row-title">${escapeHtml(g.title)}</div>
        <div class="goal-row-meta">
          ${g.due_date ? `Due ${formatDate(g.due_date)}${overdue ? ' — overdue' : ''}` : 'No due date'}
          ${g.completed && g.completed_at ? ` · Completed ${formatDate(g.completed_at)}` : ''}
        </div>
      </div>
      <button class="touchpoint-del" title="Delete" onclick="deleteGoal(${g.id})">×</button>
    </div>`;
}

async function addGoal() {
  if (!requireConnection()) return;
  const title = document.getElementById('goal-title').value.trim();
  if (!title) { alert('Enter a goal description first.'); return; }
  const dueDate = document.getElementById('goal-due-date').value || null;
  const { error } = await supabase.from('goals').insert({ title, due_date: dueDate });
  if (error) { alert('Could not add goal: ' + error.message); return; }
  document.getElementById('goal-title').value = '';
  document.getElementById('goal-due-date').value = '';
  await reloadGoals();
  renderGoals();
}

async function toggleGoalComplete(id, checked) {
  if (!requireConnection()) return;
  const g = goals.find(x => x.id === id);
  if (g) { g.completed = checked; g.completed_at = checked ? new Date().toISOString().slice(0, 10) : null; }
  renderGoals();
  const { error } = await supabase.from('goals').update({
    completed: checked, completed_at: checked ? new Date().toISOString().slice(0, 10) : null
  }).eq('id', id);
  if (error) console.error('toggleGoalComplete failed:', error);
}

async function deleteGoal(id) {
  if (!requireConnection()) return;
  if (!confirm('Delete this goal?')) return;
  const { error } = await supabase.from('goals').delete().eq('id', id);
  if (error) { alert('Could not delete: ' + error.message); return; }
  await reloadGoals();
  renderGoals();
}

// ── STATS ───────────────────────────────────────────────────────────────────
function updateStats() {
  const scoped = people;
  const high = scoped.filter(p => p.priority === 'high').length;
  const medium = scoped.filter(p => p.priority === 'medium').length;
  const faith = scoped.filter(p => p.faith_confirmed).length;
  const needsContact = scoped.filter(p => p.stage === 'Needs to be Contacted').length;
  const contacted = scoped.filter(p => p.stage && p.stage !== 'Needs to be Contacted').length;
  const meetings = Object.values(touchpointsByProspect).reduce((sum, list) => sum + list.filter(t => t.type === 'Meeting').length, 0);
  const followup = scoped.filter(needsFollowup).length;

  setText('nav-green', high);
  setText('nav-yellow', medium);
  setText('nav-followup', followup);
  setText('nav-contacted', contacted);
  setText('nav-meetings', meetings);

  setText('hero-sub', scoped.length + ' prospects researched and scored for GCU outreach.');
  setText('cta-green-count', high);
  setText('cta-yellow-count', medium);
  setText('cta-faith-count', faith);
  setText('cta-needed-count', needsContact);
  setText('cta-contacted-count', contacted);
  setText('cta-all-count', scoped.length);

  setText('st-high', high);
  setText('st-medium', medium);
  setText('st-faith', faith);
  setText('st-contacted', contacted);
  setText('st-meetings', meetings);
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ── HELPERS ─────────────────────────────────────────────────────────────────
function initials(n) { return n.split(' ').filter(Boolean).slice(0, 2).map(w => w[0] || '').join('').toUpperCase(); }

function scoreColor(p) {
  if (p.priority === 'high') return 'score-green';
  if (p.priority === 'medium') return 'score-yellow';
  return 'score-low';
}

function getTierClass(tier) { return tier === 'Whale' ? 'tw' : tier === 'Review' ? 'tr' : tier === 'Contact' ? 'tc' : 'tu'; }
function getTierLabel(tier) { return tier === 'Whale' ? 'Whale' : tier === 'Review' ? 'Review' : tier === 'Contact' ? 'Contact' : 'Unset'; }
function getTierRowClass(tier) { return tier === 'Whale' ? 'tier-whale' : tier === 'Review' ? 'tier-review' : tier === 'Contact' ? 'tier-contact' : 'tier-unset'; }

function getStageClass(stage) {
  return { 'Needs to be Contacted': 'stage-needed', Emailed: 'stage-emailed', Interested: 'stage-interested', 'Met with': 'stage-met', Confirmed: 'stage-confirmed' }[stage] || 'stage-none';
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ── EVENT WIRING ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('form-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeForm(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeForm(); });
  document.getElementById('prospect-list').addEventListener('click', function (e) {
    const row = e.target.closest('.prospect-row');
    if (!row) return;
    const id = parseInt(row.dataset.id);
    if (id) showDetail(id);
  });
  init();
});

// ── EXPOSE TO INLINE HTML HANDLERS ────────────────────────────────────────────
Object.assign(window, {
  showHero, showList, showSection, openForm, openEdit, closeForm, savePerson, deletePerson,
  renderList, unlockEmail, saveEmails, navigateDetail, updateTier, updateStage,
  addTouchpoint, deleteTouchpoint, copyDraftEmail, toggleFaithConfirmed,
  addGoal, toggleGoalComplete, deleteGoal
});
