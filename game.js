// ==============================================================================
// 2Dマルチプレイゲームエンジン (game.js)
// - 見下ろし型自由移動 (WASD / 矢印キー / クリック・タップ移動)
// - スムーズなカメラ追従
// - Firebase Firestoreによる低負荷・リアルタイム位置同期 (Lerp補間)
// ==============================================================================

import {
    doc,
    setDoc,
    deleteDoc,
    onSnapshot,
    collection
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- ワールド設定 ---
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
const PLAYER_RADIUS = 22;
const PLAYER_SPEED = 320; // 1秒あたりのピクセル移動速度

// --- 通信最適化設定 ---
const SYNC_INTERVAL_MS = 250; // 移動中の送信間隔 (毎秒4回)
const INACTIVE_TIMEOUT_MS = 10000; // 10秒更新がないプレイヤーは非表示

// --- ゲーム内ステート ---
let canvas = null;
let ctx = null;
let dbInstance = null;
let currentUserInfo = null;

let isRunning = false;
let animationFrameId = null;
let unsubscribePlayers = null;

// 自プレイヤー情報
let localPlayer = {
    uid: '',
    name: '',
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    vx: 0,
    vy: 0,
    color: '#8b5cf6',
    isMoving: false,
    lastSentX: -9999,
    lastSentY: -9999,
    lastSendTime: 0
};

// カメラ座標 (画面中央に追従)
let camera = {
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2
};

// 他プレイヤーのマップ (uid -> playerObject)
const remotePlayers = new Map();

// 入力状態
const keys = {
    up: false,
    down: false,
    left: false,
    right: false
};

// ポインタ (マウス/タッチ) 操作
let pointer = {
    active: false,
    screenX: 0,
    screenY: 0
};

// 最終更新時刻 (deltaTime計算用)
let lastTimestamp = 0;

// UIDからユニークな色を生成（見た目を識別しやすくする）
function generateColorFromUid(uid) {
    if (!uid) return '#3b82f6';
    let hash = 0;
    for (let i = 0; i < uid.length; i++) {
        hash = uid.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 75%, 60%)`;
}

// ==============================================================================
// 1. ゲームの初期化 & 開始
// ==============================================================================
export function startMultiplayerGame(db, user) {
    if (isRunning) return;

    dbInstance = db;
    currentUserInfo = user;

    canvas = document.getElementById('gameCanvas');
    if (!canvas) {
        console.error('gameCanvas element not found');
        return;
    }
    ctx = canvas.getContext('2d');

    // キャンバスの解像度調整
    resizeCanvas();

    // 自プレイヤーの初期化
    const myName = user.displayName || (user.email ? user.email.split('@')[0] : 'ゲスト');
    localPlayer.uid = user.uid;
    localPlayer.name = myName;
    localPlayer.color = '#a855f7'; // 自プレイヤーは際立つパープル
    // スポーン位置をワールド中央付近にランダム配置
    localPlayer.x = WORLD_WIDTH / 2 + (Math.random() - 0.5) * 400;
    localPlayer.y = WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 400;
    localPlayer.lastSentX = -9999;
    localPlayer.lastSentY = -9999;
    localPlayer.lastSendTime = 0;

    camera.x = localPlayer.x;
    camera.y = localPlayer.y;

    isRunning = true;
    lastTimestamp = performance.now();

    // イベントリスナーの登録
    attachEventListeners();

    // Firestoreの同期購読を開始
    subscribeRemotePlayers();

    // 初回の自分自身の位置をFirestoreに通知
    sendPlayerPosition(true);

    // メインループの開始
    animationFrameId = requestAnimationFrame(gameLoop);
}

// ==============================================================================
// 2. ゲームの停止 & クリーンアップ
// ==============================================================================
export function stopMultiplayerGame() {
    if (!isRunning) return;
    isRunning = false;

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // リモートプレイヤー購読解除
    if (unsubscribePlayers) {
        unsubscribePlayers();
        unsubscribePlayers = null;
    }

    // Firestore上の自分のプレイヤーデータを削除
    if (dbInstance && currentUserInfo) {
        const playerRef = doc(dbInstance, 'game_players', currentUserInfo.uid);
        deleteDoc(playerRef).catch(err => {
            console.warn('Failed to remove player on exit:', err);
        });
    }

    // イベントリスナーの解除
    detachEventListeners();

    // 内部状態のリセット
    remotePlayers.clear();
    pointer.active = false;
    keys.up = keys.down = keys.left = keys.right = false;
}

// ==============================================================================
// 3. 入力イベント処理
// ==============================================================================
function handleKeyDown(e) {
    if (!isRunning) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
            keys.up = true;
            break;
        case 'KeyS':
        case 'ArrowDown':
            keys.down = true;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            keys.left = true;
            break;
        case 'KeyD':
        case 'ArrowRight':
            keys.right = true;
            break;
    }
}

function handleKeyUp(e) {
    if (!isRunning) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
            keys.up = false;
            break;
        case 'KeyS':
        case 'ArrowDown':
            keys.down = false;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            keys.left = false;
            break;
        case 'KeyD':
        case 'ArrowRight':
            keys.right = false;
            break;
    }
}

function handlePointerDown(e) {
    if (!isRunning || !canvas) return;
    pointer.active = true;
    updatePointerCoords(e);
}

function handlePointerMove(e) {
    if (!isRunning || !pointer.active) return;
    updatePointerCoords(e);
}

function handlePointerUp() {
    pointer.active = false;
}

function updatePointerCoords(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.screenX = e.clientX - rect.left;
    pointer.screenY = e.clientY - rect.top;
}

function attachEventListeners() {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('resize', resizeCanvas);

    if (canvas) {
        canvas.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
}

function detachEventListeners() {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('resize', resizeCanvas);

    if (canvas) {
        canvas.removeEventListener('pointerdown', handlePointerDown);
    }
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
    window.removeEventListener('beforeunload', handleBeforeUnload);
}

function handleBeforeUnload() {
    if (dbInstance && currentUserInfo) {
        const playerRef = doc(dbInstance, 'game_players', currentUserInfo.uid);
        deleteDoc(playerRef);
    }
}

// ==============================================================================
// 4. Firestore リアルタイム同期（最適化スロットル送信）
// ==============================================================================
function sendPlayerPosition(force = false) {
    if (!dbInstance || !currentUserInfo || !isRunning) return;

    const now = performance.now();
    const isMoving = localPlayer.vx !== 0 || localPlayer.vy !== 0;

    // 前回の位置と現在位置の差分
    const dx = Math.abs(localPlayer.x - localPlayer.lastSentX);
    const dy = Math.abs(localPlayer.y - localPlayer.lastSentY);
    const hasMoved = dx > 0.5 || dy > 0.5;

    // 停止した瞬間の1回送信、または移動中の定期送信
    const shouldSend = force ||
        (isMoving && hasMoved && (now - localPlayer.lastSendTime >= SYNC_INTERVAL_MS)) ||
        (!isMoving && localPlayer.isMoving); // 動きから停止へ変化した瞬間に確実同期

    if (shouldSend) {
        localPlayer.lastSentX = localPlayer.x;
        localPlayer.lastSentY = localPlayer.y;
        localPlayer.lastSendTime = now;
        localPlayer.isMoving = isMoving;

        const playerRef = doc(dbInstance, 'game_players', currentUserInfo.uid);
        setDoc(playerRef, {
            uid: currentUserInfo.uid,
            name: localPlayer.name,
            x: Math.round(localPlayer.x * 10) / 10,
            y: Math.round(localPlayer.y * 10) / 10,
            color: localPlayer.color,
            updatedAt: Date.now()
        }, { merge: true }).catch(err => {
            console.error('Error syncing player position:', err);
        });
    }
}

function subscribeRemotePlayers() {
    if (!dbInstance) return;

    const playersCol = collection(dbInstance, 'game_players');
    unsubscribePlayers = onSnapshot(playersCol, (snapshot) => {
        const now = Date.now();
        const activeUids = new Set();

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (!data || data.uid === currentUserInfo?.uid) return;

            // 10秒以上更新のないプレイヤーはスキップ（ゴースト対策）
            if (data.updatedAt && (now - data.updatedAt > INACTIVE_TIMEOUT_MS)) {
                return;
            }

            activeUids.add(data.uid);

            let existing = remotePlayers.get(data.uid);
            if (!existing) {
                existing = {
                    uid: data.uid,
                    name: data.name || 'プレイヤー',
                    color: data.color || generateColorFromUid(data.uid),
                    currentX: data.x,
                    currentY: data.y,
                    targetX: data.x,
                    targetY: data.y,
                    lastSeen: data.updatedAt || now
                };
                remotePlayers.set(data.uid, existing);
            } else {
                existing.name = data.name || existing.name;
                existing.color = data.color || existing.color;
                existing.targetX = data.x;
                existing.targetY = data.y;
                existing.lastSeen = data.updatedAt || now;
            }
        });

        // 存在しなくなったプレイヤーを削除
        for (const [uid] of remotePlayers.entries()) {
            if (!activeUids.has(uid)) {
                remotePlayers.delete(uid);
            }
        }
    }, (err) => {
        console.error('Remote players snapshot error:', err);
    });
}

// ==============================================================================
// 5. 更新＆描画ループ
// ==============================================================================
function gameLoop(timestamp) {
    if (!isRunning) return;

    const deltaTime = Math.min((timestamp - lastTimestamp) / 1000, 0.1); // 最大100msで制限
    lastTimestamp = timestamp;

    update(deltaTime);
    render();

    animationFrameId = requestAnimationFrame(gameLoop);
}

function update(dt) {
    // 1. 移動ベクトルの算出
    let moveX = 0;
    let moveY = 0;

    // キーボード入力
    if (keys.up) moveY -= 1;
    if (keys.down) moveY += 1;
    if (keys.left) moveX -= 1;
    if (keys.right) moveX += 1;

    // ポインタ（クリック / タップ）入力
    if (pointer.active && canvas) {
        // 画面上の自プレイヤーの中心座標
        const screenCenterX = canvas.width / 2;
        const screenCenterY = canvas.height / 2;
        const pdx = pointer.screenX - screenCenterX;
        const pdy = pointer.screenY - screenCenterY;
        const pdist = Math.hypot(pdx, pdy);

        // 自キャラ周辺の小さなデッドゾーン（半径15px以内は止まる）
        if (pdist > 15) {
            moveX = pdx / pdist;
            moveY = pdy / pdist;
        }
    } else if (moveX !== 0 && moveY !== 0) {
        // キーボードの斜め移動を正規化
        const len = Math.hypot(moveX, moveY);
        moveX /= len;
        moveY /= len;
    }

    localPlayer.vx = moveX * PLAYER_SPEED;
    localPlayer.vy = moveY * PLAYER_SPEED;

    // プレイヤー位置更新
    localPlayer.x += localPlayer.vx * dt;
    localPlayer.y += localPlayer.vy * dt;

    // マップ境界制限 (クランプ)
    localPlayer.x = Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH - PLAYER_RADIUS, localPlayer.x));
    localPlayer.y = Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT - PLAYER_RADIUS, localPlayer.y));

    // カメラの滑らかな追従 (Lerp)
    const targetCamX = localPlayer.x;
    const targetCamY = localPlayer.y;
    camera.x += (targetCamX - camera.x) * (1 - Math.exp(-10 * dt));
    camera.y += (targetCamY - camera.y) * (1 - Math.exp(-10 * dt));

    // 他プレイヤーの座標補間 (Lerp)
    remotePlayers.forEach(p => {
        p.currentX += (p.targetX - p.currentX) * (1 - Math.exp(-12 * dt));
        p.currentY += (p.targetY - p.currentY) * (1 - Math.exp(-12 * dt));
    });

    // Firestoreへの位置同期（スロットル判定）
    sendPlayerPosition();
}

function render() {
    if (!ctx || !canvas) return;
    if (canvas.width === 0 || canvas.height === 0) {
        resizeCanvas();
    }

    // 画面クリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // カメラのワールド原点オフセット
    const offsetX = canvas.width / 2 - camera.x;
    const offsetY = canvas.height / 2 - camera.y;

    ctx.save();
    ctx.translate(offsetX, offsetY);

    // 1. マップ背景・グリッド描画
    drawWorldBackground();

    // 2. 他プレイヤー描画
    remotePlayers.forEach(p => {
        drawPlayer(p.currentX, p.currentY, p.color, p.name, false);
    });

    // 3. 自分プレイヤー描画
    drawPlayer(localPlayer.x, localPlayer.y, localPlayer.color, localPlayer.name, true);

    ctx.restore();

    // 4. UIオーバーレイ（ミニHUD）描画
    drawHUD();
}

// ==============================================================================
// 6. レンダリング詳細関数
// ==============================================================================
function drawWorldBackground() {
    // ワールド内背景
    ctx.fillStyle = '#121224';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // グリッド線描画
    const gridSize = 100;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let x = 0; x <= WORLD_WIDTH; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, WORLD_HEIGHT);
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(WORLD_WIDTH, y);
    }
    ctx.stroke();

    // 中央シンボル描画
    ctx.beginPath();
    ctx.arc(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 80, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.2)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 外枠境界線 (ネオンボーダー)
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
}

function drawPlayer(x, y, color, name, isLocal) {
    ctx.save();

    // 影
    ctx.beginPath();
    ctx.arc(x, y + 4, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();

    // 自分の周りのグローエフェクト
    if (isLocal) {
        ctx.beginPath();
        ctx.arc(x, y, PLAYER_RADIUS + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.5)';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    // プレイヤー本体の円
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // アバター内の簡易アイコン（目など）
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - 6, y - 3, 3, 0, Math.PI * 2);
    ctx.arc(x + 6, y - 3, 3, 0, Math.PI * 2);
    ctx.fill();

    // 名前タグ
    const label = isLocal ? `${name} (あなた)` : name;
    ctx.font = 'bold 12px "Zen Kaku Gothic New", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textWidth = ctx.measureText(label).width;
    const tagPadding = 8;
    const tagHeight = 22;
    const tagY = y - PLAYER_RADIUS - 18;

    // ネームプレートの角丸背景
    ctx.fillStyle = 'rgba(15, 15, 26, 0.85)';
    ctx.strokeStyle = isLocal ? '#a855f7' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - (textWidth / 2) - tagPadding, tagY - tagHeight / 2, textWidth + tagPadding * 2, tagHeight, 6);
    ctx.fill();
    ctx.stroke();

    // ネームテキスト
    ctx.fillStyle = isLocal ? '#e9d5ff' : '#ffffff';
    ctx.fillText(label, x, tagY);

    ctx.restore();
}

function drawHUD() {
    // 画面左下の操作ヒント
    ctx.save();
    ctx.font = '12px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('⌨️ WASD / 矢印キー または 画面クリック・長押しで移動', 16, canvas.height - 16);

    // 画面右下の参加者数インジケーター
    const totalCount = remotePlayers.size + 1;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#a855f7';
    ctx.fillText(`🎮 プレイヤー: ${totalCount}人`, canvas.width - 16, canvas.height - 16);
    ctx.restore();
}

function resizeCanvas() {
    if (!canvas) return;
    const container = canvas.parentElement;
    if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
    } else {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
}
