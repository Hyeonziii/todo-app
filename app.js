// app.js — 할 일 관리 앱: Supabase 연동 버전

// ---------- Supabase 초기화 ----------

const SUPABASE_URL = 'https://jbbwajodmxpucvppasow.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpiYndham9kbXhwdWN2cHBhc293Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTUzMTcsImV4cCI6MjA5NTA5MTMxN30.0HGWhZuMGTeg3GM46i-tR2AmKIpaGYCY8p1B4DCZqxY';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- 상수 & 상태 ----------

const CATEGORY_LABELS = {
    work: "업무",
    personal: "개인",
    study: "공부",
};

const CATEGORY_KEYWORDS = {
    work: [
        "회의", "미팅", "보고서", "보고", "이메일", "메일", "발표", "프로젝트",
        "클라이언트", "고객", "업무", "출장", "결재", "기획", "마감", "회사",
        "팀", "거래처", "계약",
    ],
    study: [
        "공부", "강의", "수업", "시험", "과제", "숙제", "학습", "독서", "책",
        "영어", "수학", "국어", "인강", "복습", "예습", "학원", "자격증",
        "토익", "토플", "코딩", "논문",
    ],
    personal: [
        "운동", "헬스", "요가", "산책", "조깅", "쇼핑", "장보기", "약속", "친구",
        "가족", "영화", "여행", "식사", "점심", "저녁", "아침", "병원", "청소",
        "빨래", "은행", "미용실",
    ],
};

const AUTO_FALLBACK_CATEGORY = "personal";

const CATEGORY_KEYWORDS_LOWER = Object.fromEntries(
    Object.entries(CATEGORY_KEYWORDS).map(([category, keywords]) => [
        category,
        keywords.map((kw) => kw.toLowerCase()),
    ]),
);

let currentFilter = "all";

let todoListEl;
let todoInputEl;
let categorySelectEl;
let addButtonEl;
let progressBarFillEl;
let progressTextEl;
let filterButtonEls;
let autoHintEl;
let undoToastEl;
let undoButtonEl;

let lastDeleted = null;
let undoTimerId = null;

// ---------- 자동 카테고리 분류 ----------

function classifyByKeywords(text) {
    if (!text) return AUTO_FALLBACK_CATEGORY;
    const lower = text.toLowerCase();
    let best = AUTO_FALLBACK_CATEGORY;
    let bestScore = 0;
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS_LOWER)) {
        let score = 0;
        for (const kw of keywords) {
            if (lower.includes(kw)) score++;
        }
        if (score > bestScore) {
            bestScore = score;
            best = category;
        }
    }
    return best;
}

function resolveCategory(selectValue, text) {
    return selectValue === "auto" ? classifyByKeywords(text) : selectValue;
}

// ---------- 데이터 계층 (Supabase) ----------

async function loadTodos() {
    const { data, error } = await db
        .from('todo')
        .select('*')
        .order('created_at', { ascending: true });
    if (error) {
        console.error('loadTodos 오류:', error);
        return [];
    }
    return data;
}

async function addTodo(text, category) {
    const { data, error } = await db
        .from('todo')
        .insert({ text, category, completed: false })
        .select()
        .single();
    if (error) {
        console.error('addTodo 오류:', error);
        return null;
    }
    return data;
}

async function updateTodo(id, newText, newCategory) {
    const { data, error } = await db
        .from('todo')
        .update({ text: newText, category: newCategory })
        .eq('id', id)
        .select()
        .single();
    if (error) {
        console.error('updateTodo 오류:', error);
        return null;
    }
    return data;
}

async function deleteTodo(id) {
    const all = await loadTodos();
    const index = all.findIndex((t) => t.id === id);
    if (index === -1) return null;
    const todo = all[index];
    const { error } = await db
        .from('todo')
        .delete()
        .eq('id', id);
    if (error) {
        console.error('deleteTodo 오류:', error);
        return null;
    }
    return { todo, index };
}

async function restoreTodo(todo) {
    const { error } = await db
        .from('todo')
        .insert({
            id: todo.id,
            text: todo.text,
            category: todo.category,
            completed: todo.completed,
            created_at: todo.created_at,
        });
    if (error) {
        console.error('restoreTodo 오류:', error);
    }
}

async function toggleTodo(id) {
    const { data: current, error: fetchError } = await db
        .from('todo')
        .select('completed')
        .eq('id', id)
        .single();
    if (fetchError) {
        console.error('toggleTodo 조회 오류:', fetchError);
        return null;
    }
    const { data, error } = await db
        .from('todo')
        .update({ completed: !current.completed })
        .eq('id', id)
        .select()
        .single();
    if (error) {
        console.error('toggleTodo 업데이트 오류:', error);
        return null;
    }
    return data;
}

// ---------- 렌더링 ----------

async function renderTodos() {
    const all = await loadTodos();
    const visible = currentFilter === "all"
        ? all
        : all.filter((t) => t.category === currentFilter);

    todoListEl.replaceChildren();

    if (visible.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = all.length === 0
            ? "아직 할 일이 없어요. 위에서 추가해보세요!"
            : "이 카테고리에는 할 일이 없어요.";
        todoListEl.appendChild(empty);
    } else {
        const frag = document.createDocumentFragment();
        for (const todo of visible) {
            frag.appendChild(buildTodoItem(todo));
        }
        todoListEl.appendChild(frag);
    }

    updateProgress(all);
}

function buildTodoItem(todo) {
    const li = document.createElement("li");
    li.className = "todo-item";
    li.dataset.id = todo.id;

    const checkboxLabel = document.createElement("label");
    checkboxLabel.className = "checkbox-label";
    checkboxLabel.setAttribute("aria-label", todo.completed ? "완료 해제" : "완료 표시");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = todo.completed;
    checkbox.addEventListener("change", async () => {
        await toggleTodo(todo.id);
        await renderTodos();
    });
    checkboxLabel.appendChild(checkbox);

    const categoryEl = document.createElement("span");
    categoryEl.className = `category-label category-${todo.category}`;
    categoryEl.textContent = CATEGORY_LABELS[todo.category] ?? todo.category;

    const textEl = document.createElement("span");
    textEl.className = "todo-text";
    if (todo.completed) textEl.classList.add("completed");
    textEl.textContent = todo.text;

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "edit-button";
    editBtn.textContent = "수정";
    editBtn.setAttribute("aria-label", `"${todo.text}" 수정`);
    editBtn.addEventListener("click", () => startEdit(li, todo));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-button";
    deleteBtn.textContent = "삭제";
    deleteBtn.setAttribute("aria-label", `"${todo.text}" 삭제`);
    deleteBtn.addEventListener("click", async () => {
        const result = await deleteTodo(todo.id);
        if (result) {
            showUndoToast(result.todo, result.index);
        }
        await renderTodos();
    });

    li.append(checkboxLabel, categoryEl, textEl, editBtn, deleteBtn);
    return li;
}

function updateProgress(all) {
    const total = all.length;
    const done = all.filter((t) => t.completed).length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    progressBarFillEl.style.width = percent + "%";
    progressTextEl.textContent = `${done} / ${total} 완료 (${percent}%)`;
}

async function setFilter(filter) {
    currentFilter = filter;
    for (const btn of filterButtonEls) {
        btn.classList.toggle("active", btn.dataset.filter === filter);
    }
    await renderTodos();
}

// ---------- 이벤트 핸들러 ----------

async function handleAdd() {
    const text = todoInputEl.value.trim();
    if (!text) {
        flashInputError(todoInputEl);
        todoInputEl.focus();
        return;
    }
    const category = resolveCategory(categorySelectEl.value, text);
    await addTodo(text, category);
    todoInputEl.value = "";
    updateAutoHint();
    await renderTodos();
}

function updateAutoHint() {
    if (!autoHintEl) return;
    if (categorySelectEl.value !== "auto") {
        autoHintEl.hidden = true;
        return;
    }
    const text = todoInputEl.value.trim();
    if (!text) {
        autoHintEl.hidden = true;
        return;
    }
    const category = classifyByKeywords(text);
    autoHintEl.hidden = false;
    autoHintEl.replaceChildren();

    const label = document.createElement("span");
    label.className = "auto-hint-label";
    label.textContent = "자동 분류 예상:";

    const badge = document.createElement("span");
    badge.className = `auto-hint-badge category-${category}`;
    badge.textContent = CATEGORY_LABELS[category];

    autoHintEl.append(label, badge);
}

function flashInputError(inputEl) {
    if (!inputEl) return;
    inputEl.classList.remove("input-error");
    void inputEl.offsetWidth;
    inputEl.classList.add("input-error");
    setTimeout(() => inputEl.classList.remove("input-error"), 400);
}

function showUndoToast(todo, index) {
    if (!undoToastEl) return;
    lastDeleted = { todo, index };
    undoToastEl.hidden = false;
    if (undoTimerId !== null) clearTimeout(undoTimerId);
    undoTimerId = setTimeout(hideUndoToast, 3000);
}

function hideUndoToast() {
    if (!undoToastEl) return;
    undoToastEl.hidden = true;
    lastDeleted = null;
    if (undoTimerId !== null) {
        clearTimeout(undoTimerId);
        undoTimerId = null;
    }
}

async function handleUndoClick() {
    if (!lastDeleted) return;
    await restoreTodo(lastDeleted.todo);
    hideUndoToast();
    await renderTodos();
}

function startEdit(li, todo) {
    li.replaceChildren();
    li.classList.add("editing");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "edit-input";
    input.value = todo.text;

    const select = document.createElement("select");
    select.className = "edit-category";
    const autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "자동";
    select.appendChild(autoOpt);
    for (const [value, label] of Object.entries(CATEGORY_LABELS)) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === todo.category) opt.selected = true;
        select.appendChild(opt);
    }

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "저장";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "취소";

    const commit = async () => {
        const newText = input.value.trim();
        if (!newText) {
            flashInputError(input);
            input.focus();
            return;
        }
        const newCategory = resolveCategory(select.value, newText);
        await updateTodo(todo.id, newText, newCategory);
        await renderTodos();
    };

    const cancel = () => renderTodos();

    saveBtn.addEventListener("click", commit);
    cancelBtn.addEventListener("click", cancel);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") cancel();
    });

    li.append(input, select, saveBtn, cancelBtn);
    input.focus();
    input.select();
}

// ---------- 초기화 ----------

document.addEventListener("DOMContentLoaded", () => {
    todoListEl = document.getElementById("todo-list");
    todoInputEl = document.getElementById("todo-input");
    categorySelectEl = document.getElementById("category-select");
    addButtonEl = document.getElementById("add-button");
    progressBarFillEl = document.getElementById("progress-bar-fill");
    progressTextEl = document.getElementById("progress-text");
    filterButtonEls = document.querySelectorAll(".filter-button");
    autoHintEl = document.getElementById("auto-hint");
    undoToastEl = document.getElementById("undo-toast");
    undoButtonEl = document.getElementById("undo-button");

    if (undoButtonEl) {
        undoButtonEl.addEventListener("click", handleUndoClick);
    }

    addButtonEl.addEventListener("click", handleAdd);
    todoInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleAdd();
    });
    todoInputEl.addEventListener("input", updateAutoHint);
    categorySelectEl.addEventListener("change", updateAutoHint);
    updateAutoHint();

    for (const btn of filterButtonEls) {
        btn.addEventListener("click", () => setFilter(btn.dataset.filter));
    }

    setFilter(currentFilter);
});
