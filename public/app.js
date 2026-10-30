const $ = (sel, root = document) => root.querySelector(sel);

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const state = { users: [], selectedId: null, query: '' };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

function showError(el, err) {
  el.textContent = err ? err.message : '';
  el.hidden = !err;
}

function selectedIdFromHash() {
  const match = location.hash.match(/^#\/users\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function loadUsers() {
  const q = state.query ? `?q=${encodeURIComponent(state.query)}` : '';
  state.users = await api(`/users${q}`);
  renderUserList();
}

function renderUserList() {
  const list = $('#user-list');
  list.replaceChildren(...state.users.map((u) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#/users/${encodeURIComponent(u.id)}`;
    a.className = u.id === state.selectedId ? 'active' : '';
    a.innerHTML = `
      <span class="name"></span>
      <span class="muted small">u/<span class="uname"></span></span>
      <span class="meta">
        <span class="badge plan-${u.plan}">${u.plan}</span>
        <span class="badge status-${u.status}">${u.status}</span>
        <span class="muted small">${u.subredditCount} subs · ${u.interestCount} interests · ${u.scheduleCount} scheduled</span>
      </span>`;
    $('.name', a).textContent = u.displayName;
    $('.uname', a).textContent = u.username;
    li.append(a);
    return li;
  }));
  if (!state.users.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = state.query ? 'No users match.' : 'No users yet.';
    list.append(li);
  }
}

function renderEmptyDetail(message) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = message;
  $('#detail').replaceChildren(p);
}

function renderDetail(user) {
  const detail = $('#detail');
  detail.replaceChildren($('#detail-template').content.cloneNode(true));

  for (const el of detail.querySelectorAll('[data-field]')) {
    const field = el.dataset.field;
    el.textContent = field === 'createdAt' ? new Date(user.createdAt).toLocaleDateString() : user[field];
  }

  const accountForm = $('.account-form', detail);
  accountForm.displayName.value = user.displayName;
  accountForm.email.value = user.email;
  for (const key of ['plan', 'status', 'location', 'bio']) accountForm[key].value = user.account[key];

  const subList = $('.subreddit-list', detail);
  subList.replaceChildren(...user.subredditInterests.map((s) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <a class="sub-name" target="_blank" rel="noopener"></a>
      <span class="bar" role="meter" aria-valuemin="0" aria-valuemax="100"><span></span></span>
      <span class="score"></span>
      <button class="icon-btn" title="Remove" aria-label="Remove">×</button>`;
    const link = $('.sub-name', li);
    link.textContent = `r/${s.subreddit}`;
    link.href = `https://www.reddit.com/r/${encodeURIComponent(s.subreddit)}`;
    $('.bar', li).setAttribute('aria-valuenow', s.score);
    $('.bar > span', li).style.width = `${s.score}%`;
    $('.score', li).textContent = s.score;
    $('button', li).addEventListener('click', () =>
      mutate(`/users/${user.id}/subreddits/${encodeURIComponent(s.subreddit)}`, { method: 'DELETE' }));
    return li;
  }));
  if (!user.subredditInterests.length) subList.innerHTML = '<li class="empty">No subreddit interests yet.</li>';

  const interestList = $('.interest-list', detail);
  interestList.replaceChildren(...user.interests.map((interest) => {
    const li = document.createElement('li');
    li.className = 'chip';
    li.innerHTML = '<span></span><button class="icon-btn" title="Remove" aria-label="Remove">×</button>';
    $('span', li).textContent = interest;
    $('button', li).addEventListener('click', () =>
      mutate(`/users/${user.id}/interests/${encodeURIComponent(interest)}`, { method: 'DELETE' }));
    return li;
  }));
  if (!user.interests.length) interestList.innerHTML = '<li class="empty">No interests yet.</li>';

  const week = $('.week', detail);
  week.replaceChildren(...DAYS.map((day, i) => {
    const col = document.createElement('div');
    col.className = 'day';
    col.innerHTML = '<h4></h4><ul></ul>';
    $('h4', col).textContent = DAY_LABELS[i];
    const entries = user.schedule.filter((e) => e.day === day);
    $('ul', col).replaceChildren(...entries.map((entry) => {
      const li = document.createElement('li');
      li.innerHTML = '<time></time><span></span><button class="icon-btn" title="Remove" aria-label="Remove">×</button>';
      $('time', li).textContent = entry.time;
      $('span', li).textContent = entry.action;
      $('button', li).addEventListener('click', () =>
        mutate(`/users/${user.id}/schedule/${encodeURIComponent(entry.id)}`, { method: 'DELETE' }));
      return li;
    }));
    if (!entries.length) $('ul', col).innerHTML = '<li class="empty">—</li>';
    return col;
  }));

  const scheduleForm = $('.schedule-form', detail);
  scheduleForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(scheduleForm));
    mutate(`/users/${user.id}/schedule`, { method: 'POST', body }, scheduleForm.nextElementSibling);
  });

  accountForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(accountForm));
    mutate(`/users/${user.id}`, { method: 'PATCH', body }, $('.form-error', accountForm));
  });

  const subForm = $('.subreddit-form', detail);
  subForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = { subreddit: subForm.subreddit.value, score: Number(subForm.score.value) };
    mutate(`/users/${user.id}/subreddits`, { method: 'PUT', body }, subForm.nextElementSibling);
  });

  const interestForm = $('.interest-form', detail);
  interestForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = { interest: interestForm.interest.value };
    mutate(`/users/${user.id}/interests`, { method: 'POST', body }, interestForm.nextElementSibling);
  });

  $('[data-action="delete-user"]', detail).addEventListener('click', async () => {
    if (!confirm(`Delete ${user.displayName} (u/${user.username})?`)) return;
    await api(`/users/${user.id}`, { method: 'DELETE' });
    location.hash = '';
  });
}

// Runs a write, then re-renders the selected user and the list from the response.
async function mutate(path, options, errorEl) {
  try {
    const user = await api(path, options);
    renderDetail(user);
    await loadUsers();
  } catch (err) {
    if (errorEl) showError(errorEl, err);
    else alert(err.message);
  }
}

async function route() {
  state.selectedId = selectedIdFromHash();
  renderUserList();
  if (!state.selectedId) return renderEmptyDetail('Select a user to see their account and interests.');
  try {
    renderDetail(await api(`/users/${encodeURIComponent(state.selectedId)}`));
  } catch (err) {
    renderEmptyDetail(err.message);
  }
}

function setupNewUserDialog() {
  const dialog = $('#new-user-dialog');
  const form = $('#new-user-form');
  const errorEl = $('.form-error', form);
  $('#new-user-btn').addEventListener('click', () => {
    form.reset();
    showError(errorEl, null);
    dialog.showModal();
  });
  $('[data-close]', form).addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const user = await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      dialog.close();
      await loadUsers();
      location.hash = `#/users/${encodeURIComponent(user.id)}`;
    } catch (err) {
      showError(errorEl, err);
    }
  });
}

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    loadUsers();
  }, 150);
});

window.addEventListener('hashchange', route);
setupNewUserDialog();
await loadUsers();
await route();
