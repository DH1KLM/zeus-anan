// SPDX-License-Identifier: GPL-2.0-or-later
//
// ANAN Core — Protocol-2 SDR for the ANAN.
// Copyright (C) 2026 Apache Labs.
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the
// Free Software Foundation, either version 2 of the License, or (at your
// option) any later version. See the LICENSE file at the root of this
// repository for the full text, or https://www.gnu.org/licenses/.
//
// Loupe history — the last few seconds of waterfall rows, per receiver, kept
// CPU-side so the tuning loupe can magnify recent history the instant it
// opens. The live waterfall lives in a GPU texture with no readback (no
// preserveDrawingBuffer), so the loupe cannot crop the rendered canvas; it
// re-draws from data instead. Each row keeps the geometry it arrived with,
// so rows recorded before a retune still land on the right frequency.
//
// Recording starts the first time a receiver's surface is touched (or at
// mount on a touch-first device such as the G2 glass) and then simply runs:
// one Float32Array copy per display frame, ring-bounded.

import { selectDisplaySlice, useDisplayStore, type SpectrumReceiver } from './display-store';
import { rxIndexOf } from './receiver-state';

export const LOUPE_HISTORY_ROWS = 72;

export type LoupeRow = {
  centerHz: number;
  hzPerPixel: number;
  bins: Float32Array;
};

type Ring = {
  rows: LoupeRow[];
  lastBins: Float32Array | null;
  unsubscribe: () => void;
};

const rings = new Map<number, Ring>();

/** Start recording waterfall rows for a receiver (idempotent). */
export function ensureLoupeHistory(receiver: SpectrumReceiver): void {
  const idx = rxIndexOf(receiver);
  if (rings.has(idx)) return;
  const ring: Ring = { rows: [], lastBins: null, unsubscribe: () => {} };
  ring.unsubscribe = useDisplayStore.subscribe((state) => {
    const s = selectDisplaySlice(state, receiver);
    const bins = s.wfDb ?? s.panDb;
    if (!bins || bins === ring.lastBins || s.hzPerPixel <= 0) return;
    ring.lastBins = bins;
    pushLoupeRow(ring.rows, {
      centerHz: Number(s.centerHz),
      hzPerPixel: s.hzPerPixel,
      // Frames may reuse their buffers; keep our own copy.
      bins: new Float32Array(bins),
    });
  });
  rings.set(idx, ring);
}

/** Newest-first rows for a receiver (empty until recording has started). */
export function loupeRows(receiver: SpectrumReceiver): readonly LoupeRow[] {
  return rings.get(rxIndexOf(receiver))?.rows ?? [];
}

/** Ring insert, newest first. Exported for tests. */
export function pushLoupeRow(rows: LoupeRow[], row: LoupeRow, cap = LOUPE_HISTORY_ROWS): void {
  rows.unshift(row);
  if (rows.length > cap) rows.length = cap;
}

/** Test-only: stop every recorder and forget all rows. */
export function _resetLoupeHistoryForTest(): void {
  for (const r of rings.values()) r.unsubscribe();
  rings.clear();
}
