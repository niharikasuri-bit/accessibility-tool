const PROJECTS_KEY = 'digit_admin_projects';
const SETTINGS_KEY = 'digit_admin_settings';

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {
    console.warn('[adminStore] Failed to persist to localStorage:', err.message);
  }
}

export function getProjects() { return load(PROJECTS_KEY, []); }

export function getProject(id) {
  return getProjects().find((p) => p.id === id) ?? null;
}

export function saveProject(project) {
  const list   = getProjects();
  const idx    = list.findIndex((p) => p.id === project.id);
  const now    = Date.now();
  const updated = { ...project, updatedAt: now };
  if (idx >= 0) list[idx] = updated;
  else          list.push({ ...updated, createdAt: now });
  persist(PROJECTS_KEY, list);
  return updated;
}

export function deleteProject(id) {
  persist(PROJECTS_KEY, getProjects().filter((p) => p.id !== id));
}

export function toggleProjectStatus(id) {
  const list    = getProjects();
  const project = list.find((p) => p.id === id);
  if (!project) return;
  project.status    = project.status === 'active' ? 'paused' : 'active';
  project.updatedAt = Date.now();
  persist(PROJECTS_KEY, list);
  return project;
}

export function getSettings() {
  return load(SETTINGS_KEY, {
    gmailAppPassword: '',              // Google App Password for the sender account
    senderName:    'DIGIT Accessibility Bot',
    senderEmail:   '',
    smtp:          { host: '', port: '587', username: '', password: '' },
    slackWebhook:  '',
    slackAppToken: '',
  });
}

export function saveSettings(settings) {
  persist(SETTINGS_KEY, settings);
}

export function newProjectId() {
  return 'proj_' + Math.random().toString(36).slice(2, 10);
}
