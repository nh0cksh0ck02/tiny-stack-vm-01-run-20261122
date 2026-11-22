import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STACK_MAX = 256;
const CALLS_MAX = 64;
const MEMORY_WORDS = 256;
const STEP_LIMIT = 1_000_000;
const OUTPUT_MAX = 65_536;

const TABLE = new Int32Array(256);
const OPS = [
  0x00, 0, 0, 0, 0x01, 1, 0, 1, 0x02, 4, 0, 1, 0x03, 0, 1, 0,
  0x04, 0, 1, 2, 0x05, 0, 2, 2, 0x06, 0, 2, 3, 0x07, 0, 3, 3,
  0x10, 0, 2, 1, 0x11, 0, 2, 1, 0x12, 0, 2, 1, 0x13, 0, 2, 1,
  0x14, 0, 2, 1, 0x15, 0, 2, 1, 0x16, 0, 2, 1, 0x17, 0, 1, 1,
  0x18, 0, 2, 1, 0x19, 0, 2, 1, 0x1a, 0, 2, 1, 0x1b, 0, 1, 1,
  0x1c, 0, 2, 1, 0x1d, 0, 2, 1, 0x1e, 0, 2, 1, 0x20, 0, 2, 1,
  0x21, 0, 2, 1, 0x22, 0, 2, 1, 0x30, 2, 0, 0, 0x31, 2, 1, 0,
  0x32, 2, 1, 0, 0x33, 2, 0, 0, 0x34, 0, 0, 0, 0x40, 0, 1, 1,
  0x41, 0, 2, 0, 0x50, 0, 1, 0, 0x51, 0, 1, 0, 0x52, 0, 0, 1,
  0x53, 0, 1, 0,
];
for (let i = 0; i < OPS.length; i += 4) {
  TABLE[OPS[i]] = 0x1000 | (OPS[i + 3] << 8) | (OPS[i + 2] << 4) | OPS[i + 1];
}

function run(p: Uint8Array, inp: Uint8Array): { stdout: Uint8Array; exit: number } {
  const n = p.length;
  const D = new Int32Array(STACK_MAX);
  let sp = 0;
  const C = new Int32Array(CALLS_MAX);
  let csp = 0;
  const M = new Int32Array(MEMORY_WORDS);
  const out = new Uint8Array(OUTPUT_MAX);
  let olen = 0;
  let inPos = 0;
  let pc = 0;
  let steps = 0;

  const res = (exit: number) => ({ stdout: out.subarray(0, olen), exit });

  for (;;) {
    if (steps === STEP_LIMIT) return res(10);
    if (pc < 0 || pc >= n) return res(9);
    const op = p[pc];
    const info = TABLE[op];
    if (info === 0) return res(5);
    const imm = info & 7;
    const pops = (info >> 4) & 7;
    const pushes = (info >> 8) & 7;
    if (pc + imm >= n) return res(9);
    steps++;
    const next = pc + 1 + imm;
    if (sp < pops) return res(2);
    if (sp - pops + pushes > STACK_MAX) return res(3);
    pc = next;

    switch (op) {
      case 0x00: return res(0);
      case 0x01: D[sp++] = (p[next - 1] << 24) >> 24; break;
      case 0x02:
        D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24);
        break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: {
        const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t;
        break;
      }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: {
        const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a;
        break;
      }
      case 0x10: D[sp - 2] = (D[sp - 2] + D[sp - 1]) | 0; sp--; break;
      case 0x11: D[sp - 2] = (D[sp - 2] - D[sp - 1]) | 0; sp--; break;
      case 0x12: D[sp - 2] = Math.imul(D[sp - 2], D[sp - 1]); sp--; break;
      case 0x13:
      case 0x14:
      case 0x15:
      case 0x16: {
        const b = D[--sp], a = D[--sp];
        if (b === 0) return res(4);
        D[sp++] = op === 0x13 ? (a === -2147483648 && b === -1 ? a : (a / b) | 0)
          : op === 0x14 ? (b === -1 ? 0 : (a % b) | 0)
          : op === 0x15 ? Math.floor((a >>> 0) / (b >>> 0)) | 0
          : ((a >>> 0) % (b >>> 0)) | 0;
        break;
      }
      case 0x17: D[sp - 1] = (-D[sp - 1]) | 0; break;
      case 0x18: D[sp - 2] &= D[sp - 1]; sp--; break;
      case 0x19: D[sp - 2] |= D[sp - 1]; sp--; break;
      case 0x1a: D[sp - 2] ^= D[sp - 1]; sp--; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x1c: D[sp - 2] <<= (D[sp - 1] & 31); sp--; break;
      case 0x1d: D[sp - 2] >>= (D[sp - 1] & 31); sp--; break;
      case 0x1e: D[sp - 2] = (D[sp - 2] >>> (D[sp - 1] & 31)) | 0; sp--; break;
      case 0x20: D[sp - 2] = D[sp - 2] === D[sp - 1] ? 1 : 0; sp--; break;
      case 0x21: D[sp - 2] = D[sp - 2] < D[sp - 1] ? 1 : 0; sp--; break;
      case 0x22: D[sp - 2] = (D[sp - 2] >>> 0) < (D[sp - 1] >>> 0) ? 1 : 0; sp--; break;
      case 0x30:
      case 0x31:
      case 0x32: {
        const rel = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) {
          const v = D[--sp];
          take = op === 0x31 ? v === 0 : v !== 0;
        }
        if (take) pc = next + rel;
        break;
      }
      case 0x33:
        if (csp === 64) return res(7);
        C[csp++] = next;
        pc = p[next - 2] | (p[next - 1] << 8);
        break;
      case 0x34:
        if (csp === 0) return res(8);
        pc = C[--csp];
        break;
      case 0x40: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return res(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: {
        const addr = D[sp - 1];
        const v = D[sp - 2];
        if (addr < 0 || addr >= 256) return res(6);
        sp -= 2;
        M[addr] = v;
        break;
      }
      case 0x50: {
        const s = String(D[--sp]);
        if (olen + s.length > 65536) return res(11);
        for (let i = 0; i < s.length; i++) out[olen++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (olen + 1 > 65536) return res(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 0x52:
        D[sp++] = inPos < inp.length ? inp[inPos++] : -1;
        break;
      case 0x53:
        return res(D[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

for (const id of readdirSync(I).sort()) {
  const p = readFileSync(join(I, id, 'program.bin'));
  const inp = readFileSync(join(I, id, 'input.bin'));
  const r = run(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), new Uint8Array(inp.buffer, inp.byteOffset, inp.byteLength));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.stdout);
  writeFileSync(join(O, id, 'exit.txt'), `${r.exit}\n`);
}
