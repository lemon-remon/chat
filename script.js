import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, deleteDoc, doc, where, getDocs, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDdQyh3u1ZgzlgbIb3dc1Gx--5Hdkukx6U",
    authDomain: "play-48bb3.firebaseapp.com",
    projectId: "play-48bb3",
    storageBucket: "play-48bb3.firebasestorage.app",
    messagingSenderId: "245177049970",
    appId: "1:245177049970:web:634a9cc62418161722b3eb"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Client ID for identifying user's posts (Legacy/Fallback)
let clientId = localStorage.getItem('othelloClientId');
if (!clientId) {
    clientId = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('othelloClientId', clientId);
}

// Global user state
let currentUser = null;

const nameInput = document.getElementById('nameInput');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const messagesContainer = document.getElementById('messagesContainer');
if (!messagesContainer) {
    console.error("Critical Error: 'messagesContainer' element not found in the DOM.");
}
const tosLink = document.getElementById('tosLink');
const tosModal = document.getElementById('tosModal');
const closeTosBtn = document.getElementById('closeTosBtn');
const deleteModal = document.getElementById('deleteModal');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');

// Auth elements
const loginModal = document.getElementById('loginModal');
const loginOpenBtn = document.getElementById('loginOpenBtn');
const closeLoginBtn = document.getElementById('closeLoginBtn');
const authUsernameInput = document.getElementById('authUsername');
const authPasswordInput = document.getElementById('authPassword');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const switchToRegister = document.getElementById('switchToRegister');
const authModalTitle = document.getElementById('authModalTitle');
const userInfo = document.getElementById('userInfo');
const displayUserName = document.getElementById('displayUserName');
const logoutBtn = document.getElementById('logoutBtn');

let isRegisterMode = false;

let deleteTargetId = null;

function openTos() {
    tosModal.classList.add('active');
}

function closeTos() {
    tosModal.classList.remove('active');
}

if (tosLink) {
    tosLink.addEventListener('click', (e) => {
        e.preventDefault();
        openTos();
    });
}

if (closeTosBtn) {
    closeTosBtn.addEventListener('click', closeTos);
}

if (tosModal) {
    tosModal.addEventListener('click', (e) => {
        if (e.target === tosModal) {
            closeTos();
        }
    });
}

function openDeleteModal(id) {
    deleteTargetId = id;
    deleteModal.classList.add('active');
}

function closeDeleteModal() {
    deleteModal.classList.remove('active');
    deleteTargetId = null;
}

if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener('click', closeDeleteModal);
}

if (deleteModal) {
    deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) closeDeleteModal();
    });
}

// Auth Logic
const USERNAME_SUFFIX = "@play-app.local";

function usernameToEmail(username) {
    return `${username.toLowerCase().trim()}${USERNAME_SUFFIX}`;
}

function openLoginModal() {
    loginModal.classList.add('active');
    isRegisterMode = false;
    updateAuthModalUI();
}

function closeLoginModal() {
    loginModal.classList.remove('active');
    authUsernameInput.value = '';
    authPasswordInput.value = '';
}

function updateAuthModalUI() {
    if (isRegisterMode) {
        authModalTitle.innerText = '新規登録';
        authSubmitBtn.innerText = 'アカウントを作成する';
        switchToRegister.innerText = 'ログインに戻る';
        document.querySelector('.auth-switch').firstChild.textContent = '既にアカウントをお持ちですか？ ';
    } else {
        authModalTitle.innerText = 'ログイン';
        authSubmitBtn.innerText = 'ログインする';
        switchToRegister.innerText = '新規登録';
        document.querySelector('.auth-switch').firstChild.textContent = 'アカウントをお持ちでないですか？ ';
    }
}

switchToRegister.addEventListener('click', (e) => {
    e.preventDefault();
    isRegisterMode = !isRegisterMode;
    updateAuthModalUI();
});

loginOpenBtn.addEventListener('click', openLoginModal);
closeLoginBtn.addEventListener('click', closeLoginModal);

authSubmitBtn.addEventListener('click', async () => {
    const username = authUsernameInput.value.trim();
    const password = authPasswordInput.value;

    if (!username || !password) {
        alert("ユーザー名とパスワードを入力してください。");
        return;
    }

    if (password.length < 6) {
        alert("パスワードは6文字以上で入力してください。");
        return;
    }

    const email = usernameToEmail(username);
    authSubmitBtn.disabled = true;
    const originalText = authSubmitBtn.innerText;
    authSubmitBtn.innerText = '処理中...';

    try {
        if (isRegisterMode) {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCredential.user, { displayName: username });
            alert("アカウントを作成しました！");
        } else {
            await signInWithEmailAndPassword(auth, email, password);
            alert("ログインしました！");
        }
        closeLoginModal();
    } catch (error) {
        console.error("Auth error:", error);
        if (error.code === 'auth/email-already-in-use') {
            alert("このユーザー名は既に使われています。");
        } else if (error.code === 'auth/invalid-credential') {
            alert("ユーザー名またはパスワードが違います。");
        } else {
            alert("エラーが発生しました: " + error.message);
        }
    } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.innerText = originalText;
    }
});

logoutBtn.addEventListener('click', () => {
    if (confirm("ログアウトしますか？")) {
        signOut(auth);
    }
});

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        loginOpenBtn.classList.add('hidden');
        userInfo.classList.remove('hidden');
        displayUserName.innerText = user.displayName || user.email.split('@')[0];
        nameInput.value = user.displayName || '';
        nameInput.readOnly = true;
    } else {
        loginOpenBtn.classList.remove('hidden');
        userInfo.classList.add('hidden');
        displayUserName.innerText = '';
        nameInput.value = '';
        nameInput.readOnly = false;
    }
});

if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async () => {
        if (!deleteTargetId) return;

        const id = deleteTargetId;
        const originalText = confirmDeleteBtn.innerText;
        confirmDeleteBtn.innerText = '削除中...';
        confirmDeleteBtn.disabled = true;

        try {
            await deleteDoc(doc(db, "messages", id));
            closeDeleteModal();
        } catch (e) {
            console.error(e);
            alert("削除に失敗しました。");
        } finally {
            confirmDeleteBtn.innerText = originalText;
            confirmDeleteBtn.disabled = false;
        }
    });
}

async function sendMessage() {
    const name = nameInput.value.trim() || '名無しさん';
    const content = messageInput.value.trim();

    if (!content) {
        alert("メッセージを入力してください！");
        return;
    }

    sendBtn.disabled = true;
    sendBtn.innerHTML = '送信中...';

    try {
        await addDoc(collection(db, "messages"), {
            name: name,
            content: content,
            timestamp: serverTimestamp(),
            clientId: currentUser ? currentUser.uid : clientId,
            uid: currentUser ? currentUser.uid : null
        });
        messageInput.value = '';
    } catch (e) {
        console.error(e);
        alert("送信に失敗しました。");
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = `送信する <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
    }
}

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!e.isComposing) {
            sendMessage();
        }
    }
});

const q = query(collection(db, "messages"), orderBy("timestamp", "desc"));

onSnapshot(q, (snapshot) => {
    if (!messagesContainer) return;

    messagesContainer.innerHTML = '';

    if (snapshot.empty) {
        messagesContainer.innerHTML = '<div class="loading-state">まだメッセージはありません。<br></div>';
        return;
    }

    snapshot.forEach((docSnapshot) => {
        const message = docSnapshot.data();
        renderMessage(message, docSnapshot.id);
    });
});



const deleteAllBtn = document.getElementById('deleteAllBtn');
if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', async () => {
        if (!confirm('本当に自分の投稿を全て削除しますか？')) return;

        deleteAllBtn.disabled = true;
        deleteAllBtn.innerText = '削除中...';

        try {
            // Query for my messages (support both uid and legacy clientId)
            const uid = currentUser ? currentUser.uid : clientId;
            const q = query(
                collection(db, "messages"),
                where(currentUser ? "uid" : "clientId", "==", uid)
            );

            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                alert("削除対象のメッセージがありませんでした。");
                deleteAllBtn.disabled = false;
                deleteAllBtn.innerText = '自分の投稿を全て削除';
                return;
            }

            const deletePromises = [];
            let deletedCount = 0;
            let lockedCount = 0;

            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                if (data.locked) {
                    lockedCount++;
                    return; // Skip locked
                }

                deletePromises.push(deleteDoc(doc(db, "messages", docSnap.id)));
                deletedCount++;
            });

            await Promise.all(deletePromises);

            let resultMsg = `${deletedCount}件のメッセージを削除しました。`;
            if (lockedCount > 0) resultMsg += `\n(${lockedCount}件はロック済みのため残しました)`;
            alert(resultMsg);

        } catch (e) {
            console.error("Bulk delete error:", e);
            alert("削除中にエラーが発生しました。");
        } finally {
            deleteAllBtn.disabled = false;
            deleteAllBtn.innerText = '自分の投稿を全て削除';
        }
    });
}



const adminDeleteBtn = document.getElementById('adminDeleteBtn');
if (adminDeleteBtn) {
    adminDeleteBtn.addEventListener('click', async () => {
        const password = prompt('管理者機能: 全投稿を削除するためのパスワードを入力してください');
        if (password !== '3141592') {
            if (password !== null) alert('パスワードが違います');
            return;
        }

        if (!confirm('本当に全ての投稿を削除しますか？\nこの操作は取り消せません。')) return;

        adminDeleteBtn.disabled = true;
        adminDeleteBtn.innerText = '全削除中...';

        try {
            // Get all messages
            const q = query(collection(db, "messages"));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                alert("削除するメッセージがありません。");
                return;
            }

            const deletePromises = [];
            snapshot.forEach(docSnap => {
                deletePromises.push(deleteDoc(doc(db, "messages", docSnap.id)));
            });

            await Promise.all(deletePromises);
            alert('全てのメッセージを削除しました。');

        } catch (e) {
            console.error("Admin delete error:", e);
            alert("削除中にエラーが発生しました。");
        } finally {
            adminDeleteBtn.disabled = false;
            adminDeleteBtn.innerText = '管理者用: 全投稿を削除';
        }
    });
}

function deleteMessage(id) {
    openDeleteModal(id);
}

async function updateLockStatus(id, newStatus) {
    try {
        const ref = doc(db, "messages", id);
        await setDoc(ref, { locked: newStatus }, { merge: true });
    } catch (e) {
        console.error("Error updating lock:", e);
        alert("操作に失敗しました");
    }
}

function renderMessage(message, id) {
    const div = document.createElement('div');
    div.classList.add('message-card');

    let timeString = '';
    if (message.timestamp) {
        const date = message.timestamp.toDate();
        const today = new Date();
        const isToday = date.getDate() === today.getDate() &&
            date.getMonth() === today.getMonth() &&
            date.getFullYear() === today.getFullYear();

        if (isToday) {
            timeString = date.toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        } else {
            timeString = date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
    }

    const initial = ((message.name || message.content || '名') + '').charAt(0);
    const isLocked = message.locked === true;
    const currentUid = currentUser ? currentUser.uid : clientId;
    const isMyMessage = (message.uid === currentUid) || (message.clientId === currentUid);

    // Lock UI
    const lockBtnHtml = isMyMessage
        ? `<button class="lock-btn ${isLocked ? 'locked' : ''}" title="${isLocked ? 'ロック解除' : 'ロックする'}">
             ${isLocked ? '🔒' : '🔓'}
           </button>`
        : (isLocked ? '<span class="lock-btn locked" title="ロックされています" style="cursor:default">🔒</span>' : '');

    const deleteBtnHtml = !isLocked && isMyMessage
        ? `<button class="delete-btn" title="削除">×</button>`
        : '';

    div.innerHTML = `
        <div class="message-header">
            <div class="message-avatar">${sanitizeHTML(initial)}</div>
            <div class="message-info">
                <span class="message-name">${sanitizeHTML(message.name)}</span>
                <span class="message-time">${timeString}</span>
            </div>
            <div class="message-actions">
                ${deleteBtnHtml}
                ${lockBtnHtml}
            </div>
        </div>
        <div class="message-content">${sanitizeHTML(message.content)}</div>
    `;

    const deleteBtn = div.querySelector('.delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (message.locked) {
                alert('この投稿はロックされているため削除できません。');
                return;
            }
            deleteMessage(id);
        });
    }

    const lockBtn = div.querySelector('button.lock-btn');
    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            updateLockStatus(id, !isLocked);
        });
    }

    // Force Delete Logic: 5 consecutive taps
    let tapCount = 0;
    let tapTimer = null;

    div.addEventListener('click', (e) => {
        // Ignore clicks on buttons to prevent conflict
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

        tapCount++;

        if (tapTimer) clearTimeout(tapTimer);

        if (tapCount >= 5) {
            tapCount = 0;
            const password = prompt('管理者機能: 強制削除パスワードを入力してください');
            if (password === '3141592') {
                deleteDoc(doc(db, "messages", id))
                    .then(() => alert('強制削除しました'))
                    .catch((err) => alert('削除失敗: ' + err));
            } else if (password !== null) {
                alert('パスワードが違います');
            }
        } else {
            tapTimer = setTimeout(() => {
                tapCount = 0;
            }, 400); // 400ms timeout for consecutive taps
        }
    });

    if (messagesContainer) {
        messagesContainer.appendChild(div);
    } else {
        console.error("Cannot append message: messagesContainer is missing.");
    }
}

function sanitizeHTML(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, function (m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

// Page Flip Logic
const bookContainer = document.querySelector('.book-container');
let touchStartX = 0;
let touchEndX = 0;

function handleGesture() {
    if (!bookContainer) return;
    const swipeThreshold = 50;

    // Check swipe distance
    if (touchEndX < touchStartX - swipeThreshold) {
        // Swiped Left (Next Page)
        bookContainer.classList.add('flipped');
    }

    if (touchEndX > touchStartX + swipeThreshold) {
        // Swiped Right (Prev Page)
        bookContainer.classList.remove('flipped');
    }
}

document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

document.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    handleGesture();
}, { passive: true });

// Mouse support for testing on PC
let isDragging = false;

document.addEventListener('mousedown', e => {
    isDragging = true;
    touchStartX = e.screenX;
});

document.addEventListener('mouseup', e => {
    if (!isDragging) return;
    isDragging = false;
    touchEndX = e.screenX;
    handleGesture();
});

// Othello Game Logic
const boardElement = document.getElementById('othello-board');
const turnIndicator = document.getElementById('turnIndicator');
const resetGameBtn = document.getElementById('resetGameBtn');
const blackCountEl = document.getElementById('blackCount');
const whiteCountEl = document.getElementById('whiteCount');
const lastPlayerNameEl = document.getElementById('lastPlayerName');
const lastResetNameEl = document.getElementById('lastResetName');
const gameDocRef = doc(db, "games", "othello");

// Client ID for calculating consecutive moves
// clientId is now defined at the top of the file.

let boardState = Array(8).fill(null).map(() => Array(8).fill(null));
let currentTurn = 'black';
let lastMoveBy = null;
let gameStatus = 'playing';
let winner = null;

// Initialize Board UI
function initBoard() {
    boardElement.innerHTML = '';
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.row = row;
            cell.dataset.col = col;
            cell.addEventListener('click', () => handleCellClick(row, col));
            boardElement.appendChild(cell);
        }
    }
}

// Render Board State
async function renderBoard() {
    const cells = document.querySelectorAll('.cell');
    cells.forEach(cell => {
        const r = parseInt(cell.dataset.row);
        const c = parseInt(cell.dataset.col);
        const piece = boardState[r][c];

        cell.innerHTML = '';
        if (piece) {
            const p = document.createElement('div');
            p.classList.add('piece', piece);
            cell.appendChild(p);
        }
    });

    // Update UI text
    const flatBoard = boardState.flat();
    const blackCount = flatBoard.filter(c => c === 'black').length;
    const whiteCount = flatBoard.filter(c => c === 'white').length;

    // Update Sidebar Stats
    if (blackCountEl) blackCountEl.innerText = blackCount;
    if (whiteCountEl) whiteCountEl.innerText = whiteCount;

    if (gameStatus === 'finished') {
        let resultText = '';
        if (winner === 'black') resultText = '黒の勝ち！';
        else if (winner === 'white') resultText = '白の勝ち！';
        else resultText = '引き分け！';

        turnIndicator.innerHTML = `<span style="color:#e11d48">${resultText}</span> (黒:${blackCount} - 白:${whiteCount})`;
        turnIndicator.style.color = '#e11d48';
    } else {
        const currentUid = currentUser ? currentUser.uid : clientId;
        const isMyTurn = lastMoveBy !== currentUid;
        const statusText = currentTurn === 'black' ? '黒の番' : '白の番';
        const restrictionText = !isMyTurn ? '(待機中...)' : (!currentUser ? '(ログインが必要)' : '');
        const countText = `(黒:${blackCount} - 白:${whiteCount})`;

        turnIndicator.innerText = `${statusText} ${restrictionText} ${countText}`;

        if (!isMyTurn || !currentUser) {
            turnIndicator.style.color = '#ef4444';
        } else {
            turnIndicator.style.color = 'var(--text-primary)';
        }
    }

    // Check if game document exists, if not create it
    const snap = await getDoc(gameDocRef);
    if (!snap.exists()) {
        resetGame();
    }
}

// Reset Game State
async function resetGame() {
    // Initial setup: 4 pieces in center
    const newBoard = Array(8).fill(null).map(() => Array(8).fill(null));
    newBoard[3][3] = 'white';
    newBoard[3][4] = 'black';
    newBoard[4][3] = 'black';
    newBoard[4][4] = 'white';

    try {
        const resetterName = currentUser ? (currentUser.displayName || '名無しさん') : 'システム';
        await setDoc(gameDocRef, {
            board: JSON.stringify(newBoard),
            turn: 'black',
            lastMoveBy: null,
            lastMoveByName: '-',
            lastResetByName: resetterName,
            status: 'playing',
            winner: null,
            updatedAt: serverTimestamp()
        });
        alert('ゲームをリセットしました！');
    } catch (e) {
        console.error("Error resetting game:", e);
    }
}

// Handle Cell Click
async function handleCellClick(row, col) {
    if (!currentUser) {
        alert("オセロをプレイするにはログインが必要です！");
        openLoginModal();
        return;
    }

    if (boardState[row][col] !== null) return;
    if (boardState.flat().every(cell => cell !== null)) return; // Board full
    if (gameStatus === 'finished') return; // Do not allow moves if game is finished

    const currentUid = currentUser.uid;

    if (lastMoveBy === currentUid) {
        alert("連続して置くことはできません！他の人が置くのを待ってください。");
        return;
    }

    const flips = getFlips(row, col, currentTurn); // Uses current global boardState
    if (flips.length === 0) {
        return;
    }

    try {
        // Deep copy board
        const nextBoard = boardState.map(r => [...r]);

        // Place piece
        nextBoard[row][col] = currentTurn;

        // Flip pieces
        flips.forEach(p => {
            nextBoard[p.r][p.c] = currentTurn;
        });

        const opponent = currentTurn === 'black' ? 'white' : 'black';
        let nextTurn = opponent;
        let gameStatus = 'playing';
        let winner = null;

        // Check if opponent has any valid moves
        const opponentHasMove = hasValidMove(nextBoard, opponent);

        if (!opponentHasMove) {
            // Opponent cannot move. Check if current player can move.
            const currentHasMove = hasValidMove(nextBoard, currentTurn);

            if (currentHasMove) {
                // Pass: Opponent skipped, turn remains currentTurn
                nextTurn = currentTurn;
                alert(`${opponent === 'black' ? '黒' : '白'}は置く場所がありません。パスします。`);
            } else {
                // Determine winner
                gameStatus = 'finished';
                const flatBoard = nextBoard.flat();
                const blackCount = flatBoard.filter(c => c === 'black').length;
                const whiteCount = flatBoard.filter(c => c === 'white').length;

                if (blackCount > whiteCount) winner = 'black';
                else if (whiteCount > blackCount) winner = 'white';
                else winner = 'draw';
            }
        }

        const currentUid = currentUser.uid;
        const currentName = currentUser.displayName || '名無しさん';
        await setDoc(gameDocRef, {
            board: JSON.stringify(nextBoard),
            turn: nextTurn,
            lastMoveBy: currentUid,
            lastMoveByName: currentName,
            status: gameStatus,
            winner: winner,
            updatedAt: serverTimestamp()
        });
    } catch (e) {
        console.error("Error updating game:", e);
        alert("エラーが発生しました。");
    }
}

// Check if a player has any valid move
function hasValidMove(board, color) {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c] === null) {
                if (getFlips(r, c, color, board).length > 0) {
                    return true;
                }
            }
        }
    }
    return false;
}

// Othello Logic: Get flippable pieces
function getFlips(row, col, color, board = boardState) {
    const directions = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1], [0, 1],
        [1, -1], [1, 0], [1, 1]
    ];

    let flips = [];
    const opponent = color === 'black' ? 'white' : 'black';

    directions.forEach(([dr, dc]) => {
        let r = row + dr;
        let c = col + dc;
        let potentialFlips = [];

        while (r >= 0 && r < 8 && c >= 0 && c < 8) {
            if (board[r][c] === opponent) {
                potentialFlips.push({ r, c });
            } else if (board[r][c] === color) {
                if (potentialFlips.length > 0) {
                    flips = flips.concat(potentialFlips);
                }
                break;
            } else {
                break;
            }
            r += dr;
            c += dc;
        }
    });

    return flips;
}

// Sync Game State
onSnapshot(gameDocRef, (doc) => {
    if (doc.exists()) {
        const data = doc.data();
        if (data.board) boardState = JSON.parse(data.board);
        if (data.turn) currentTurn = data.turn;
        if (data.lastMoveBy !== undefined) lastMoveBy = data.lastMoveBy;
        if (lastPlayerNameEl) {
            lastPlayerNameEl.innerText = data.lastMoveByName || '-';
        }
        if (lastResetNameEl) {
            lastResetNameEl.innerText = data.lastResetByName || '-';
        }
        renderBoard();
    }
});

if (resetGameBtn) {
    resetGameBtn.addEventListener('click', () => {
        if (!currentUser) {
            alert("リセットするにはログインが必要です！");
            openLoginModal();
            return;
        }
        if (confirm('ゲームをリセットしてもよろしいですか？')) {
            resetGame();
        }
    });
}

// Init
initBoard();

// Online User Counter Logic
const userCountElement = document.getElementById('userCount');
const presenceCollectionRef = collection(db, "presence");

// Heartbeat: Update presence every 30 seconds
async function updatePresence() {
    try {
        const userRef = doc(db, "presence", clientId);
        await setDoc(userRef, {
            lastSeen: serverTimestamp(),
            userAgent: navigator.userAgent
        }, { merge: true });
    } catch (e) {
        console.error("Error updating presence:", e);
    }
}

// Initial update
updatePresence();

// Periodic update
setInterval(updatePresence, 30000);

// Remove presence on unload (Best effort)
window.addEventListener('beforeunload', () => {
    // Note: async calls in beforeunload are unreliable. 
    // We rely on the timestamp timeout for accurate counting.
    const userRef = doc(db, "presence", clientId);
    // Using sendBeacon or similar would be better but requires an API endpoint usually.
    // For Firestore, we just let it timeout or try a detach catch-free delete
    deleteDoc(userRef).catch(err => { });
});

// Listen for active users
const presenceQuery = query(presenceCollectionRef);

onSnapshot(presenceQuery, (snapshot) => {
    // We need to calculate active users based on local time vs server time approximation
    // Since we don't have easy server-side filtering without cloud functions,
    // we fetch all presence docs (scalability warning if > 100 users, but fine for small app)

    const now = new Date();
    // Consider active if seen in last 2 minutes
    const cutoff = new Date(now.getTime() - 2 * 60 * 1000);

    let activeCount = 0;

    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.lastSeen) {
            // Firestore timestamp to Date
            const lastSeenDate = data.lastSeen.toDate();
            if (lastSeenDate > cutoff) {
                activeCount++;
            }
        }
    });

    // Ensure at least 1 (me)
    if (activeCount < 1) activeCount = 1;

    if (userCountElement) {
        // Animate or set text
        const currentVal = parseInt(userCountElement.innerText) || 0;
        if (currentVal !== activeCount) {
            animateValue(userCountElement, currentVal, activeCount, 500);
        } else {
            userCountElement.innerText = activeCount;
        }
    }
});

function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.innerHTML = end;
        }
    };
    window.requestAnimationFrame(step);
}


