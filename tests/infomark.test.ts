// Placing an info card inside the window (dom.ts cardPlace): below its mark by default, above near the foot, and
// 8 px inside the sides, including at the smallest window (860×528).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardPlace } from '../src/dom.ts';

const SMALLEST = { width: 860, height: 528 };
const CARD = { width: 280, height: 64 };
const markAt = (left: number, top: number) => ({ left, top, right: left + 20, bottom: top + 20 });

test('opens 4 px below its mark and aligned to its left when there is room', () => {
  assert.deepEqual(cardPlace(markAt(180, 120), CARD, SMALLEST), { left: 180, top: 144 });
});

test('at 860×528, a mark at the right edge slides the card 8 px inside the right side', () => {
  const place = cardPlace(markAt(832, 120), CARD, SMALLEST);
  assert.deepEqual(place, { left: 572, top: 144 });
  assert.ok(place.left >= 8 && place.left + CARD.width <= SMALLEST.width - 8);
});

test('at 860×528, a mark at the left edge keeps the card 8 px inside the left side', () => {
  const place = cardPlace(markAt(2, 120), CARD, SMALLEST);
  assert.deepEqual(place, { left: 8, top: 144 });
  assert.ok(place.left >= 8 && place.left + CARD.width <= SMALLEST.width - 8);
});

test('at 860×528, a mark at the foot flips the card 4 px above it, wholly inside the window', () => {
  const place = cardPlace(markAt(180, 488), CARD, SMALLEST);
  assert.deepEqual(place, { left: 180, top: 420 });
  assert.ok(place.top >= 8 && place.top + CARD.height <= SMALLEST.height - 8);
});

test('at the exact vertical and horizontal limits, below and unshifted hold; one pixel past flips or slides', () => {
  // Below fits when mark.bottom + 4 + card.height === view.height - 8 -> mark.bottom = 452 (top = 432).
  assert.deepEqual(cardPlace(markAt(572, 432), CARD, SMALLEST), { left: 572, top: 456 });
  assert.deepEqual(cardPlace(markAt(573, 433), CARD, SMALLEST), { left: 572, top: 365 });
});

test('a mark at the bottom-right corner flips above and slides inside the right edge together', () => {
  const place = cardPlace(markAt(836, 500), CARD, SMALLEST);
  assert.deepEqual(place, { left: 572, top: 432 });
  assert.ok(place.left >= 8 && place.left + CARD.width <= SMALLEST.width - 8);
  assert.ok(place.top >= 8 && place.top + CARD.height <= SMALLEST.height - 8);
});

test('when neither below nor above fits cleanly in a very short window, the card clamps on the roomier side', () => {
  // Room below (90 - 30 = 60) > room above (10): clamps below to maxTop = 90 - 8 - 60 = 22.
  assert.deepEqual(cardPlace(markAt(100, 10), { width: 200, height: 60 }, { width: 400, height: 90 }), { left: 100, top: 22 });
  // Room above (60) > room below (90 - 80 = 10): clamps above to CARD_EDGE = 8.
  assert.deepEqual(cardPlace(markAt(100, 60), { width: 200, height: 60 }, { width: 400, height: 90 }), { left: 100, top: 8 });
});

test('clears a taller block of text its mark heads: 4 px below the block, or 4 px above when short of room', () => {
  // Fault line beneath a label: card clears the block's last line and stays aligned to the mark's left.
  assert.deepEqual(cardPlace(markAt(180, 120), CARD, SMALLEST, { top: 120, bottom: 156 }), { left: 180, top: 160 });
  // Near the foot, no room below the block: flips 4 px above the block's first line.
  assert.deepEqual(cardPlace(markAt(180, 452), CARD, SMALLEST, { top: 452, bottom: 488 }), { left: 180, top: 384 });
});

test('in a view whose height ends at the status bar (500 px at 860×528), a panel card short of room below flips above its panel', () => {
  const aboveStatus = { width: 860, height: 500 };
  const panel = { top: 288, bottom: 444 };
  // Below would put a 69 px card at top 448..517 (over the 28 px status bar); ending view.height at 500 flips it 4 px above the panel.
  assert.deepEqual(cardPlace(markAt(353, 304), { width: 320, height: 69 }, aboveStatus, panel), { left: 353, top: 215 });
});
