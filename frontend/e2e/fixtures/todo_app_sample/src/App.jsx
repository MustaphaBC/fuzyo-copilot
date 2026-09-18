import { useMemo, useState } from 'react'

export default function App() {
  const [todos, setTodos] = useState([
    { id: 1, text: 'Ship Fuzyo Copilot', done: false },
    { id: 2, text: 'Write E2E audit', done: true },
  ])
  const [draft, setDraft] = useState('')

  const remaining = useMemo(() => todos.filter((t) => !t.done).length, [todos])

  function addTodo(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setTodos((prev) => [...prev, { id: Date.now(), text, done: false }])
    setDraft('')
  }

  function toggleTodo(id) {
    setTodos((prev) =>
      prev.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)),
    )
  }

  // CLEAR_COMPLETED_MARKER — replaced by Apply & Sync in E2E
  function clearCompleted() {
    setTodos((prev) => prev.filter((todo) => !todo.done))
  }

  return (
    <main className="todo-app">
      <h1>Todo Master App</h1>
      <p>{remaining} remaining</p>
      <form onSubmit={addTodo}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="New todo"
        />
        <button type="submit">Add</button>
      </form>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input
                type="checkbox"
                checked={todo.done}
                onChange={() => toggleTodo(todo.id)}
              />
              {todo.text}
            </label>
          </li>
        ))}
      </ul>
      <button type="button" onClick={clearCompleted}>
        Clear completed
      </button>
    </main>
  )
}
