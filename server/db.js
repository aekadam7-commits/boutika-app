/* ============================================================
   Boutik v4 — قاعدة بيانات السيرفر (ملف JSON بسيط)
   ============================================================ */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'boutik.json');

let state = {
  changelog: [],
  seq: 0,
  deviceId: null,
  shopName: null
};

function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } else {
      save();
    }
  } catch (e) {
    console.error('DB load error', e);
  }
}

function save() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('DB save error', e);
  }
}

function append(entry) {
  entry.seq = ++state.seq;
  state.changelog.push(entry);
  // اقتطاع
  if (state.changelog.length > 20000) {
    state.changelog.splice(0, state.changelog.length - 20000);
  }
  save();
  return entry;
}

function since(seq) {
  return state.changelog.filter(e => e.seq > seq);
}

module.exports = { load, save, append, since, getState: () => state, setState: (s) => { state = s; save(); } };
