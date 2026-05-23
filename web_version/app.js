// app.js — 할 일 관리 앱(데스크탑 버전): 데이터 / 렌더링 / 이벤트 / 초기화

// ---------- 상수 & 상태 ----------

const STORAGE_KEY = "todos";

const CATEGORY_LABELS = {
    work: "업무",
    personal: "개인",
    study: "공부",
};

const FILTER_TITLES = {
    all: "전체 할 일",
    work: "업무",
    personal: "개인",
    study: "공부",
};

// 자동 분류용 키워드 — 텍스트에 포함된 키워드 수가 가장 많은 카테고리로 분류한다.
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

// PERF-4: 키워드를 모듈 로드 시 한 번만 소문자 변환해 캐싱한다 (매 키 입력마다 toLowerCase 반복 방지).
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
let listTitleEl;
let listMetaEl;
let statTotalEl;
let statDoneEl;
let statRemainingEl;
let countEls;
let undoToastEl;
let undoButtonEl;

// 실행 취소를 위한 마지막 삭제 항목과 그 원래 위치, 그리고 대기 중인 타이머.
let lastDeleted = null; // { todo, index } | null
let undoTimerId = null;

// ---------- 자동 카테고리 분류 ----------

function classifyByKeywords(text) {
    if (!text) return AUTO_FALLBACK_CATEGORY;
    const lower = text.toLowerCase();
    let best = AUTO_FALLBACK_CATEGORY;
    let bestScore = 0;
    // PERF-4: 미리 소문자로 변환된 키워드 캐시를 사용한다.
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

// ---------- 데이터 계층 ----------

function loadTodos() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    // BUG-3: 손상된 JSON / 배열이 아닌 값으로부터 앱 전체가 깨지는 것을 막는다.
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error("loadTodos: JSON 파싱 실패", err);
        return [];
    }
}

function saveTodos(todos) {
    // BUG-4: 저장소 용량 초과(QuotaExceededError) 등 예외 상황을 흡수한다.
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    } catch (err) {
        console.error("saveTodos: localStorage 저장 실패", err);
    }
}

function addTodo(text, category) {
    const todos = loadTodos();
    // BUG-2: Date.now()만으로는 같은 ms에 두 번 추가될 때 id가 충돌한다. UUID 우선, 미지원 환경은 폴백.
    const id = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const todo = {
        id,
        text,
        category,
        completed: false,
        createdAt: new Date().toISOString(),
    };
    todos.push(todo);
    saveTodos(todos);
    return todo;
}

function updateTodo(id, newText, newCategory) {
    const todos = loadTodos();
    const todo = todos.find((t) => t.id === id);
    if (!todo) return null;
    todo.text = newText;
    todo.category = newCategory;
    saveTodos(todos);
    return todo;
}

// id에 해당하는 할 일을 배열에서 제거한다. 실행 취소를 위해 원래 위치(index)도 반환한다.
function deleteTodo(id) {
    const todos = loadTodos();
    const index = todos.findIndex((t) => t.id === id);
    if (index === -1) return null;
    const [removed] = todos.splice(index, 1);
    saveTodos(todos);
    return { todo: removed, index };
}

// 실행 취소 — 저장된 항목을 원래 위치(index)에 다시 끼워 넣는다.
function restoreTodo(todo, index) {
    const todos = loadTodos();
    const safeIndex = Math.min(Math.max(index, 0), todos.length);
    todos.splice(safeIndex, 0, todo);
    saveTodos(todos);
}

function toggleTodo(id) {
    const todos = loadTodos();
    const todo = todos.find((t) => t.id === id);
    if (!todo) return null;
    todo.completed = !todo.completed;
    saveTodos(todos);
    return todo;
}

// ---------- 렌더링 ----------

function renderTodos() {
    // PERF-1: loadTodos는 이 렌더 사이클에서 한 번만 호출하고 하위 헬퍼에 전달한다.
    const all = loadTodos();
    const visible = currentFilter === "all"
        ? all
        : all.filter((t) => t.category === currentFilter);

    // PERF-6: innerHTML = "" 대신 replaceChildren()으로 자식만 비운다 (HTML 파서 재호출 회피).
    todoListEl.replaceChildren();

    if (visible.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = all.length === 0
            ? "아직 할 일이 없어요. 위에서 추가해보세요!"
            : "이 카테고리에는 할 일이 없어요.";
        todoListEl.appendChild(empty);
    } else {
        // PERF-5: 매 항목마다 appendChild로 리플로우를 발생시키지 않고, 프래그먼트에 모았다가 한 번에 붙인다.
        const frag = document.createDocumentFragment();
        for (const todo of visible) {
            frag.appendChild(buildTodoItem(todo));
        }
        todoListEl.appendChild(frag);
    }

    updateProgress(all);
    updateCounts(all);
    updateListHeader(visible.length);
}

function buildTodoItem(todo) {
    const li = document.createElement("li");
    li.className = "todo-item";
    li.dataset.id = todo.id;

    // 체크박스는 44x44 라벨로 감싸 터치 영역을 확보한다 (모바일 접근성).
    const checkboxLabel = document.createElement("label");
    checkboxLabel.className = "checkbox-label";
    checkboxLabel.setAttribute("aria-label", todo.completed ? "완료 해제" : "완료 표시");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = todo.completed;
    checkbox.addEventListener("change", () => {
        toggleTodo(todo.id);
        renderTodos();
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
    deleteBtn.addEventListener("click", () => {
        const result = deleteTodo(todo.id);
        if (result) {
            showUndoToast(result.todo, result.index);
        }
        renderTodos();
    });

    li.append(checkboxLabel, categoryEl, textEl, editBtn, deleteBtn);
    return li;
}

// PERF-1: 호출자가 이미 로드한 배열을 받아 재 파싱을 피한다.
function updateProgress(all) {
    const total = all.length;
    const done = all.filter((t) => t.completed).length;
    const remaining = total - done;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    progressBarFillEl.style.width = percent + "%";
    progressTextEl.textContent = `${done} / ${total} 완료 (${percent}%)`;
    statTotalEl.textContent = total;
    statDoneEl.textContent = done;
    statRemainingEl.textContent = remaining;
}

// PERF-1: 호출자가 이미 로드한 배열을 받아 재 파싱을 피한다.
function updateCounts(all) {
    const counts = { all: all.length, work: 0, personal: 0, study: 0 };
    for (const t of all) {
        if (counts[t.category] !== undefined) counts[t.category]++;
    }
    for (const [key, el] of Object.entries(countEls)) {
        el.textContent = counts[key];
    }
}

function updateListHeader(visibleCount) {
    listTitleEl.textContent = FILTER_TITLES[currentFilter] ?? "할 일";
    listMetaEl.textContent = `${visibleCount}개`;
}

function setFilter(filter) {
    currentFilter = filter;
    for (const btn of filterButtonEls) {
        btn.classList.toggle("active", btn.dataset.filter === filter);
    }
    renderTodos();
}

// ---------- 이벤트 핸들러 ----------

function handleAdd() {
    const text = todoInputEl.value.trim();
    if (!text) {
        // 빈 입력으로 추가를 시도했음을 사용자에게 시각적으로 알린다.
        flashInputError(todoInputEl);
        todoInputEl.focus();
        return;
    }
    const category = resolveCategory(categorySelectEl.value, text);
    addTodo(text, category);
    todoInputEl.value = "";
    updateAutoHint();
    renderTodos();
}

// 자동 분류 미리보기 — 카테고리 색상과 일치하는 배지로 보여 가시성을 높인다.
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

// 빈 입력 등 잘못된 동작에 시각적 피드백(빨간 테두리 + 흔들림)을 잠깐 보여 준다.
function flashInputError(inputEl) {
    if (!inputEl) return;
    inputEl.classList.remove("input-error");
    // 강제 reflow로 애니메이션을 재시작시킨다.
    void inputEl.offsetWidth;
    inputEl.classList.add("input-error");
    setTimeout(() => inputEl.classList.remove("input-error"), 400);
}

// 삭제 후 3초간 실행 취소 토스트를 띄운다. 타이머가 끝나면 자동으로 닫힌다.
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

function handleUndoClick() {
    if (!lastDeleted) return;
    restoreTodo(lastDeleted.todo, lastDeleted.index);
    hideUndoToast();
    renderTodos();
}

function startEdit(li, todo) {
    // PERF-6: innerHTML = "" 대신 replaceChildren()으로 자식만 비운다.
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

    const commit = () => {
        const newText = input.value.trim();
        if (!newText) {
            // 빈 텍스트로 저장 시도 시 시각적 피드백을 준다.
            flashInputError(input);
            input.focus();
            return;
        }
        const newCategory = resolveCategory(select.value, newText);
        updateTodo(todo.id, newText, newCategory);
        renderTodos();
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
    listTitleEl = document.getElementById("list-title");
    listMetaEl = document.getElementById("list-meta");
    statTotalEl = document.getElementById("stat-total");
    statDoneEl = document.getElementById("stat-done");
    statRemainingEl = document.getElementById("stat-remaining");
    countEls = {
        all: document.getElementById("count-all"),
        work: document.getElementById("count-work"),
        personal: document.getElementById("count-personal"),
        study: document.getElementById("count-study"),
    };
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
