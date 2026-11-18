import assert from 'node:assert/strict';
import { test } from 'node:test';
import { holdPaintsDuringPress, paintWhenNoPress } from '../src/dom.ts';

/** The page as an event target, with the hold installed on it. */
const page = new EventTarget();
holdPaintsDuringPress(page);
const send = (target: EventTarget, type: string, more: Record<string, unknown> = {}) => target.dispatchEvent(Object.assign(new Event(type), more));
/** Lets the tasks queued so far run. */
const nextTask = (ms = 0) => new Promise(done => setTimeout(done, ms));

test('A paint asked for while a pointer button is held waits for the release and its click, and runs once however often it was asked', async () => {
  const drawn: string[] = [];
  const draw = () => drawn.push('draw');
  paintWhenNoPress(draw);
  assert.deepEqual(drawn, ['draw'], 'with nothing pressed it runs at once');
  send(page, 'pointerdown', { button: 0 });
  paintWhenNoPress(draw); paintWhenNoPress(draw);
  assert.deepEqual(drawn, ['draw'], 'held while the button is down');
  send(page, 'pointerup');
  // A browser may dispatch the release's click in a task of its own, after the release's.
  await nextTask();
  assert.deepEqual(drawn, ['draw'], 'still held after the release, until its click, so the click runs on the pressed element');
  send(page, 'click');
  await nextTask();
  assert.deepEqual(drawn, ['draw', 'draw'], 'then drawn once');
});

test('A click before the release (another control clicked from code during the press) does not end the hold', async () => {
  const drawn: string[] = [];
  send(page, 'pointerdown', { button: 0 });
  send(page, 'click');
  paintWhenNoPress(() => drawn.push('draw'));
  await nextTask();
  assert.deepEqual(drawn, [], 'still held: that click is not the release’s');
  send(page, 'pointerup'); send(page, 'click');
  await nextTask();
  assert.deepEqual(drawn, ['draw']);
});

test('A release that fires no click (a drag) ends the hold a moment later', async () => {
  const drawn: string[] = [];
  send(page, 'pointerdown', { button: 0 });
  paintWhenNoPress(() => drawn.push('draw'));
  send(page, 'pointerup');
  await nextTask();
  assert.deepEqual(drawn, []);
  await nextTask(150);
  assert.deepEqual(drawn, ['draw']);
});

test('A paint the release’s own click asks for runs at once, and the one owed from the press is then not drawn again', async () => {
  const drawn: string[] = [];
  const draw = () => drawn.push('draw');
  send(page, 'pointerdown', { button: 0 });
  paintWhenNoPress(draw);
  send(page, 'pointerup');
  send(page, 'click');
  // The click's handler: the hold ended as the click was seen, before its handlers.
  paintWhenNoPress(draw);
  await nextTask();
  assert.deepEqual(drawn, ['draw']);
});

test('Only a cancelled pointer ends the hold before its release: not a move, the window losing focus or the page hidden', async () => {
  const drawn: string[] = [];
  send(page, 'pointerdown', { button: 0 });
  paintWhenNoPress(() => drawn.push('draw'));
  // A move as the browser sends after a change under the pointer, the focus going to another window, the window covered.
  for (const type of ['pointermove', 'blur', 'visibilitychange']) send(page, type, { buttons: 0 });
  await nextTask();
  assert.deepEqual(drawn, [], 'still held: the release still comes back to the window that was pressed');
  send(page, 'pointercancel');
  await nextTask();
  assert.deepEqual(drawn, ['draw']);
});

test('A press of another button, or on a native list, holds nothing: a menu or a popup may take its release', () => {
  const drawn: string[] = [];
  send(page, 'pointerdown', { button: 2 });
  paintWhenNoPress(() => drawn.push('draw'));
  // A press on a select: its target says it is inside one.
  const onList = new Event('pointerdown');
  Object.defineProperties(onList, { button: { value: 0 }, target: { value: { closest: (selector: string) => (selector === 'select' ? {} : null) } } });
  page.dispatchEvent(onList);
  paintWhenNoPress(() => drawn.push('draw'));
  assert.deepEqual(drawn, ['draw', 'draw']);
});
