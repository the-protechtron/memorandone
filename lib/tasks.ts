export type Importance = "low" | "normal" | "high";
export type TaskStatus = "open" | "completed" | "abandoned";

export type Task = {
  id: string;
  title: string;
  notes: string;
  topic: string;
  dueDate: string;
  importance: Importance;
  blockedBy: string;
  deferredUntil: string;
  deferrals: number;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string;
};

export type TaskEvent = {
  id: string;
  taskId: string;
  type: "created" | "edited" | "focused" | "deferred" | "completed" | "abandoned" | "reordered";
  at: string;
  detail: string;
};

export type Store = {
  version: 1;
  tasks: Task[];
  events: TaskEvent[];
  focusId: string;
  manualOrder: string[];
};

export type TaskInput = Pick<Task, "title" | "notes" | "topic" | "dueDate" | "importance" | "blockedBy">;

export type Action =
  | { type: "add"; input: TaskInput }
  | { type: "edit"; id: string; input: TaskInput }
  | { type: "complete" | "abandon" | "focus" | "resume"; id: string }
  | { type: "defer"; id: string; until: string }
  | { type: "reorder"; id: string; direction: -1 | 1 }
  | { type: "reset-order" };

export const emptyStore = (): Store => ({ version: 1, tasks: [], events: [], focusId: "", manualOrder: [] });

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const validTime = (value: string) => !value || Number.isFinite(Date.parse(value));

export function readStore(raw: string): Store {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
      !("tasks" in value) || !Array.isArray(value.tasks) || !("events" in value) || !Array.isArray(value.events) ||
      !("focusId" in value) || typeof value.focusId !== "string" || !("manualOrder" in value) || !Array.isArray(value.manualOrder)) {
    throw new Error("Saved data could not be read. Export a backup before resetting browser storage.");
  }
  const store = value as Store;
  if (!store.manualOrder.every(id => typeof id === "string") ||
      store.tasks.some(task => !task || [task.id, task.title, task.notes, task.topic, task.dueDate, task.blockedBy, task.deferredUntil, task.createdAt, task.updatedAt, task.closedAt].some(field => typeof field !== "string") ||
        !task.id || !task.title || !task.createdAt || !task.updatedAt || !validTime(task.createdAt) || !validTime(task.updatedAt) || !validTime(task.closedAt) || !validTime(task.deferredUntil) ||
        !["open", "completed", "abandoned"].includes(task.status) || !["low", "normal", "high"].includes(task.importance) || !Number.isInteger(task.deferrals) || task.deferrals < 0) ||
      new Set(store.tasks.map(task => task.id)).size !== store.tasks.length ||
      store.events.some(item => !item || [item.id, item.taskId, item.type, item.at, item.detail].some(field => typeof field !== "string") ||
        !item.at || !["created", "edited", "focused", "deferred", "completed", "abandoned", "reordered"].includes(item.type) || !validTime(item.at))) {
    throw new Error("Saved data contains an invalid task or event.");
  }
  return store;
}

function cleanInput(input: TaskInput): TaskInput {
  const title = input.title.trim().slice(0, 160);
  if (!title) throw new Error("Add a task title.");
  if (!["low", "normal", "high"].includes(input.importance)) throw new Error("Choose a valid importance level.");
  if (input.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ||
      !Number.isFinite(Date.parse(`${input.dueDate}T12:00:00Z`)) || new Date(`${input.dueDate}T12:00:00Z`).toISOString().slice(0, 10) !== input.dueDate)) throw new Error("Choose a valid due date.");
  return {
    title,
    notes: input.notes.trim().slice(0, 2000),
    topic: input.topic.trim().slice(0, 60),
    dueDate: input.dueDate,
    importance: input.importance,
    blockedBy: input.blockedBy,
  };
}

function event(taskId: string, type: TaskEvent["type"], at: string, detail = ""): TaskEvent {
  return { id: crypto.randomUUID(), taskId, type, at, detail };
}

export function isBlocked(task: Task, tasks: Task[]): boolean {
  return !!task.blockedBy && tasks.some(other => other.id === task.blockedBy && other.status !== "completed");
}

function createsCycle(taskId: string, blockerId: string, tasks: Task[]): boolean {
  const seen = new Set<string>();
  let current = blockerId;
  while (current && !seen.has(current)) {
    if (current === taskId) return true;
    seen.add(current);
    current = tasks.find(task => task.id === current)?.blockedBy ?? "";
  }
  return false;
}

export function taskReason(task: Task, tasks: Task[], now = new Date()): string {
  const today = dateKey(now);
  const nextDay = new Date(now);
  nextDay.setDate(nextDay.getDate() + 1);
  const tomorrow = dateKey(nextDay);
  if (task.dueDate && task.dueDate < today) return "Overdue";
  if (task.dueDate === today) return "Due today";
  if (task.dueDate === tomorrow) return "Due tomorrow";
  if (tasks.some(other => other.blockedBy === task.id && other.status === "open")) return "Unblocks another task";
  if (task.importance === "high") return "High importance";
  if (task.deferrals >= 2) return "Deferred more than once";
  return task.topic ? `In ${task.topic}` : "Ready to work on";
}

function score(task: Task, tasks: Task[], now: Date): number {
  const today = dateKey(now);
  const daysUntilDue = task.dueDate ? Math.round((Date.parse(`${task.dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : 999;
  return (daysUntilDue < 0 ? 60 : daysUntilDue === 0 ? 50 : daysUntilDue === 1 ? 35 : daysUntilDue <= 3 ? 20 : 0) +
    (task.importance === "high" ? 25 : task.importance === "normal" ? 10 : 0) +
    Math.min(20, tasks.filter(other => other.blockedBy === task.id && other.status === "open").length * 10) +
    Math.min(12, task.deferrals * 4) +
    Math.min(10, Math.max(0, Math.floor((now.getTime() - Date.parse(task.createdAt)) / (7 * 86_400_000))));
}

export function selectQueue(store: Store, now = new Date()): Task[] {
  const actionable = store.tasks.filter(task => task.status === "open" &&
    (!task.deferredUntil || Date.parse(task.deferredUntil) <= now.getTime()) && !isBlocked(task, store.tasks));
  const order = new Map(store.manualOrder.map((id, index) => [id, index]));
  return actionable.sort((a, b) => {
    if (order.has(a.id) && order.has(b.id)) return order.get(a.id)! - order.get(b.id)!;
    if (order.has(a.id)) return -1;
    if (order.has(b.id)) return 1;
    return score(b, store.tasks, now) - score(a, store.tasks, now) || a.createdAt.localeCompare(b.createdAt);
  });
}

export function applyAction(store: Store, action: Action, now = new Date()): Store {
  const at = now.toISOString();
  if (action.type === "reset-order") return { ...store, manualOrder: [] };
  if (action.type === "add") {
    const input = cleanInput(action.input);
    if (input.blockedBy && !store.tasks.some(task => task.id === input.blockedBy && task.status === "open")) throw new Error("Choose an open task as the blocker.");
    const id = crypto.randomUUID();
    return { ...store, tasks: [{ ...input, id, status: "open", deferredUntil: "", deferrals: 0, createdAt: at, updatedAt: at, closedAt: "" }, ...store.tasks],
      events: [event(id, "created", at), ...store.events] };
  }
  const task = store.tasks.find(item => item.id === action.id);
  if (!task || task.status !== "open") throw new Error("This task is no longer open.");
  if (action.type === "reorder") {
    const ids = selectQueue(store, now).map(item => item.id);
    const index = ids.indexOf(action.id);
    const next = index + action.direction;
    if (index < 0 || next < 0 || next >= ids.length) return store;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    return { ...store, manualOrder: ids, events: [event(task.id, "reordered", at), ...store.events] };
  }
  if (action.type === "edit") {
    const input = cleanInput(action.input);
    if (input.blockedBy === task.id) throw new Error("A task cannot block itself.");
    if (input.blockedBy && !store.tasks.some(item => item.id === input.blockedBy && item.status === "open")) throw new Error("Choose an open task as the blocker.");
    if (input.blockedBy && createsCycle(task.id, input.blockedBy, store.tasks)) throw new Error("That would create a blocking loop.");
    return { ...store, tasks: store.tasks.map(item => item.id === task.id ? { ...item, ...input, updatedAt: at } : item),
      focusId: input.blockedBy && store.focusId === task.id ? "" : store.focusId,
      events: [event(task.id, "edited", at), ...store.events] };
  }
  if (action.type === "defer") {
    if (!Number.isFinite(Date.parse(action.until)) || Date.parse(action.until) <= now.getTime()) throw new Error("Choose a future time to defer this task.");
    return { ...store, tasks: store.tasks.map(item => item.id === task.id ? { ...item, deferredUntil: action.until, deferrals: item.deferrals + 1, updatedAt: at } : item),
      focusId: store.focusId === task.id ? "" : store.focusId, events: [event(task.id, "deferred", at, action.until), ...store.events] };
  }
  if (action.type === "focus") {
    if (isBlocked(task, store.tasks) || (task.deferredUntil && Date.parse(task.deferredUntil) > now.getTime())) throw new Error("This task is not ready to focus yet.");
    return { ...store, focusId: task.id, events: [event(task.id, "focused", at), ...store.events] };
  }
  if (action.type === "resume") {
    return { ...store, tasks: store.tasks.map(item => item.id === task.id ? { ...item, deferredUntil: "", updatedAt: at } : item),
      events: [event(task.id, "edited", at, "Brought back to queue"), ...store.events] };
  }
  const status = action.type === "complete" ? "completed" : "abandoned";
  return { ...store, tasks: store.tasks.map(item => item.id === task.id ? { ...item, status, updatedAt: at, closedAt: at } : item),
    focusId: store.focusId === task.id ? "" : store.focusId,
    manualOrder: store.manualOrder.filter(id => id !== task.id),
    events: [event(task.id, status, at), ...store.events] };
}
