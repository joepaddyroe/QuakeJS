/**
 * config.cfg / autoexec.cfg persistence (Host_WriteConfiguration subset).
 * Browser: localStorage keys under quakejs/id1/
 */

const PREFIX = 'quakejs/id1/';

/**
 * @param {string} name e.g. config.cfg
 * @returns {string|null}
 */
export function readConfig(name) {
  try {
    return localStorage.getItem(PREFIX + name);
  } catch {
    return null;
  }
}

/**
 * @param {string} name
 * @param {string} text
 * @returns {boolean}
 */
export function writeConfig(name, text) {
  try {
    localStorage.setItem(PREFIX + name, text);
    return true;
  } catch (err) {
    console.warn('[config] write failed', err);
    return false;
  }
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function removeConfig(name) {
  try {
    localStorage.removeItem(PREFIX + name);
    return true;
  } catch {
    return false;
  }
}

/**
 * List savegame / demo keys in localStorage.
 * @param {string} [ext='.sav']
 * @returns {string[]}
 */
export function listStored(ext = '.sav') {
  /** @type {string[]} */
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const name = k.slice(PREFIX.length);
      if (name.toLowerCase().endsWith(ext.toLowerCase())) out.push(name);
    }
  } catch {
    /* ignore */
  }
  return out.sort();
}

/**
 * @param {string} name
 * @returns {string}
 */
export function ensureExt(name, ext) {
  let n = (name || '').replace(/\\/g, '/');
  if (n.includes('..')) throw new Error('Relative pathnames are not allowed');
  const base = n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n;
  if (!base.toLowerCase().endsWith(ext.toLowerCase())) return `${base}${ext}`;
  return base;
}
