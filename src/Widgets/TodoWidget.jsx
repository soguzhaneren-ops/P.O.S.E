import { useState, useEffect } from 'react'

function TodoWidget() {
  const [todos, setTodos] = useState(() => {
    const saved = localStorage.getItem('dashboardTodos')
    const parsed = saved ? JSON.parse(saved) : [
      { id: 1, text: 'SYS_BOOT: VERIFY PORTFOLIO INTEGRITY', completed: true, subTasks: [] },
      { id: 2, text: 'UPGRADE: SECURE TELEMETRY NODES', completed: false, subTasks: [
        { id: 21, text: 'VERIFY FINNHUB HANDSHAKE', completed: false },
        { id: 22, text: 'OPTIMIZE COMPILER CHANNELS', completed: true }
      ]}
    ]
    return parsed
  })
  const [newTodo, setNewTodo] = useState('')
  const [expandedTodos, setExpandedTodos] = useState([])
  const [subTaskInputs, setSubTaskInputs] = useState({})
  const [draggedTodoId, setDraggedTodoId] = useState(null)
  const [editingTodoId, setEditingTodoId] = useState(null)
  const [editingTodoValue, setEditingTodoValue] = useState('')

  useEffect(() => {
    localStorage.setItem('dashboardTodos', JSON.stringify(todos))
  }, [todos])

  const handleAddTodo = () => {
    const cleanText = newTodo.trim().toUpperCase()
    if (!cleanText) return
    setTodos(prev => [...prev, { id: Date.now(), text: cleanText, completed: false, subTasks: [] }])
    setNewTodo('')
  }

  const handleToggleTodo = (id) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t))
  }

  const handleRemoveTodo = (id) => {
    setTodos(prev => prev.filter(t => t.id !== id))
    setExpandedTodos(prev => prev.filter(item => item !== id))
  }

  const handleToggleExpand = (id) => {
    setExpandedTodos(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  const handleSubInputChange = (todoId, val) => {
    setSubTaskInputs(prev => ({ ...prev, [todoId]: val }))
  }

  const handleAddSubTask = (todoId) => {
    const text = (subTaskInputs[todoId] || '').trim().toUpperCase()
    if (!text) return
    setTodos(prev => prev.map(t => {
      if (t.id === todoId) {
        const subs = t.subTasks || []
        return { ...t, subTasks: [...subs, { id: Date.now(), text, completed: false }] }
      }
      return t
    }))
    setSubTaskInputs(prev => ({ ...prev, [todoId]: '' }))
  }

  const handleToggleSubTask = (todoId, subId) => {
    setTodos(prev => prev.map(t => {
      if (t.id === todoId) {
        const updatedSubs = (t.subTasks || []).map(s =>
          s.id === subId ? { ...s, completed: !s.completed } : s
        )
        return { ...t, subTasks: updatedSubs }
      }
      return t
    }))
  }

  const handleRemoveSubTask = (todoId, subId) => {
    setTodos(prev => prev.map(t => {
      if (t.id === todoId) {
        const updatedSubs = (t.subTasks || []).filter(s => s.id !== subId)
        return { ...t, subTasks: updatedSubs }
      }
      return t
    }))
  }

  const handleDragStart = (e, id) => {
    e.stopPropagation();
    setDraggedTodoId(id);
    e.dataTransfer.effectAllowed = 'move';
  }

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  }

  const handleDrop = (e, targetId) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedTodoId === null || draggedTodoId === targetId) return;
    setTodos(prev => {
      const copy = [...prev];
      const draggedIndex = copy.findIndex(t => t.id === draggedTodoId);
      const targetIndex = copy.findIndex(t => t.id === targetId);
      if (draggedIndex === -1 || targetIndex === -1) return prev;
      const [draggedItem] = copy.splice(draggedIndex, 1);
      copy.splice(targetIndex, 0, draggedItem);
      return copy;
    });
    setDraggedTodoId(null);
  }

  const handleStartEditTodo = (id, text) => {
    setEditingTodoId(id)
    setEditingTodoValue(text)
  }

  const handleSaveEditTodo = (id) => {
    const clean = editingTodoValue.trim().toUpperCase()
    if (!clean) {
      setEditingTodoId(null)
      return
    }
    setTodos(prev => prev.map(t => t.id === id ? { ...t, text: clean } : t))
    setEditingTodoId(null)
  }

  return (
    <div className="p-4 flex-grow flex flex-col justify-start gap-y-3 overflow-hidden text-sm font-sans">
      <div className="flex gap-1.5">
        <input
          type="text"
          placeholder="ADD NEW OPERATIONAL TASK..."
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddTodo()}
          className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-xs px-3 py-1.5 rounded focus:outline-none focus:border-[#00d2ff] flex-grow uppercase font-sans"
        />
        <button
          onClick={handleAddTodo}
          className="bg-[#132533] hover:bg-[#1c3547] active:bg-[#00d2ff] active:text-black border border-[#1c3547] text-cyan-400 text-xs px-3 rounded font-bold transition-all cursor-pointer font-sans"
        >
          ADD
        </button>
      </div>

      <div className="flex-grow overflow-auto pr-1 space-y-2">
        {todos.length === 0 ? (
          <div className="text-xs text-cyan-700 italic select-none py-4 text-center">
            NO_ACTIVE_TASKS
          </div>
        ) : (
          todos.map(todo => {
            const isExpanded = expandedTodos.includes(todo.id)
            const subTasksArray = todo.subTasks || []
            const isEditing = todo.id === editingTodoId

            return (
              <div
                key={todo.id}
                draggable={!isEditing}
                onDragStart={(e) => handleDragStart(e, todo.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, todo.id)}
                onDragEnd={(e) => {
                  e.stopPropagation();
                  setDraggedTodoId(null);
                }}
                className={`border-b border-[#1c3547]/10 pb-2 last:border-0 last:pb-0 transition-opacity duration-150 ${
                  draggedTodoId === todo.id ? 'opacity-40' : ''
                }`}
              >
                <div className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2 flex-grow overflow-hidden mr-2">
                    <button
                      onClick={() => handleToggleExpand(todo.id)}
                      className="text-xs text-[#60809a] hover:text-cyan-400 font-bold focus:outline-none select-none transition-colors w-3 text-center cursor-pointer"
                      title={isExpanded ? "COLLAPSE SUB-TASKS" : "EXPAND SUB-TASKS"}
                    >
                      {isExpanded ? '▼' : '▶'}
                    </button>

                    <button
                      onClick={() => handleToggleTodo(todo.id)}
                      className={`w-5 h-5 flex-shrink-0 flex items-center justify-center text-xs font-extrabold rounded transition-all focus:outline-none select-none cursor-pointer ${
                        todo.completed
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : 'border border-[#1c3547] text-[#60809a] hover:text-cyan-400 hover:border-cyan-500/40'
                      }`}
                    >
                      {todo.completed ? '✓' : ''}
                    </button>

                    {isEditing ? (
                    <input
                      type="text"
                      value={editingTodoValue}
                      onChange={(e) => setEditingTodoValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEditTodo(todo.id)
                        if (e.key === 'Escape') setEditingTodoId(null)
                      }}
                      className="bg-[#090e14] border border-[#00d2ff] text-cyan-100 text-xs px-1 py-0.5 rounded focus:outline-none w-full font-sans"
                      autoFocus
                    />
                  ) : (
                      <span
                        onDoubleClick={() => handleStartEditTodo(todo.id, todo.text)}
                        className={`truncate font-semibold uppercase leading-none cursor-grab active:cursor-grabbing select-none ${
                          todo.completed ? 'line-through text-cyan-700/50' : 'text-cyan-100'
                        }`}
                        title="DOUBLE-CLICK TO EDIT // DRAG TO REORDER"
                      >
                        {todo.text}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => handleRemoveTodo(todo.id)}
                    className="text-[#60809a]/40 hover:text-rose-500 text-xs font-bold focus:outline-none flex-shrink-0 cursor-pointer"
                  >
                    [✕]
                  </button>
                </div>

                {isExpanded && (
                  <div className="pl-8 pr-1 py-1.5 space-y-1.5 border-l border-[#1c3547]/30 ml-5 mt-1.5 transition-all duration-300">
                    {subTasksArray.length === 0 ? (
                      <div className="text-[10px] text-cyan-700/60 italic py-1 pl-1 select-none">
                        NO_SUB_TASKS_DECLARED
                      </div>
                    ) : (
                      subTasksArray.map(sub => (
                        <div key={sub.id} className="flex justify-between items-center text-xs">
                          <div className="flex items-center gap-2 overflow-hidden flex-grow mr-2">
                            <button
                              onClick={() => handleToggleSubTask(todo.id, sub.id)}
                              className={`w-4 h-4 flex-shrink-0 flex items-center justify-center text-[10px] font-extrabold rounded transition-all focus:outline-none select-none cursor-pointer ${
                                sub.completed
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : 'border border-[#1c3547] text-[#60809a] hover:text-cyan-400 hover:border-cyan-500/40'
                              }`}
                            >
                              {sub.completed ? '✓' : ''}
                            </button>
                            <span className={`truncate leading-none ${
                              sub.completed ? 'line-through text-cyan-700/50' : 'text-cyan-200'
                            }`}>
                              {sub.text}
                            </span>
                          </div>
                          <button
                            onClick={() => handleRemoveSubTask(todo.id, sub.id)}
                            className="text-[#60809a]/40 hover:text-rose-500 text-[10px] font-bold pl-1.5 cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}

                    <div className="flex gap-1 pt-1.5 border-t border-[#1c3547]/10 select-none">
                      <input
                        type="text"
                        placeholder="ADD SUB-TASK..."
                        value={subTaskInputs[todo.id] || ''}
                        onChange={(e) => handleSubInputChange(todo.id, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddSubTask(todo.id)}
                        className="bg-[#090e14] border border-[#1c3547]/50 text-cyan-100 text-[10px] px-2 py-0.5 rounded focus:outline-none focus:border-[#00d2ff] flex-grow font-sans uppercase"
                      />
                      <button
                        onClick={() => handleAddSubTask(todo.id)}
                        className="bg-[#132533] hover:bg-[#1c3547] border border-[#1c3547] text-cyan-400 text-xs px-2 rounded font-bold cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default TodoWidget