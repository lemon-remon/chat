import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, deleteDoc, doc, where, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
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
const deleteModal = document.getElementById('deleteModal');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');

// 画像関連要素
const attachImageBtn = document.getElementById('attachImageBtn');
const imageInput = document.getElementById('imageInput');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const imagePreview = document.getElementById('imagePreview');
const removeImageBtn = document.getElementById('removeImageBtn');
const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const closeImageModalBtn = document.getElementById('closeImageModalBtn');

// 選択中の画像データ (Base64)
let currentImageBase64 = null;

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

// --- 画像処理（選択・自動リサイズ・圧縮） ---
if (imageInput) {
    imageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('画像ファイルを選択してください。');
            return;
        }

        try {
            // 画像をブラウザ上でリサイズ・圧縮 (最大800px, JPEG品質0.75)
            const compressedBase64 = await resizeAndCompressImage(file, 800, 800, 0.75);
            currentImageBase64 = compressedBase64;
            if (imagePreview) imagePreview.src = compressedBase64;
            if (imagePreviewContainer) imagePreviewContainer.classList.remove('hidden');
        } catch (err) {
            console.error('画像読み込みエラー:', err);
            alert('画像の読み込みに失敗しました。');
        }
    });
}

if (removeImageBtn) {
    removeImageBtn.addEventListener('click', clearSelectedImage);
}

function clearSelectedImage() {
    currentImageBase64 = null;
    if (imageInput) imageInput.value = '';
    if (imagePreview) imagePreview.src = '';
    if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
}

// Canvasを使った画像リサイズ・圧縮
function resizeAndCompressImage(file, maxWidth, maxHeight, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (readerEvent) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // JPEG形式で圧縮
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            };
            img.onerror = reject;
            img.src = readerEvent.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 画像拡大モーダル制御
function openImageModal(src) {
    if (imageModal && modalImage) {
        modalImage.src = src;
        imageModal.classList.add('active');
    }
}

function closeImageModal() {
    if (imageModal && modalImage) {
        imageModal.classList.remove('active');
        modalImage.src = '';
    }
}

if (closeImageModalBtn) {
    closeImageModalBtn.addEventListener('click', closeImageModal);
}

if (imageModal) {
    imageModal.addEventListener('click', (e) => {
        if (e.target === imageModal || e.target === closeImageModalBtn) {
            closeImageModal();
        }
    });
}


// --- 削除確認モーダル ---
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

if (switchToRegister) {
    switchToRegister.addEventListener('click', (e) => {
        e.preventDefault();
        isRegisterMode = !isRegisterMode;
        updateAuthModalUI();
    });
}

if (loginOpenBtn) loginOpenBtn.addEventListener('click', openLoginModal);
if (closeLoginBtn) closeLoginBtn.addEventListener('click', closeLoginModal);

if (authSubmitBtn) {
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
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        if (confirm("ログアウトしますか？")) {
            signOut(auth);
        }
    });
}

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        if (loginOpenBtn) loginOpenBtn.classList.add('hidden');
        if (userInfo) userInfo.classList.remove('hidden');
        if (displayUserName) displayUserName.innerText = user.displayName || user.email.split('@')[0];
        if (nameInput) {
            nameInput.value = user.displayName || '';
            nameInput.readOnly = true;
        }
    } else {
        if (loginOpenBtn) loginOpenBtn.classList.remove('hidden');
        if (userInfo) userInfo.classList.add('hidden');
        if (displayUserName) displayUserName.innerText = '';
        if (nameInput) {
            nameInput.value = '';
            nameInput.readOnly = false;
        }
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

// --- メッセージ送信 ---
async function sendMessage() {
    const name = nameInput.value.trim() || '名無しさん';
    const content = messageInput.value.trim();
    const image = currentImageBase64;

    if (!content && !image) {
        alert("メッセージまたは画像を入力してください！");
        return;
    }

    sendBtn.disabled = true;
    sendBtn.innerHTML = '送信中...';

    try {
        const messageData = {
            name: name,
            content: content,
            timestamp: serverTimestamp(),
            clientId: currentUser ? currentUser.uid : clientId,
            uid: currentUser ? currentUser.uid : null
        };

        if (image) {
            messageData.image = image;
        }

        await addDoc(collection(db, "messages"), messageData);
        messageInput.value = '';
        clearSelectedImage();
    } catch (e) {
        console.error(e);
        alert("送信に失敗しました: " + e.message);
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = `送信する <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
    }
}

if (sendBtn) sendBtn.addEventListener('click', sendMessage);

if (messageInput) {
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!e.isComposing) {
                sendMessage();
            }
        }
    });
}

// --- メッセージのリアルタイム購読 ---
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

// --- メッセージ要素描画 ---
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

    // 画像HTML
    let imageHtml = '';
    if (message.image) {
        imageHtml = `
            <div class="message-image-container">
                <img src="${message.image}" alt="投稿画像" class="message-image" loading="lazy">
            </div>
        `;
    }

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
        ${message.content ? `<div class="message-content">${sanitizeHTML(message.content)}</div>` : ''}
        ${imageHtml}
    `;

    // 画像クリックで拡大モーダル表示
    const imgEl = div.querySelector('.message-image');
    if (imgEl) {
        imgEl.addEventListener('click', (e) => {
            e.stopPropagation();
            openImageModal(message.image);
        });
    }

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

    // 5連打強制削除
    let tapCount = 0;
    let tapTimer = null;

    div.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'IMG') return;

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
            }, 400);
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
