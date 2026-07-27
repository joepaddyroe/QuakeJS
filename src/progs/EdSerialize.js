/**
 * ED_Write / ED_Parse / PR_UglyValueString subset for savegames text.
 */

import {
  EV_STRING,
  EV_FLOAT,
  EV_VECTOR,
  EV_ENTITY,
  EV_FIELD,
  EV_FUNCTION,
} from './Progs.js';

export const DEF_SAVEGLOBAL = 0x8000;

const TYPE_SIZE = {
  [EV_STRING]: 1,
  [EV_FLOAT]: 1,
  [EV_VECTOR]: 3,
  [EV_ENTITY]: 1,
  [EV_FIELD]: 1,
  [EV_FUNCTION]: 1,
};

/**
 * @param {import('./Progs.js').Progs} progs
 * @param {number} type
 * @param {Float32Array} fieldsF
 * @param {Int32Array} fieldsI
 * @param {number} baseIdx flat index into fields
 */
export function uglyValueString(progs, type, fieldsF, fieldsI, baseIdx) {
  const t = type & ~DEF_SAVEGLOBAL;
  switch (t) {
    case EV_STRING:
      return progs.stringAt(fieldsI[baseIdx]);
    case EV_ENTITY:
      return String(fieldsI[baseIdx] | 0);
    case EV_FUNCTION: {
      const fn = fieldsI[baseIdx] | 0;
      const f = progs.functions[fn];
      return f ? progs.getString(f.s_name) : '';
    }
    case EV_FIELD: {
      const ofs = fieldsI[baseIdx] | 0;
      for (const def of progs.fielddefs) {
        if (def.ofs === ofs) return progs.getString(def.s_name);
      }
      return String(ofs);
    }
    case EV_FLOAT:
      return String(fieldsF[baseIdx]);
    case EV_VECTOR:
      return `${fieldsF[baseIdx]} ${fieldsF[baseIdx + 1]} ${fieldsF[baseIdx + 2]}`;
    default:
      return `bad type ${t}`;
  }
}

/**
 * @param {import('./Progs.js').Progs} progs
 * @param {import('./Edicts.js').EdictStore} edicts
 * @param {number} ent
 * @returns {string}
 */
export function writeEdict(progs, edicts, ent) {
  let out = '{\n';
  if (edicts.free[ent]) {
    out += '}\n';
    return out;
  }
  for (let i = 1; i < progs.fielddefs.length; i++) {
    const d = progs.fielddefs[i];
    const name = progs.getString(d.s_name);
    if (!name || name.length >= 2 && name[name.length - 2] === '_') continue;
    const type = d.type & ~DEF_SAVEGLOBAL;
    const size = TYPE_SIZE[type] || 1;
    const base = edicts.idx(ent, d.ofs);
    let nonzero = false;
    for (let j = 0; j < size; j++) {
      if (edicts.fieldsI[base + j]) {
        nonzero = true;
        break;
      }
    }
    if (!nonzero) continue;
    const val = uglyValueString(progs, d.type, edicts.fields, edicts.fieldsI, base);
    out += `"${name}" "${escapeQuotes(val)}"\n`;
  }
  out += '}\n';
  return out;
}

/**
 * @param {import('./Progs.js').Progs} progs
 * @returns {string}
 */
export function writeGlobals(progs) {
  let out = '{\n';
  for (const def of progs.globaldefs) {
    if (!(def.type & DEF_SAVEGLOBAL)) continue;
    const type = def.type & ~DEF_SAVEGLOBAL;
    if (type !== EV_STRING && type !== EV_FLOAT && type !== EV_ENTITY) continue;
    const name = progs.getString(def.s_name);
    if (!name) continue;
    const val = uglyValueString(
      progs,
      type,
      progs.globalsF,
      progs.globalsI,
      def.ofs,
    );
    out += `"${name}" "${escapeQuotes(val)}"\n`;
  }
  out += '}\n';
  return out;
}

/**
 * @param {string} s
 */
function escapeQuotes(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Parse brace blocks from save text starting at index.
 * @param {string} text
 * @param {number} start
 * @returns {{ block: string, next: number } | null}
 */
export function nextBraceBlock(text, start) {
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length) return null;
  if (text[i] !== '{') return null;
  let depth = 0;
  const begin = i;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        return { block: text.slice(begin, i + 1), next: i + 1 };
      }
    }
  }
  return null;
}

/**
 * Parse "key" "value" pairs inside a brace block (without outer braces).
 * @param {string} block
 * @returns {{ key: string, value: string }[]}
 */
export function parseEpairs(block) {
  let body = block.trim();
  if (body.startsWith('{')) body = body.slice(1);
  if (body.endsWith('}')) body = body.slice(0, -1);
  /** @type {{ key: string, value: string }[]} */
  const pairs = [];
  let i = 0;
  const s = body;
  const readQuoted = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length || s[i] !== '"') return null;
    i++;
    let out = '';
    while (i < s.length && s[i] !== '"') {
      if (s[i] === '\\' && i + 1 < s.length) {
        i++;
        out += s[i] === 'n' ? '\n' : s[i];
        i++;
        continue;
      }
      out += s[i++];
    }
    if (i < s.length) i++;
    return out;
  };
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const key = readQuoted();
    const value = readQuoted();
    if (key == null || value == null) break;
    pairs.push({ key, value });
  }
  return pairs;
}

/**
 * ED_ParseEpair for edict fields or globals.
 * @param {import('./Progs.js').Progs} progs
 * @param {Float32Array} fArr
 * @param {Int32Array} iArr
 * @param {number} ofs
 * @param {number} type
 * @param {string} value
 */
export function parseEpair(progs, fArr, iArr, ofs, type, value) {
  const t = type & ~DEF_SAVEGLOBAL;
  switch (t) {
    case EV_STRING:
      iArr[ofs] = progs.allocString(value);
      break;
    case EV_FLOAT:
      fArr[ofs] = parseFloat(value) || 0;
      break;
    case EV_VECTOR: {
      const p = value.trim().split(/\s+/).map(Number);
      fArr[ofs] = p[0] || 0;
      fArr[ofs + 1] = p[1] || 0;
      fArr[ofs + 2] = p[2] || 0;
      break;
    }
    case EV_ENTITY:
      iArr[ofs] = parseInt(value, 10) || 0;
      break;
    case EV_FUNCTION:
      iArr[ofs] = progs.findFunction(value) || 0;
      break;
    case EV_FIELD: {
      const fd = progs.fieldByName.get(value);
      iArr[ofs] = fd ? fd.ofs : 0;
      break;
    }
    default:
      break;
  }
}

/**
 * Apply epairs onto an edict (cleared first by caller).
 * @param {import('./Progs.js').Progs} progs
 * @param {import('./Edicts.js').EdictStore} edicts
 * @param {number} ent
 * @param {{ key: string, value: string }[]} pairs
 */
export function applyEdictPairs(progs, edicts, ent, pairs) {
  for (const { key, value } of pairs) {
    const fd = progs.fieldByName.get(key);
    if (!fd) continue;
    parseEpair(
      progs,
      edicts.fields,
      edicts.fieldsI,
      edicts.idx(ent, fd.ofs),
      fd.type,
      value,
    );
  }
}

/**
 * @param {import('./Progs.js').Progs} progs
 * @param {{ key: string, value: string }[]} pairs
 */
export function applyGlobalPairs(progs, pairs) {
  for (const { key, value } of pairs) {
    const def = progs.globaldefs.find((d) => progs.getString(d.s_name) === key);
    if (!def) continue;
    parseEpair(progs, progs.globalsF, progs.globalsI, def.ofs, def.type, value);
  }
}
