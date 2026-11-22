# Tiny Stack VM

A fast, compliant TypeScript implementation of make.fun's Tiny Stack ISA (v1) for Node 22.

## Overview
- Implements all opcodes (0x00 - 0x53) conforming to the Tiny Stack ISA.
- Accurate stack, memory, call-depth, step, and output bound enforcement with strict trap handling.
- Zero dependencies, native Node 22 execution.
