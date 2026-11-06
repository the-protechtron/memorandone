import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, emptyStore, readStore, selectQueue, taskReason, type TaskInput } from "./tasks.ts";

const now = new Date("2026-11-06T10:00:00.000Z");
const input = (title: string, extra: Partial<TaskInput> = {}): TaskInput => ({ title, notes: "", topic: "", dueDate: "", importance: "normal", blockedBy: "", ...extra });

test("capture, ranking, focus, deferral, completion and topic history keep their state", () => {
  let store = applyAction(emptyStore(), { type: "add", input: input("Draft proposal", { topic: "Client", importance: "high" }) }, now);
  const draftId = store.tasks[0].id;
  store = applyAction(store, { type: "add", input: input("Send proposal", { topic: "Client", dueDate: "2026-11-06", blockedBy: draftId }) }, now);
  const sendId = store.tasks[0].id;
  assert.deepEqual(selectQueue(store, now).map(task => task.id), [draftId]);
  assert.equal(taskReason(store.tasks[1], store.tasks, now), "Unblocks another task");
  store = applyAction(store, { type: "focus", id: draftId }, now);
  assert.equal(store.focusId, draftId);
  store = applyAction(store, { type: "complete", id: draftId }, now);
  assert.equal(store.focusId, "");
  assert.deepEqual(selectQueue(store, now).map(task => task.id), [sendId]);
  store = applyAction(store, { type: "defer", id: sendId, until: "2026-11-07T09:00:00.000Z" }, now);
  assert.equal(selectQueue(store, now).length, 0);
  assert.equal(selectQueue(store, new Date("2026-11-07T09:01:00.000Z")).length, 1);
  store = applyAction(store, { type: "abandon", id: sendId }, now);
  assert.equal(store.tasks.filter(task => task.topic === "Client" && task.status !== "open").length, 2);
  assert.equal(store.events.filter(event => event.taskId === sendId).map(event => event.type).join(","), "abandoned,deferred,created");
  assert.deepEqual(readStore(JSON.stringify(store)), store);
});

test("invalid titles, blockers and saved data are rejected", () => {
  let store = applyAction(emptyStore(), { type: "add", input: input("First") }, now);
  const firstId = store.tasks[0].id;
  store = applyAction(store, { type: "add", input: input("Second", { blockedBy: firstId }) }, now);
  const secondId = store.tasks[0].id;
  assert.throws(() => applyAction(store, { type: "edit", id: firstId, input: input("First", { blockedBy: secondId }) }, now), /blocking loop/);
  assert.throws(() => applyAction(store, { type: "add", input: input("   ") }, now), /title/);
  assert.throws(() => applyAction(store, { type: "defer", id: secondId, until: now.toISOString() }, now), /future/);
  assert.throws(() => readStore('{"version":2}'), /Saved data/);
  assert.throws(() => readStore(JSON.stringify({ ...store, tasks: [{ ...store.tasks[0], createdAt: "not-a-date" }] })), /invalid task/);
});

test("due dates lead the queue, while a manual move and reset remain reversible", () => {
  let store = applyAction(emptyStore(), { type: "add", input: input("Someday", { importance: "high" }) }, now);
  const somedayId = store.tasks[0].id;
  store = applyAction(store, { type: "add", input: input("Today", { dueDate: "2026-11-06" }) }, now);
  const todayId = store.tasks[0].id;
  assert.deepEqual(selectQueue(store, now).map(task => task.id), [todayId, somedayId]);
  store = applyAction(store, { type: "focus", id: somedayId }, now);
  assert.deepEqual(selectQueue(store, now).map(task => task.id), [todayId, somedayId]);
  store = applyAction(store, { type: "reorder", id: somedayId, direction: -1 }, now);
  assert.deepEqual(selectQueue(store, now).map(task => task.id), [somedayId, todayId]);
  store = applyAction(store, { type: "reset-order" }, now);
  assert.deepEqual(selectQueue(store, now).map(task => task.id), [todayId, somedayId]);
});
