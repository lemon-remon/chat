// ==============================================================================
// 2Dマルチプレイ対戦シューティングゲームエンジン (game.js)
// - 見下ろし型自由移動 & マウス/タッチ照準
// - リアルタイム銃撃戦 (弾丸シミュレーション、被弾判定、HP、リスポーン)
// - キルログ & スコアボード
// - Firebase Firestoreによる超低負荷同期 (発射イベント時・被弾時のみ通信)
// ==============================================================================

import {
    doc,
    setDoc,
    deleteDoc,
    onSnapshot,
    collection
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- ワールド & ゲーム設定 ---
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
const PLAYER_RADIUS = 22;
const PLAYER_SPEED = 300;
const BULLET_SPEED = 850;
const BULLET_RADIUS = 4.5;
const BULLET_LIFETIME = 2.2; // 弾の最大飛行秒数
const DAMAGE_PER_HIT = 25;
const SHOOT_COOLDOWN_MS = 200; // 連射間隔 (秒間最大5発)
const RESPAWN_TIME_SEC = 3.0;
const INVINCIBLE_TIME_SEC = 3.0; // リスポーン後の無敵シールド

// --- 通信最適化設定 ---
const SYNC_INTERVAL_MS = 250; // 移動中の同期頻度 (毎秒4回)
const INACTIVE_TIMEOUT_MS = 10000; // 10秒通信がなければ退場

// --- ゲーム内ステート ---
let canvas = null;
let ctx = null;
let dbInstance = null;
let currentUserInfo = null;

let isRunning = false;
let animationFrameId = null;
let unsubscribePlayers = null;
let mobileShootBtn = null;

// 自プレイヤー情報
let localPlayer = {
    uid: '',
    name: '',
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    vx: 0,
    vy: 0,
    angle: 0, // ラジアン
    color: '#8b5cf6',
    hp: 100,
    maxHp: 100,
    kills: 0,
    deaths: 0,
    isDead: false,
    respawnTimer: 0,
    invincibleTimer: 0,
    hitFlashTimer: 0,
    isMoving: false,
    lastSentX: -9999,
    lastSentY: -9999,
    lastSentAngle: -9999,
    lastSendTime: 0,
    lastShotId: ''
};

// カメラ座標 (自プレイヤーに追従)
let camera = {
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2
};

// 他プレイヤーのマップ (uid -> playerObject)
const remotePlayers = new Map();

// 弾丸配列
let bullets = [];

// パーティクル配列 (火花、爆発など)
let particles = [];

// キルログ配列 [{ id, text, time }]
let killLogs = [];

// キー入力
const keys = {
    up: false,
    down: false,
    left: false,
    right: false,
    shoot: false
};

// マウス & ポインタ
let mouse = {
    screenX: 0,
    screenY: 0,
    isDown: false,
    isShooting: false
};

let lastShootTimestamp = 0;
let lastTimestamp = 0;

// UIDからプレイヤーカラーを決定論的に生成
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
    mobileShootBtn = document.getElementById('mobileShootBtn');

    if (!canvas) {
        console.error('gameCanvas element not found');
        return;
    }
    ctx = canvas.getContext('2d');

    resizeCanvas();

    // 自プレイヤーの初期化
    const myName = user.displayName || (user.email ? user.email.split('@')[0] : 'ゲスト');
    localPlayer.uid = user.uid;
    localPlayer.name = myName;
    localPlayer.color = '#a855f7';
    localPlayer.hp = 100;
    localPlayer.maxHp = 100;
    localPlayer.kills = 0;
    localPlayer.deaths = 0;
    localPlayer.isDead = false;
    localPlayer.respawnTimer = 0;
    localPlayer.invincibleTimer = INVINCIBLE_TIME_SEC;
    localPlayer.hitFlashTimer = 0;

    // ワールド中央付近にスポーン
    spawnPlayerSafely();

    camera.x = localPlayer.x;
    camera.y = localPlayer.y;

    bullets = [];
    particles = [];
    killLogs = [];
    remotePlayers.clear();

    isRunning = true;
    lastTimestamp = performance.now();
    lastShootTimestamp = 0;

    attachEventListeners();
    subscribeRemotePlayers();

    // 初期状態をFirestoreに通知
    sendPlayerPosition(true);

    animationFrameId = requestAnimationFrame(gameLoop);
}

function spawnPlayerSafely() {
    localPlayer.x = WORLD_WIDTH / 2 + (Math.random() - 0.5) * 800;
    localPlayer.y = WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 800;
    localPlayer.vx = 0;
    localPlayer.vy = 0;
    localPlayer.lastSentX = -9999;
    localPlayer.lastSentY = -9999;
    localPlayer.lastSentAngle = -9999;
    localPlayer.lastSendTime = 0;
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

    if (unsubscribePlayers) {
        unsubscribePlayers();
        unsubscribePlayers = null;
    }

    // 退場時にFirestoreから自機ドキュメントを消去
    if (dbInstance && currentUserInfo) {
        const playerRef = doc(dbInstance, 'game_players', currentUserInfo.uid);
        deleteDoc(playerRef).catch(err => {
            console.warn('Failed to delete player doc on exit:', err);
        });
    }

    detachEventListeners();

    bullets = [];
    particles = [];
    remotePlayers.clear();
    mouse.isDown = false;
    mouse.isShooting = false;
    keys.up = keys.down = keys.left = keys.right = keys.shoot = false;
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
        case 'Space':
            keys.shoot = true;
            e.preventDefault();
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
        case 'Space':
            keys.shoot = false;
            break;
    }
}

function handlePointerDown(e) {
    if (!isRunning || !canvas) return;
    updatePointerCoords(e);

    // 左クリックまたは画面タップ
    if (e.button === 0 || e.pointerType === 'touch') {
        mouse.isDown = true;
        mouse.isShooting = true;
        tryShoot();
    }
}

function handlePointerMove(e) {
    if (!isRunning) return;
    updatePointerCoords(e);
}

function handlePointerUp(e) {
    if (e.button === 0 || e.pointerType === 'touch') {
        mouse.isDown = false;
        mouse.isShooting = false;
    }
}

function updatePointerCoords(e) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouse.screenX = e.clientX - rect.left;
    mouse.screenY = e.clientY - rect.top;

    // 自機（画面中央）からマウスへの角度を更新
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    localPlayer.angle = Math.atan2(mouse.screenY - centerY, mouse.screenX - centerX);
}

function handleMobileShootStart(e) {
    e.preventDefault();
    e.stopPropagation();
    mouse.isShooting = true;
    tryShoot();
}

function handleMobileShootEnd(e) {
    e.preventDefault();
    e.stopPropagation();
    mouse.isShooting = false;
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

    if (mobileShootBtn) {
        mobileShootBtn.addEventListener('pointerdown', handleMobileShootStart);
        window.addEventListener('pointerup', handleMobileShootEnd);
        window.addEventListener('pointercancel', handleMobileShootEnd);
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

    if (mobileShootBtn) {
        mobileShootBtn.removeEventListener('pointerdown', handleMobileShootStart);
    }
    window.removeEventListener('pointerup', handleMobileShootEnd);
    window.removeEventListener('pointercancel', handleMobileShootEnd);
    window.removeEventListener('beforeunload', handleBeforeUnload);
}

function handleBeforeUnload() {
    if (dbInstance && currentUserInfo) {
        const playerRef = doc(dbInstance, 'game_players', currentUserInfo.uid);
        deleteDoc(playerRef);
    }
}

// ==============================================================================
// 4. 射撃アクション & 弾丸生成
// ==============================================================================
function tryShoot() {
    if (!isRunning || localPlayer.isDead) return;

    const now = performance.now();
    if (now - lastShootTimestamp < SHOOT_COOLDOWN_MS) return;
    lastShootTimestamp = now;

    // 銃口の座標（自機の外周から少し前方）
    const muzzleDist = PLAYER_RADIUS + 12;
    const bulletX = localPlayer.x + Math.cos(localPlayer.angle) * muzzleDist;
    const bulletY = localPlayer.y + Math.sin(localPlayer.angle) * muzzleDist;

    const shotId = `${currentUserInfo.uid}_${Date.now()}`;
    localPlayer.lastShotId = shotId;

    // 1. ローカルで弾丸生成
    createBullet({
        id: shotId,
        shooterUid: currentUserInfo.uid,
        shooterName: localPlayer.name,
        x: bulletX,
        y: bulletY,
        angle: localPlayer.angle,
        color: localPlayer.color
    });

    // 2. マズルフラッシュパーティクル
    createMuzzleFlash(bulletX, bulletY, localPlayer.angle);

    // 3. Firestoreに発射イベントを同期（自機ドキュメントに更新）
    sendPlayerPosition(true, {
        shotId: shotId,
        x: Math.round(bulletX * 10) / 10,
        y: Math.round(bulletY * 10) / 10,
        angle: Math.round(localPlayer.angle * 100) / 100,
        time: Date.now()
    });
}

function createBullet(config) {
    const vx = Math.cos(config.angle) * BULLET_SPEED;
    const vy = Math.sin(config.angle) * BULLET_SPEED;

    bullets.push({
        id: config.id,
        shooterUid: config.shooterUid,
        shooterName: config.shooterName,
        x: config.x,
        y: config.y,
        vx: vx,
        vy: vy,
        angle: config.angle,
        color: config.color || '#f59e0b',
        radius: BULLET_RADIUS,
        lifetime: BULLET_LIFETIME
    });
}

// ==============================================================================
// 5. Firestore 通信同期（スロットル＆発射・被弾イベント）
// ==============================================================================
function sendPlayerPosition(force = false, shotEvent = null) {
    if (!dbInstance || !currentUserInfo || !isRunning) return;

    const now = performance.now();
    const isMoving = localPlayer.vx !== 0 || localPlayer.vy !== 0;

    const dx = Math.abs(localPlayer.x - localPlayer.lastSentX);
    const dy = Math.abs(localPlayer.y - localPlayer.lastSentY);
    const dAngle = Math.abs(localPlayer.angle - localPlayer.lastSentAngle);
    const hasMoved = dx > 0.5 || dy > 0.5 || dAngle > 0.08;

    const shouldSend = force ||
        shotEvent ||
        (isMoving && hasMoved && (now - localPlayer.lastSendTime >= SYNC_INTERVAL_MS)) ||
        (!isMoving && localPlayer.isMoving);

    if (shouldSend) {
        localPlayer.lastSentX = localPlayer.x;
        localPlayer.lastSentY = localPlayer.y;
        localPlayer.lastSentAngle = localPlayer.angle;
        localPlayer.lastSendTime = now;
        localPlayer.isMoving = isMoving;

        const updateData = {
            uid: currentUserInfo.uid,
            name: localPlayer.name,
            x: Math.round(localPlayer.x * 10) / 10,
            y: Math.round(localPlayer.y * 10) / 10,
            angle: Math.round(localPlayer.angle * 100) / 100,
            color: localPlayer.color,
            hp: localPlayer.hp,
            kills: localPlayer.kills,
            deaths: localPlayer.deaths,
            isDead: localPlayer.isDead,
            updatedAt: Date.now()
        };

        if (shotEvent) {
            updateData.lastShot = shotEvent;
        }

        const playerRef = doc(dbInstance, 'game_players', currentUserInfo.uid);
        setDoc(playerRef, updateData, { merge: true }).catch(err => {
            console.error('Error syncing game player state:', err);
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
            if (!data || data.uid === currentUserInfo?.uid) {
                // 自プレイヤーの最新データ（他プレイヤーからの被撃破通知など）を反映
                if (data && data.uid === currentUserInfo?.uid) {
                    if (typeof data.kills === 'number' && data.kills > localPlayer.kills) {
                        localPlayer.kills = data.kills;
                    }
                }
                return;
            }

            // 10秒以上更新のないプレイヤーはスキップ
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
                    angle: data.angle || 0,
                    targetAngle: data.angle || 0,
                    hp: typeof data.hp === 'number' ? data.hp : 100,
                    kills: data.kills || 0,
                    deaths: data.deaths || 0,
                    isDead: !!data.isDead,
                    lastSeen: data.updatedAt || now,
                    processedShotId: ''
                };
                remotePlayers.set(data.uid, existing);
            } else {
                existing.name = data.name || existing.name;
                existing.color = data.color || existing.color;
                existing.targetX = data.x;
                existing.targetY = data.y;
                existing.targetAngle = data.angle || 0;
                existing.hp = typeof data.hp === 'number' ? data.hp : existing.hp;
                existing.kills = data.kills || 0;
                existing.deaths = data.deaths || 0;
                existing.isDead = !!data.isDead;
                existing.lastSeen = data.updatedAt || now;
            }

            // リモートプレイヤーの発射イベント検知
            if (data.lastShot && data.lastShot.shotId && data.lastShot.shotId !== existing.processedShotId) {
                existing.processedShotId = data.lastShot.shotId;
                // 他プレイヤーの弾丸を生成
                createBullet({
                    id: data.lastShot.shotId,
                    shooterUid: data.uid,
                    shooterName: data.name || 'プレイヤー',
                    x: data.lastShot.x,
                    y: data.lastShot.y,
                    angle: data.lastShot.angle,
                    color: existing.color
                });
                createMuzzleFlash(data.lastShot.x, data.lastShot.y, data.lastShot.angle);
            }
        });

        // 退場したプレイヤーの消去
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
// 6. メインループ (更新 & 描画)
// ==============================================================================
function gameLoop(timestamp) {
    if (!isRunning) return;

    const deltaTime = Math.min((timestamp - lastTimestamp) / 1000, 0.1);
    lastTimestamp = timestamp;

    update(deltaTime);
    render();

    animationFrameId = requestAnimationFrame(gameLoop);
}

function update(dt) {
    // 連続射撃判定 (Spaceキー長押しまたはマウスクリックホールド)
    if ((keys.shoot || mouse.isShooting) && !localPlayer.isDead) {
        tryShoot();
    }

    // 被弾フラッシュタイマー
    if (localPlayer.hitFlashTimer > 0) {
        localPlayer.hitFlashTimer -= dt;
    }

    // 無敵シールドタイマー
    if (localPlayer.invincibleTimer > 0) {
        localPlayer.invincibleTimer -= dt;
    }

    // 死亡時リスポーンカウントダウン
    if (localPlayer.isDead) {
        localPlayer.respawnTimer -= dt;
        if (localPlayer.respawnTimer <= 0) {
            respawnLocalPlayer();
        }
    } else {
        // 自機の移動計算
        let moveX = 0;
        let moveY = 0;

        if (keys.up) moveY -= 1;
        if (keys.down) moveY += 1;
        if (keys.left) moveX -= 1;
        if (keys.right) moveX += 1;

        if (moveX !== 0 && moveY !== 0) {
            const len = Math.hypot(moveX, moveY);
            moveX /= len;
            moveY /= len;
        }

        localPlayer.vx = moveX * PLAYER_SPEED;
        localPlayer.vy = moveY * PLAYER_SPEED;

        localPlayer.x += localPlayer.vx * dt;
        localPlayer.y += localPlayer.vy * dt;

        localPlayer.x = Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH - PLAYER_RADIUS, localPlayer.x));
        localPlayer.y = Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT - PLAYER_RADIUS, localPlayer.y));
    }

    // カメラの滑らかな追従
    const targetCamX = localPlayer.x;
    const targetCamY = localPlayer.y;
    camera.x += (targetCamX - camera.x) * (1 - Math.exp(-10 * dt));
    camera.y += (targetCamY - camera.y) * (1 - Math.exp(-10 * dt));

    // 他プレイヤーの座標補間 (Lerp)
    remotePlayers.forEach(p => {
        p.currentX += (p.targetX - p.currentX) * (1 - Math.exp(-12 * dt));
        p.currentY += (p.targetY - p.currentY) * (1 - Math.exp(-12 * dt));
        // 角度の最短補間
        let diff = (p.targetAngle - p.angle) % (Math.PI * 2);
        if (diff < -Math.PI) diff += Math.PI * 2;
        if (diff > Math.PI) diff -= Math.PI * 2;
        p.angle += diff * (1 - Math.exp(-14 * dt));
    });

    // 弾丸の移動 & 当たり判定更新
    updateBullets(dt);

    // パーティクルの更新
    updateParticles(dt);

    // キルログのフェード管理
    updateKillLogs();

    // Firestore定期位置送信
    sendPlayerPosition();
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.lifetime -= dt;

        // ワールド境界外または寿命切れで消滅
        if (b.lifetime <= 0 || b.x < 0 || b.x > WORLD_WIDTH || b.y < 0 || b.y > WORLD_HEIGHT) {
            bullets.splice(i, 1);
            continue;
        }

        // 自プレイヤーへの被弾判定（他プレイヤーの弾のみ）
        if (b.shooterUid !== localPlayer.uid && !localPlayer.isDead) {
            const dist = Math.hypot(b.x - localPlayer.x, b.y - localPlayer.y);
            if (dist < PLAYER_RADIUS + b.radius) {
                // 無敵シールド中は弾を弾くだけでダメージなし
                if (localPlayer.invincibleTimer > 0) {
                    createSparkParticles(b.x, b.y, '#38bdf8');
                    bullets.splice(i, 1);
                    continue;
                }

                // 被弾処理！
                createSparkParticles(b.x, b.y, '#ef4444');
                localPlayer.hp = Math.max(0, localPlayer.hp - DAMAGE_PER_HIT);
                localPlayer.hitFlashTimer = 0.25;

                // 弾の消滅
                bullets.splice(i, 1);

                if (localPlayer.hp <= 0) {
                    // 撃破された！
                    handleLocalPlayerDeath(b.shooterUid, b.shooterName);
                } else {
                    // 残りHPをFirestoreに同期
                    sendPlayerPosition(true);
                }
                continue;
            }
        }
    }
}

// 撃破された時の処理
function handleLocalPlayerDeath(killerUid, killerName) {
    localPlayer.isDead = true;
    localPlayer.deaths += 1;
    localPlayer.respawnTimer = RESPAWN_TIME_SEC;

    // 爆発エフェクト
    createExplosion(localPlayer.x, localPlayer.y, localPlayer.color);

    // キルログ追加
    addKillLog(`${killerName} が ${localPlayer.name} を撃破！`);

    // 倒した相手のキル数を加算してあげる
    if (dbInstance && killerUid) {
        const killerRef = doc(dbInstance, 'game_players', killerUid);
        const killer = remotePlayers.get(killerUid);
        const currentKills = killer ? killer.kills : 0;
        setDoc(killerRef, {
            kills: currentKills + 1
        }, { merge: true }).catch(err => {
            console.warn('Failed to update killer stats:', err);
        });
    }

    // 自身の状態を同期
    sendPlayerPosition(true);
}

// リスポーン処理
function respawnLocalPlayer() {
    localPlayer.isDead = false;
    localPlayer.hp = localPlayer.maxHp;
    localPlayer.invincibleTimer = INVINCIBLE_TIME_SEC;
    spawnPlayerSafely();
    sendPlayerPosition(true);
}

// ==============================================================================
// 7. パーティクル & エフェクト
// ==============================================================================
function createMuzzleFlash(x, y, angle) {
    for (let i = 0; i < 6; i++) {
        const spread = (Math.random() - 0.5) * 0.8;
        const speed = 100 + Math.random() * 150;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle + spread) * speed,
            vy: Math.sin(angle + spread) * speed,
            color: '#fbbf24',
            radius: 2 + Math.random() * 2,
            lifetime: 0.15,
            maxLife: 0.15
        });
    }
}

function createSparkParticles(x, y, color) {
    for (let i = 0; i < 12; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * 180;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: color,
            radius: 2 + Math.random() * 3,
            lifetime: 0.35,
            maxLife: 0.35
        });
    }
}

function createExplosion(x, y, color) {
    for (let i = 0; i < 40; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 280;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: Math.random() > 0.4 ? color : '#f97316',
            radius: 3 + Math.random() * 5,
            lifetime: 0.7,
            maxLife: 0.7
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.lifetime -= dt;
        if (p.lifetime <= 0) {
            particles.splice(i, 1);
        }
    }
}

function addKillLog(text) {
    killLogs.unshift({
        id: Date.now() + Math.random(),
        text: text,
        time: performance.now()
    });
    if (killLogs.length > 5) killLogs.pop();
}

function updateKillLogs() {
    const now = performance.now();
    // 6秒以上前のキルログは削除
    killLogs = killLogs.filter(log => now - log.time < 6000);
}

// ==============================================================================
// 8. 描画 (レンダリング)
// ==============================================================================
function render() {
    if (!ctx || !canvas) return;
    if (canvas.width === 0 || canvas.height === 0) {
        resizeCanvas();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const offsetX = canvas.width / 2 - camera.x;
    const offsetY = canvas.height / 2 - camera.y;

    ctx.save();
    ctx.translate(offsetX, offsetY);

    // 1. ワールド背景 & グリッド
    drawWorldBackground();

    // 2. 他プレイヤー描画
    remotePlayers.forEach(p => {
        if (!p.isDead) {
            drawPlayer(p.currentX, p.currentY, p.angle, p.color, p.name, p.hp, false, 0, 0);
        }
    });

    // 3. 自プレイヤー描画
    if (!localPlayer.isDead) {
        drawPlayer(
            localPlayer.x,
            localPlayer.y,
            localPlayer.angle,
            localPlayer.color,
            localPlayer.name,
            localPlayer.hp,
            true,
            localPlayer.hitFlashTimer,
            localPlayer.invincibleTimer
        );
    }

    // 4. 弾丸描画
    drawBullets();

    // 5. パーティクル描画
    drawParticles();

    ctx.restore();

    // 6. UI / HUDオーバーレイ
    drawHUD();
}

function drawWorldBackground() {
    // ワールド床
    ctx.fillStyle = '#0f111e';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // グリッド線
    const gridSize = 100;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
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

    // 中央円形アリーナマーク
    ctx.beginPath();
    ctx.arc(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 200, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.15)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 外枠境界線 (危険ゾーン境界)
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
}

function drawPlayer(x, y, angle, color, name, hp, isLocal, hitFlash, invincible) {
    ctx.save();
    ctx.translate(x, y);

    // 被弾時赤フラッシュ効果
    const isFlashing = hitFlash > 0;
    const bodyColor = isFlashing ? '#ffffff' : color;

    // 1. 影
    ctx.beginPath();
    ctx.arc(0, 4, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fill();

    // 2. 無敵シールドオーラ
    if (invincible > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, PLAYER_RADIUS + 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        ctx.restore();
    }

    // 3. 銃身 (ガンバレル)
    ctx.save();
    ctx.rotate(angle);
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    // 銃身の矩形
    ctx.fillRect(PLAYER_RADIUS - 4, -5, 18, 10);
    ctx.strokeRect(PLAYER_RADIUS - 4, -5, 18, 10);
    ctx.restore();

    // 4. 自機グローリング
    if (isLocal) {
        ctx.beginPath();
        ctx.arc(0, 0, PLAYER_RADIUS + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.6)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
    }

    // 5. プレイヤー本体
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = bodyColor;
    ctx.fill();
    ctx.strokeStyle = isFlashing ? '#ef4444' : '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 6. アバター顔向きインジケーター（目）
    ctx.save();
    ctx.rotate(angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(7, -5, 3, 0, Math.PI * 2);
    ctx.arc(7, 5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(8.5, -5, 1.5, 0, Math.PI * 2);
    ctx.arc(8.5, 5, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 7. ネームプレート & HPバー
    const label = isLocal ? `${name} (あなた)` : name;
    ctx.font = 'bold 11px "Zen Kaku Gothic New", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textWidth = ctx.measureText(label).width;
    const tagPadding = 6;
    const tagHeight = 18;
    const tagY = -PLAYER_RADIUS - 22;

    // ネームプレート背景
    ctx.fillStyle = 'rgba(15, 15, 26, 0.85)';
    ctx.strokeStyle = isLocal ? '#a855f7' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-(textWidth / 2) - tagPadding, tagY - tagHeight / 2, textWidth + tagPadding * 2, tagHeight, 5);
    ctx.fill();
    ctx.stroke();

    // ネームテキスト
    ctx.fillStyle = isLocal ? '#e9d5ff' : '#ffffff';
    ctx.fillText(label, 0, tagY);

    // HPバー
    const barWidth = 44;
    const barHeight = 5;
    const barY = -PLAYER_RADIUS - 9;
    const hpRatio = Math.max(0, Math.min(1, hp / 100));

    // 背景バー
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(-barWidth / 2, barY, barWidth, barHeight);

    // 残りHPバー
    let hpColor = '#22c55e'; // 緑
    if (hpRatio < 0.35) hpColor = '#ef4444'; // 赤
    else if (hpRatio < 0.65) hpColor = '#eab308'; // 黄

    ctx.fillStyle = hpColor;
    ctx.fillRect(-barWidth / 2, barY, barWidth * hpRatio, barHeight);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-barWidth / 2, barY, barWidth, barHeight);

    ctx.restore();
}

function drawBullets() {
    bullets.forEach(b => {
        ctx.save();

        // 弾のグロー光彩
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius + 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.3)';
        ctx.fill();

        // 弾の本体
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fillStyle = b.color || '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.restore();
    });
}

function drawParticles() {
    particles.forEach(p => {
        ctx.save();
        const alpha = Math.max(0, p.lifetime / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.restore();
    });
}

function drawHUD() {
    ctx.save();

    // 1. キルログ (画面上部中央)
    const logStartY = 20;
    const now = performance.now();
    killLogs.forEach((log, index) => {
        const age = (now - log.time) / 1000;
        const alpha = Math.max(0, 1 - age / 5.5);
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 13px "Zen Kaku Gothic New", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const textWidth = ctx.measureText(log.text).width;
        const boxWidth = textWidth + 24;
        const boxHeight = 24;
        const logY = logStartY + index * 30;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.beginPath();
        ctx.roundRect(canvas.width / 2 - boxWidth / 2, logY, boxWidth, boxHeight, 6);
        ctx.fill();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#f87171';
        ctx.fillText(log.text, canvas.width / 2, logY + 5);
    });

    ctx.globalAlpha = 1.0;

    // 2. 撃破時のリスポーン待機アナウンス (画面中央)
    if (localPlayer.isDead) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 28px "Zen Kaku Gothic New", sans-serif';
        ctx.fillStyle = '#ef4444';
        ctx.fillText('撃破されました！', canvas.width / 2, canvas.height / 2 - 25);

        ctx.font = 'bold 18px "Zen Kaku Gothic New", sans-serif';
        ctx.fillStyle = '#ffffff';
        const remaining = Math.max(0, Math.ceil(localPlayer.respawnTimer));
        ctx.fillText(`リスポーンまで ${remaining} 秒...`, canvas.width / 2, canvas.height / 2 + 15);
    }

    // 3. 自機ステータス HUD (画面左下)
    const hudX = 20;
    const hudY = canvas.height - 35;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold 14px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`HP: ${localPlayer.hp} / 100`, hudX, hudY - 14);

    // HPゲージ
    const hpBarW = 160;
    const hpBarH = 10;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(hudX, hudY - 10, hpBarW, hpBarH);

    const ratio = Math.max(0, Math.min(1, localPlayer.hp / 100));
    ctx.fillStyle = ratio > 0.5 ? '#22c55e' : (ratio > 0.25 ? '#eab308' : '#ef4444');
    ctx.fillRect(hudX, hudY - 10, hpBarW * ratio, hpBarH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(hudX, hudY - 10, hpBarW, hpBarH);

    ctx.font = '11px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fillText('⌨️ 移動: WASD / 矢印  🎯 エイム: マウス  💥 射撃: 左クリック / Space', hudX, canvas.height - 12);

    // 4. スコアボード (画面右上)
    drawScoreboard();

    ctx.restore();
}

function drawScoreboard() {
    // 全プレイヤーをキル数順にソート
    const allPlayers = [
        { name: `${localPlayer.name} (あなた)`, kills: localPlayer.kills, deaths: localPlayer.deaths, isMe: true }
    ];

    remotePlayers.forEach(p => {
        allPlayers.push({ name: p.name, kills: p.kills, deaths: p.deaths, isMe: false });
    });

    allPlayers.sort((a, b) => b.kills - a.kills);

    const sbWidth = 190;
    const rowHeight = 22;
    const sbHeight = 32 + allPlayers.length * rowHeight;
    const sbX = canvas.width - sbWidth - 16;
    const sbY = 16;

    // 背景
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(sbX, sbY, sbWidth, sbHeight, 8);
    ctx.fill();
    ctx.stroke();

    // ヘッダー
    ctx.font = 'bold 12px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = '#a855f7';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('🏆 スコアボード', sbX + 10, sbY + 8);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('K / D', sbX + sbWidth - 10, sbY + 8);

    // プレイヤー行
    ctx.font = '11px "Zen Kaku Gothic New", sans-serif';
    allPlayers.forEach((p, idx) => {
        const rowY = sbY + 28 + idx * rowHeight;
        ctx.textAlign = 'left';
        ctx.fillStyle = p.isMe ? '#c084fc' : '#e2e8f0';

        // 名前（長い場合は省略）
        let displayName = p.name;
        if (displayName.length > 10) displayName = displayName.slice(0, 9) + '…';
        ctx.fillText(`${idx + 1}. ${displayName}`, sbX + 10, rowY);

        ctx.textAlign = 'right';
        ctx.fillStyle = p.isMe ? '#e9d5ff' : '#cbd5e1';
        ctx.fillText(`${p.kills} / ${p.deaths}`, sbX + sbWidth - 10, rowY);
    });
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
