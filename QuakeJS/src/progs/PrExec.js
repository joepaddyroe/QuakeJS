/**
 * QuakeC interpreter (pr_exec.c PR_ExecuteProgram).
 */

import {
  OFS_RETURN,
  OFS_PARM0,
} from './Progs.js';

const MAX_STACK_DEPTH = 32;
const LOCALSTACK_SIZE = 2048;

const OP = {
  DONE: 0,
  MUL_F: 1,
  MUL_V: 2,
  MUL_FV: 3,
  MUL_VF: 4,
  DIV_F: 5,
  ADD_F: 6,
  ADD_V: 7,
  SUB_F: 8,
  SUB_V: 9,
  EQ_F: 10,
  EQ_V: 11,
  EQ_S: 12,
  EQ_E: 13,
  EQ_FNC: 14,
  NE_F: 15,
  NE_V: 16,
  NE_S: 17,
  NE_E: 18,
  NE_FNC: 19,
  LE: 20,
  GE: 21,
  LT: 22,
  GT: 23,
  LOAD_F: 24,
  LOAD_V: 25,
  LOAD_S: 26,
  LOAD_ENT: 27,
  LOAD_FLD: 28,
  LOAD_FNC: 29,
  ADDRESS: 30,
  STORE_F: 31,
  STORE_V: 32,
  STORE_S: 33,
  STORE_ENT: 34,
  STORE_FLD: 35,
  STORE_FNC: 36,
  STOREP_F: 37,
  STOREP_V: 38,
  STOREP_S: 39,
  STOREP_ENT: 40,
  STOREP_FLD: 41,
  STOREP_FNC: 42,
  RETURN: 43,
  NOT_F: 44,
  NOT_V: 45,
  NOT_S: 46,
  NOT_ENT: 47,
  NOT_FNC: 48,
  IF: 49,
  IFNOT: 50,
  CALL0: 51,
  CALL1: 52,
  CALL2: 53,
  CALL3: 54,
  CALL4: 55,
  CALL5: 56,
  CALL6: 57,
  CALL7: 58,
  CALL8: 59,
  STATE: 60,
  GOTO: 61,
  AND: 62,
  OR: 63,
  BITAND: 64,
  BITOR: 65,
};

export class PrExec {
  /**
   * @param {import('./Progs.js').Progs} progs
   * @param {import('./Edicts.js').EdictStore} edicts
   * @param {((num: number) => void)[]} builtins
   */
  constructor(progs, edicts, builtins) {
    this.progs = progs;
    this.edicts = edicts;
    this.builtins = builtins;
    this.argc = 0;
    this.xstatement = 0;
    this.xfunction = 0;
    /** @type {{ s: number, f: number }[]} */
    this.stack = [];
    this.localstack = new Int32Array(LOCALSTACK_SIZE);
    this.localstack_used = 0;
  }

  /**
   * Reset call/locals stacks (after a hard fault so later frames can run).
   */
  reset() {
    this.stack.length = 0;
    this.localstack_used = 0;
    this.xstatement = 0;
    this.xfunction = 0;
  }

  /**
   * @param {number} fnum function index
   */
  execute(fnum) {
    const progs = this.progs;
    const gf = progs.globalsF;
    const gi = progs.globalsI;
    const statements = progs.statements;
    const functions = progs.functions;
    const edicts = this.edicts;
    const ef = edicts.entityfields;

    if (!fnum || fnum >= functions.length) return;

    // Recover from a previous fault that left the VM wedged
    if (this.stack.length > 0 && this.stack.length >= MAX_STACK_DEPTH) {
      this.reset();
    }

    const exitDepth = this.stack.length;
    const exitLocals = this.localstack_used;
    let runaway = 100000;
    let s;

    try {
      s = this._enterFunction(fnum);
      while (--runaway > 0) {
        s++;
        this.xstatement = s;
        const st = statements[s];
        const a = st.a;
        const b = st.b;
        const c = st.c;

        switch (st.op) {
        case OP.ADD_F:
          gf[c] = gf[a] + gf[b];
          break;
        case OP.ADD_V:
          gf[c] = gf[a] + gf[b];
          gf[c + 1] = gf[a + 1] + gf[b + 1];
          gf[c + 2] = gf[a + 2] + gf[b + 2];
          break;
        case OP.SUB_F:
          gf[c] = gf[a] - gf[b];
          break;
        case OP.SUB_V:
          gf[c] = gf[a] - gf[b];
          gf[c + 1] = gf[a + 1] - gf[b + 1];
          gf[c + 2] = gf[a + 2] - gf[b + 2];
          break;
        case OP.MUL_F:
          gf[c] = gf[a] * gf[b];
          break;
        case OP.MUL_V:
          gf[c] = gf[a] * gf[b] + gf[a + 1] * gf[b + 1] + gf[a + 2] * gf[b + 2];
          break;
        case OP.MUL_FV:
          gf[c] = gf[a] * gf[b];
          gf[c + 1] = gf[a] * gf[b + 1];
          gf[c + 2] = gf[a] * gf[b + 2];
          break;
        case OP.MUL_VF:
          gf[c] = gf[b] * gf[a];
          gf[c + 1] = gf[b] * gf[a + 1];
          gf[c + 2] = gf[b] * gf[a + 2];
          break;
        case OP.DIV_F:
          gf[c] = gf[a] / gf[b];
          break;
        case OP.BITAND:
          gf[c] = (gf[a] | 0) & (gf[b] | 0);
          break;
        case OP.BITOR:
          gf[c] = (gf[a] | 0) | (gf[b] | 0);
          break;
        case OP.GE:
          gf[c] = gf[a] >= gf[b] ? 1 : 0;
          break;
        case OP.LE:
          gf[c] = gf[a] <= gf[b] ? 1 : 0;
          break;
        case OP.GT:
          gf[c] = gf[a] > gf[b] ? 1 : 0;
          break;
        case OP.LT:
          gf[c] = gf[a] < gf[b] ? 1 : 0;
          break;
        case OP.AND:
          gf[c] = gf[a] && gf[b] ? 1 : 0;
          break;
        case OP.OR:
          gf[c] = gf[a] || gf[b] ? 1 : 0;
          break;
        case OP.NOT_F:
          gf[c] = !gf[a] ? 1 : 0;
          break;
        case OP.NOT_V:
          gf[c] = !gf[a] && !gf[a + 1] && !gf[a + 2] ? 1 : 0;
          break;
        case OP.NOT_S:
          gf[c] = !gi[a] || !progs.stringAt(gi[a]) ? 1 : 0;
          break;
        case OP.NOT_FNC:
          gf[c] = !gi[a] ? 1 : 0;
          break;
        case OP.NOT_ENT:
          gf[c] = !gi[a] ? 1 : 0;
          break;
        case OP.EQ_F:
          gf[c] = gf[a] === gf[b] ? 1 : 0;
          break;
        case OP.EQ_V:
          gf[c] =
            gf[a] === gf[b] && gf[a + 1] === gf[b + 1] && gf[a + 2] === gf[b + 2]
              ? 1
              : 0;
          break;
        case OP.EQ_S:
          gf[c] =
            progs.stringAt(gi[a]) === progs.stringAt(gi[b]) ? 1 : 0;
          break;
        case OP.EQ_E:
        case OP.EQ_FNC:
          gf[c] = gi[a] === gi[b] ? 1 : 0;
          break;
        case OP.NE_F:
          gf[c] = gf[a] !== gf[b] ? 1 : 0;
          break;
        case OP.NE_V:
          gf[c] =
            gf[a] !== gf[b] || gf[a + 1] !== gf[b + 1] || gf[a + 2] !== gf[b + 2]
              ? 1
              : 0;
          break;
        case OP.NE_S:
          gf[c] =
            progs.stringAt(gi[a]) !== progs.stringAt(gi[b]) ? 1 : 0;
          break;
        case OP.NE_E:
        case OP.NE_FNC:
          gf[c] = gi[a] !== gi[b] ? 1 : 0;
          break;
        case OP.STORE_F:
        case OP.STORE_ENT:
        case OP.STORE_FLD:
        case OP.STORE_S:
        case OP.STORE_FNC:
          gi[b] = gi[a];
          break;
        case OP.STORE_V:
          gf[b] = gf[a];
          gf[b + 1] = gf[a + 1];
          gf[b + 2] = gf[a + 2];
          break;
        case OP.STOREP_F:
        case OP.STOREP_ENT:
        case OP.STOREP_FLD:
        case OP.STOREP_S:
        case OP.STOREP_FNC: {
          // b is global holding float-index into edict fields (from OP_ADDRESS)
          const ptr = gi[b];
          edicts.fieldsI[ptr] = gi[a];
          break;
        }
        case OP.STOREP_V: {
          const ptr = gi[b];
          edicts.fields[ptr] = gf[a];
          edicts.fields[ptr + 1] = gf[a + 1];
          edicts.fields[ptr + 2] = gf[a + 2];
          break;
        }
        case OP.ADDRESS: {
          // WinQuake: field ofs is *contents* of global st.b (ev_field), not st.b itself
          const ed = gi[a];
          gi[c] = ed * ef + gi[b];
          break;
        }
        case OP.LOAD_F:
        case OP.LOAD_FLD:
        case OP.LOAD_ENT:
        case OP.LOAD_S:
        case OP.LOAD_FNC: {
          const ed = gi[a];
          gi[c] = edicts.fieldsI[ed * ef + gi[b]];
          break;
        }
        case OP.LOAD_V: {
          const ed = gi[a];
          const base = ed * ef + gi[b];
          gf[c] = edicts.fields[base];
          gf[c + 1] = edicts.fields[base + 1];
          gf[c + 2] = edicts.fields[base + 2];
          break;
        }
        case OP.IFNOT:
          if (!gf[a]) s += b - 1;
          break;
        case OP.IF:
          if (gf[a]) s += b - 1;
          break;
        case OP.GOTO:
          s += a - 1;
          break;
        case OP.CALL0:
        case OP.CALL1:
        case OP.CALL2:
        case OP.CALL3:
        case OP.CALL4:
        case OP.CALL5:
        case OP.CALL6:
        case OP.CALL7:
        case OP.CALL8: {
          this.argc = st.op - OP.CALL0;
          const fnum = gi[a];
          if (!fnum) throw new Error('NULL function');
          const fn = functions[fnum];
          if (fn.first_statement < 0) {
            // Builtins must NOT overwrite xfunction — WinQuake keeps the QC caller
            // so OP_RETURN restores the correct locals (pr_exec.c OP_CALL*).
            const bi = -fn.first_statement;
            const builtin = this.builtins[bi];
            if (!builtin) throw new Error(`Bad builtin ${bi}`);
            builtin();
          } else {
            s = this._enterFunction(fnum);
          }
          break;
        }
        case OP.DONE:
        case OP.RETURN: {
          gf[OFS_RETURN] = gf[a];
          gf[OFS_RETURN + 1] = gf[a + 1];
          gf[OFS_RETURN + 2] = gf[a + 2];
          s = this._leaveFunction();
          if (this.stack.length === exitDepth) return;
          break;
        }
        case OP.STATE: {
          const self = gi[progs.ofs.self];
          edicts.setFloat(self, progs.f.frame, gf[a]);
          edicts.setInt(self, progs.f.think, gi[b]);
          edicts.setFloat(self, progs.f.nextthink, gf[progs.ofs.time] + 0.1);
          break;
        }
        default:
          throw new Error(`Bad opcode ${st.op} at ${s}`);
      }
    }
    throw new Error('runaway loop error');
    } catch (err) {
      // Hard reset — leaveFunction can itself be wrong if xfunction was corrupted
      this.stack.length = exitDepth;
      this.localstack_used = exitLocals;
      if (exitDepth === 0) {
        this.xfunction = 0;
        this.xstatement = 0;
      } else if (this.stack.length) {
        this.xfunction = this.stack[this.stack.length - 1].f;
      }
      throw err;
    }
  }

  /**
   * @param {number} fnum
   * @returns {number} statement index (before ++ in loop)
   */
  _enterFunction(fnum) {
    const progs = this.progs;
    const fn = progs.functions[fnum];
    const gi = progs.globalsI;

    if (this.stack.length >= MAX_STACK_DEPTH) {
      throw new Error('stack overflow');
    }
    this.stack.push({ s: this.xstatement, f: this.xfunction });

    const start = this.localstack_used;
    const locals = fn.locals;
    if (start + locals > LOCALSTACK_SIZE) {
      this.stack.pop();
      throw new Error('locals stack overflow');
    }
    for (let i = 0; i < locals; i++) {
      this.localstack[start + i] = gi[fn.parm_start + i];
    }
    this.localstack_used = start + locals;

    // Copy parameters
    let o = fn.parm_start;
    for (let i = 0; i < fn.numparms; i++) {
      for (let j = 0; j < fn.parm_size[i]; j++) {
        gi[o++] = gi[OFS_PARM0 + i * 3 + j];
      }
    }

    this.xfunction = fnum;
    return fn.first_statement - 1;
  }

  /**
   * @returns {number} resume statement
   */
  _leaveFunction() {
    const progs = this.progs;
    const fn = progs.functions[this.xfunction];
    const gi = progs.globalsI;

    if (!this.stack.length) {
      throw new Error('prog stack underflow');
    }

    const locals = fn ? fn.locals : 0;
    this.localstack_used -= locals;
    if (this.localstack_used < 0) this.localstack_used = 0;
    if (fn) {
      for (let i = 0; i < locals; i++) {
        gi[fn.parm_start + i] = this.localstack[this.localstack_used + i];
      }
    }

    const frame = this.stack.pop();
    this.xfunction = frame.f;
    this.xstatement = frame.s;
    return frame.s;
  }
}
