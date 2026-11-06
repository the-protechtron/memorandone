"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { applyAction, emptyStore, isBlocked, readStore, selectQueue, taskReason, type Action, type Store, type Task, type TaskInput } from "@/lib/tasks";

const STORAGE_KEY = "memorandone:v1";
const THEME_KEY = "memorandone:theme";
const blankInput = (): TaskInput => ({ title: "", notes: "", topic: "", dueDate: "", importance: "normal", blockedBy: "" });

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function nextDefer(choice: "today" | "tomorrow", now = new Date()) {
  if (choice === "today") return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow.toISOString();
}

function friendlyDate(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function Home() {
  const [store, setStore] = useState<Store>(emptyStore);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<Store | null>(null);
  const [view, setView] = useState<"queue" | "history">("queue");
  const [topicFilter, setTopicFilter] = useState("");
  const [draft, setDraft] = useState<TaskInput>(blankInput);
  const [editingId, setEditingId] = useState("");
  const [deferId, setDeferId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setStore(readStore(saved));
      const savedTheme = localStorage.getItem(THEME_KEY);
      setTheme(savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
      setReady(true);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Saved data could not be read.");
    }
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
    catch { setStorageError("This browser could not save your tasks. Export your data before closing the page."); }
  }, [store, ready]);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* Tasks have their own save warning. */ }
  }, [theme, ready]);

  const queue = useMemo(() => selectQueue(store, clock), [store, clock]);
  const blocked = store.tasks.filter(task => task.status === "open" && isBlocked(task, store.tasks));
  const deferred = store.tasks.filter(task => task.status === "open" && task.deferredUntil && Date.parse(task.deferredUntil) > clock.getTime() && !isBlocked(task, store.tasks));
  const history = store.tasks.filter(task => task.status !== "open").sort((a, b) => b.closedAt.localeCompare(a.closedAt));
  const topics = [...new Set(store.tasks.map(task => task.topic).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const focusTask = store.tasks.find(task => task.id === store.focusId && task.status === "open");

  function act(action: Action, confirmation: string, canUndo = false) {
    try {
      const next = applyAction(store, action);
      if (next === store) return;
      setUndo(canUndo ? store : null);
      setStore(next);
      setMessage(confirmation);
      setDeferId("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The change could not be saved.");
    }
  }

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const wasEditing = !!editingId;
    try {
      const next = applyAction(store, wasEditing ? { type: "edit", id: editingId, input: draft } : { type: "add", input: draft });
      setStore(next);
      setUndo(null);
      setMessage(wasEditing ? "Task updated." : "Task added to your queue.");
      setDraft(blankInput());
      setEditingId("");
      setView("queue");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The task could not be saved.");
    }
  }

  function startEdit(task: Task) {
    setEditingId(task.id);
    setDraft({ title: task.title, notes: task.notes, topic: task.topic, dueDate: task.dueDate, importance: task.importance, blockedBy: task.blockedBy });
    document.getElementById("task-form")?.scrollIntoView({ block: "start" });
  }

  async function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error("Choose a JSON export smaller than 5 MB.");
      const imported = readStore(await file.text());
      if (store.tasks.length && !window.confirm("Importing will replace the tasks in this browser. Export them first if you need a copy. Continue?")) return;
      setUndo(store);
      setStore(imported);
      setMessage("Data imported.");
      setEditingId("");
      setDraft(blankInput());
      setView("queue");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The selected file could not be imported.");
    }
  }

  if (storageError && !ready) return <main className="storage-error"><h1>Your saved tasks need attention.</h1><p>{storageError}</p><button onClick={() => download("memorandone-raw-backup.json", localStorage.getItem(STORAGE_KEY) ?? "")}>Download raw backup</button></main>;
  if (!ready) return <main className="loading">Opening your desk…</main>;

  return <div className="shell">
    <aside className="sidebar" aria-label="Main navigation">
      <a className="brand" href="/">memorandone<span>.</span></a>
      <div className="sidebar-group">
        <button className={view === "queue" ? "nav-item active" : "nav-item"} onClick={() => { setView("queue"); setTopicFilter(""); }}>My queue <span>{queue.length}</span></button>
        <button className={view === "history" ? "nav-item active" : "nav-item"} onClick={() => { setView("history"); setTopicFilter(""); }}>History <span>{history.length}</span></button>
      </div>
      <div className="sidebar-heading">Topics</div>
      <div className="topic-nav">
        {topics.length ? topics.map(topic => <button key={topic} className={topicFilter === topic ? "topic-link selected" : "topic-link"} onClick={() => { setTopicFilter(topic); setView("history"); }}>{topic}</button>) : <p className="sidebar-empty">Topics appear here when you add one to a task.</p>}
      </div>
      <div className="sidebar-bottom"><p>Local preview · v0.1</p><button className="text-button" onClick={() => download(`memorandone-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store, null, 2))}>Export my data</button><button className="text-button" onClick={() => document.getElementById("import-file")?.click()}>Import data</button></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><span>Good to have you here.</span><div className="topbar-actions"><button className="text-button mobile-export" onClick={() => download(`memorandone-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store, null, 2))}>Export</button><button className="text-button mobile-export" onClick={() => document.getElementById("import-file")?.click()}>Import</button><button className="theme-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>{theme === "light" ? "Dark mode" : "Light mode"}</button></div></header>
      {view === "queue" ? <>
        <div className="page-heading"><div><h1>Today&apos;s queue</h1><p>Your work, in a clearer order.</p></div><span className="count-badge">{queue.length} ready</span></div>
        {focusTask && <section className="focus-banner" aria-label="Current focus"><div><span className="eyebrow">Current focus</span><strong>{focusTask.title}</strong><p>One thing at a time. You can finish it when you&apos;re ready.</p></div><button onClick={() => act({ type: "complete", id: focusTask.id }, "Task completed.", true)}>Mark done</button></section>}
        <div className="section-heading"><h2>Suggested order</h2>{store.manualOrder.length > 0 && <button className="text-button" onClick={() => act({ type: "reset-order" }, "Suggestion order restored.")}>Reset to suggestions</button>}</div>
        <p className="section-description">Based on due dates, importance, work this unblocks, and tasks you&apos;ve deferred. You can change the order.</p>
        {queue.length ? <ol className="task-list">{queue.map((task, index) => <li className="task-row" key={task.id}>
          <div className="task-number">{String(index + 1).padStart(2, "0")}</div>
          <div className="task-content"><div className="task-topline"><span className="task-reason">{store.focusId === task.id ? "In focus" : taskReason(task, store.tasks, clock)}</span>{task.topic && <span className="task-topic">{task.topic}</span>}</div><h3>{task.title}</h3>{task.notes && <p>{task.notes}</p>}{task.dueDate && <span className="task-meta">Due {new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
            {deferId === task.id && <div className="defer-choices"><span>Bring it back</span><button onClick={() => act({ type: "defer", id: task.id, until: nextDefer("today") }, "Task moved to later today.", true)}>Later today</button><button onClick={() => act({ type: "defer", id: task.id, until: nextDefer("tomorrow") }, "Task moved to tomorrow.", true)}>Tomorrow</button><button onClick={() => setDeferId("")} aria-label="Cancel deferral">Cancel</button></div>}
          </div>
          <div className="task-actions"><button className="action-primary" onClick={() => act({ type: "focus", id: task.id }, "Task set as your focus.", true)}>Do now</button><button onClick={() => setDeferId(deferId === task.id ? "" : task.id)}>Later</button><button onClick={() => act({ type: "complete", id: task.id }, "Task completed.", true)}>Done</button><div className="minor-actions"><button onClick={() => startEdit(task)}>Edit</button><button onClick={() => act({ type: "reorder", id: task.id, direction: -1 }, "Task moved up.")} disabled={index === 0}>Move up</button><button onClick={() => act({ type: "reorder", id: task.id, direction: 1 }, "Task moved down.")} disabled={index === queue.length - 1}>Move down</button><button onClick={() => act({ type: "abandon", id: task.id }, "Task moved to history as abandoned.", true)}>Abandon</button></div></div>
        </li>)}</ol> : <div className="empty-state"><h3>A clear desk starts here.</h3><p>Add one task, even if it&apos;s rough. You can add context later.</p><a href="#task-form">Add your first task</a></div>}
        {blocked.length > 0 && <section className="secondary-section"><h2>Waiting on</h2><p>These tasks return to the queue when their blocker is done.</p>{blocked.map(task => <div className="quiet-row" key={task.id}><div><strong>{task.title}</strong><span>Blocked by {store.tasks.find(item => item.id === task.blockedBy)?.title ?? "another task"}</span></div><button onClick={() => startEdit(task)}>Edit</button></div>)}</section>}
        {deferred.length > 0 && <section className="secondary-section"><h2>Later</h2><p>These return to the queue automatically.</p>{deferred.map(task => <div className="quiet-row" key={task.id}><div><strong>{task.title}</strong><span>Back {friendlyDate(task.deferredUntil)}</span></div><button onClick={() => act({ type: "resume", id: task.id }, "Task returned to the queue.")}>Bring back</button></div>)}</section>}
      </> : <>
        <div className="page-heading"><div><h1>Work you&apos;ve done</h1><p>Completed and abandoned tasks, kept with their context.</p></div><span className="count-badge">{history.length} recorded</span></div>
        <div className="history-filter"><label htmlFor="topic-filter">Topic</label><select id="topic-filter" value={topicFilter} onChange={event => setTopicFilter(event.target.value)}><option value="">All topics</option><option value="__none__">No topic</option>{topics.map(topic => <option key={topic} value={topic}>{topic}</option>)}</select></div>
        {history.filter(task => !topicFilter || (topicFilter === "__none__" ? !task.topic : task.topic === topicFilter)).length ?
          [...new Set(history.filter(task => !topicFilter || (topicFilter === "__none__" ? !task.topic : task.topic === topicFilter)).map(task => task.topic || "No topic"))].map(topic => <section className="history-group" key={topic}><h2>{topic}</h2>{history.filter(task => (task.topic || "No topic") === topic).map(task => <div className="history-row" key={task.id}><div><strong>{task.title}</strong><span>{task.status === "completed" ? "Completed" : "Abandoned"} · {new Date(task.closedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span></div><button onClick={() => setSelectedId(selectedId === task.id ? "" : task.id)}>{selectedId === task.id ? "Hide activity" : "View activity"}</button>{selectedId === task.id && <ul className="activity-list">{store.events.filter(item => item.taskId === task.id).map(item => <li key={item.id}><span>{item.type}{item.detail ? ` · ${item.detail}` : ""}</span><time>{friendlyDate(item.at)}</time></li>)}</ul>}</div>)}</section>) : <div className="empty-state"><h3>Nothing in history yet.</h3><p>Completed and abandoned tasks will be grouped here by topic.</p><button onClick={() => setView("queue")}>Back to queue</button></div>}
      </>}
    </main>

    <aside className="composer" id="task-form" aria-label={editingId ? "Edit task" : "Add a task"}><div className="composer-head"><span className="eyebrow">{editingId ? "Edit task" : "Quick capture"}</span><h2>{editingId ? "Make a change." : "Get it out of your head."}</h2><p>{editingId ? "Update the details that matter." : "A title is enough to start."}</p></div>
      <form onSubmit={submitTask}><label htmlFor="task-title">Task title <span>required</span></label><input id="task-title" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} maxLength={160} placeholder="What needs doing?" required />
        <details className="optional-fields" key={editingId || "new"} open={!!editingId}><summary>Add details <span>optional</span></summary>
        <label htmlFor="task-notes">Notes</label><textarea id="task-notes" value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} maxLength={2000} placeholder="A little context, if useful" rows={3} />
        <label htmlFor="task-topic">Topic</label><input id="task-topic" list="existing-topics" value={draft.topic} onChange={event => setDraft({ ...draft, topic: event.target.value })} maxLength={60} placeholder="e.g. Product direction" /><datalist id="existing-topics">{topics.map(topic => <option value={topic} key={topic} />)}</datalist>
        <div className="form-row"><div><label htmlFor="task-due">Due date</label><input id="task-due" type="date" value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })} /></div><div><label htmlFor="task-importance">Importance</label><select id="task-importance" value={draft.importance} onChange={event => setDraft({ ...draft, importance: event.target.value as TaskInput["importance"] })}><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></div></div>
        <label htmlFor="task-blocker">Blocked by</label><select id="task-blocker" value={draft.blockedBy} onChange={event => setDraft({ ...draft, blockedBy: event.target.value })}><option value="">Nothing</option>{store.tasks.filter(task => task.status === "open" && task.id !== editingId).map(task => <option value={task.id} key={task.id}>{task.title}</option>)}</select></details>
        <button className="submit-button" type="submit">{editingId ? "Save changes" : "Add task"}</button>{editingId && <button type="button" className="cancel-button" onClick={() => { setEditingId(""); setDraft(blankInput()); }}>Cancel editing</button>}
      </form><p className="local-note">Saved in this browser. Export a backup before clearing browser data.</p>
    </aside>
    {message && <div className="notice" role="status"><span>{message}</span>{undo && <button onClick={() => { setStore(undo); setUndo(null); setMessage("Change undone."); }}>Undo</button>}<button className="notice-close" onClick={() => { setMessage(""); setUndo(null); }}>Close</button></div>}
    <input id="import-file" className="visually-hidden" type="file" accept=".json,application/json" onChange={importData} aria-label="Import Memorandone JSON data" />
    {storageError && ready && <div className="save-warning" role="alert">{storageError}</div>}
  </div>;
}
