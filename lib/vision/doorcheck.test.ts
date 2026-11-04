import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoxes, readRoomNumber, verdict, kindFor, cabinVerdict, assignBoxes, type Box } from './doorcheck.ts';

// Real SAM 3.1 output for a rendered door (scripts' go/no-go test, 2026-11-01).
const SAM = '<|box;x1=419;y1=137;x2=656;y2=641;w=1024;h=768;c=0.9024390578269958|>';

test('parses SAM boxes, best first, skipping junk', () => {
  const boxes = parseBoxes(`${'<|box;x1=1;y1=2;x2=3;y2=4;w=10;h=10;c=0.6|>'}${SAM}<|box;x1=oops|>`);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[0], { x1: 419, y1: 137, x2: 656, y2: 641, w: 1024, h: 768, c: 0.9024390578269958 });
  assert.deepEqual(parseBoxes(''), []);
});

test('reads the room number out of a chatty answer', () => {
  assert.equal(readRoomNumber('804'), '804');
  assert.equal(readRoomNumber('The sign says 804.'), '804');
  assert.equal(readRoomNumber('I cannot see a number'), null);
  assert.equal(readRoomNumber('1204'), '1204');
  assert.equal(readRoomNumber('80456'), null);
});

const door = parseBoxes(SAM)[0];
const weak: Box = { ...door, c: 0.3 };

test('verdict: confirmed needs the door and the right number', () => {
  assert.equal(verdict('804', { door, sign: null, number: '804', ms: 0 }), 'confirmed');
  assert.equal(verdict('804', { door, sign: null, number: '806', ms: 0 }), 'wrong_door');
  assert.equal(verdict('804', { door: null, sign: null, number: '804', ms: 0 }), 'unsure');
  assert.equal(verdict('804', { door: weak, sign: null, number: '804', ms: 0 }), 'unsure');
  assert.equal(verdict('804', { door, sign: null, number: null, ms: 0 }), 'unsure');
});

test('order items map to the model in the cabin', () => {
  assert.equal(kindFor('towel'), 'towel');
  assert.equal(kindFor('bath towel set'), 'towel');
  assert.equal(kindFor('uber eats order'), 'food_bag');
  assert.equal(kindFor('nasi lemak'), 'food_bag');
  assert.equal(kindFor('sparkling water'), 'water');
  assert.equal(kindFor('phone charger, usb-c'), null);
});

test('a cabin only counts as empty if every check really ran', () => {
  assert.equal(cabinVerdict({ found: { towel: null, food_bag: null }, failed: [], ms: 0 }), 'empty');
  assert.equal(cabinVerdict({ found: { towel: door, food_bag: null }, failed: [], ms: 0 }), 'occupied');
  assert.equal(cabinVerdict({ found: { towel: null }, failed: ['food_bag'], ms: 0 }), 'unknown');
  assert.equal(cabinVerdict({ found: { towel: door }, failed: ['food_bag'], ms: 0 }), 'occupied');
});

test('one object is never two items: "towel" landing on the bag falls back to the towel', () => {
  const bag: Box = { x1: 0, y1: 115, x2: 310, y2: 361, w: 640, h: 480, c: 0.89 };
  const towel: Box = { x1: 335, y1: 118, x2: 639, y2: 414, w: 640, h: 480, c: 0.75 };
  const onBag: Box = { ...bag, x2: 305, c: 0.68 };
  const found = assignBoxes({ towel: [onBag, towel], food_bag: [bag] });
  assert.deepEqual(found.food_bag, bag);
  assert.deepEqual(found.towel, towel);
  assert.deepEqual(assignBoxes({ towel: [onBag], food_bag: [bag] }).towel, null);
  assert.deepEqual(assignBoxes({ towel: [], food_bag: [] }), { towel: null, food_bag: null });
});
