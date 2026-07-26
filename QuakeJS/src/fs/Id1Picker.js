/**
 * Prompt user for Quake id1 PAK files when fetch fails (File System Access / file input).
 */

/**
 * @returns {Promise<File[]>}
 */
export function pickPakFiles() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pak,.PAK';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      input.remove();
      if (!files.length) {
        reject(new Error('No files selected'));
        return;
      }
      resolve(files);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      reject(new Error('File picker cancelled'));
    });
    input.click();
  });
}

/**
 * Prefer showDirectoryPicker when available (Chrome).
 * @returns {Promise<File[]>}
 */
export async function pickId1Directory() {
  // @ts-ignore
  if (typeof window.showDirectoryPicker !== 'function') {
    return pickPakFiles();
  }
  // @ts-ignore
  const dir = await window.showDirectoryPicker({
    id: 'quake-id1',
    mode: 'read',
  });
  /** @type {File[]} */
  const files = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file') continue;
    const lower = name.toLowerCase();
    if (lower === 'pak0.pak' || lower === 'pak1.pak') {
      files.push(await handle.getFile());
    }
  }
  if (!files.length) {
    // Nested id1/
    try {
      const id1 = await dir.getDirectoryHandle('id1');
      for await (const [name, handle] of id1.entries()) {
        if (handle.kind !== 'file') continue;
        const lower = name.toLowerCase();
        if (lower === 'pak0.pak' || lower === 'pak1.pak') {
          files.push(await handle.getFile());
        }
      }
    } catch {
      /* no id1 subdir */
    }
  }
  if (!files.length) {
    throw new Error('No pak0.pak / pak1.pak found in selected folder (prefer both; pak1 = full game)');
  }
  return files;
}

/**
 * Show error panel with a "Choose Quake data…" button.
 * @param {string} message
 * @returns {Promise<'pick'|null>}
 */
export function showFsPickerPrompt(message) {
  return new Promise((resolve) => {
    const el = document.getElementById('error');
    if (!el) {
      resolve(null);
      return;
    }
    el.textContent = '';
    const text = document.createElement('div');
    text.textContent = message;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Choose Quake data…';
    btn.style.cssText =
      'margin-top:16px;padding:10px 18px;font:inherit;cursor:pointer;background:#3a342c;color:#f0e6d8;border:1px solid #5a5040;';
    btn.addEventListener('click', () => {
      el.classList.remove('visible');
      resolve('pick');
    });
    el.append(text, btn);
    el.classList.add('visible');
  });
}
