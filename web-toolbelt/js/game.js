import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

    /* Nickname display font. All player nicknames — the floating 3D label above each character,
     * the P2P player graph, chat, and the interaction menu — use this one HUD font consistently
     * (see --font-hud in css/game.css for why it's "Big Shoulders Display" and not the actual
     * Fortnite typeface). CSS @font-face alone doesn't make a font usable by <canvas> text — the
     * 3D label and the player-graph nicknames are drawn onto canvases, so the font has to be
     * explicitly loaded via the Font Loading API before anything draws with it, or the canvas
     * silently falls back to the browser default. This kicks the load off immediately; it's
     * normally done well before the first character model finishes loading.
     */
    const NICK_FONT_FAMILY = '"Big Shoulders Display", sans-serif';
    const nickFontReady = Promise.all([
        document.fonts.load('900 46px "Big Shoulders Display"'),
        document.fonts.load('700 20px "Big Shoulders Display"')
    ]).catch(() => {}); // fonts.load() rejects if the family truly can't load; fall back silently
    nickFontReady.then(() => drawGraph()); // redraw once the font is actually ready, in case it beat the first draw

    /* =========================================================================================
     * NETWORK / MULTIPLAYER LAYER
     * Shared WebSocket relay: player avatars, chat, and (new) qFoldIT scientific-state sync.
     * ========================================================================================= */
    const SERVER_URL = "wss://game-ws-server.onrender.com";
    let myId = null;
    let myNickname = "Player";
    const players = new Map(); // id -> { model, mixer, actions, targetPos, targetRot, targetAnim, nick, messageIconSprite }
    const unreadCounts = new Map(); // sender id -> unread count

    // Every nickname shown in the UI (3D label, player graph, chat header, notifications) goes
    // through this single choke point. It strips anything outside printable ASCII — Cyrillic
    // included — so a stale/unpatched server, a third-party relay, or a player's own free-text
    // input can never surface non-English text anywhere in the running app. When nothing usable
    // survives the filter, it falls back to the same "Player 1234" pattern used everywhere else.
    function sanitizeNick(raw, fallbackId) {
        const cleaned = typeof raw === 'string' ? raw.replace(/[^\x20-\x7E]/g, '').trim() : '';
        return cleaned || ('Player ' + String(fallbackId || '').slice(0, 4));
    }

    const ws = new WebSocket(SERVER_URL);
    ws.onopen = () => console.log('WebSocket connected');
    ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch (e) { return; }
        switch (msg.type) {
            case 'welcome':
                myId = msg.id;
                myNickname = "Player " + myId.slice(0, 4);
                msg.players.forEach(p => { if (p.id !== myId) addRemotePlayer(p.id, sanitizeNick(p.nick, p.id), p.character); });
                if (msg.scienceState) applyRemoteScientificState(msg.scienceState, 'the session'); // catch up on the current experiment
                drawGraph();
                updateLabPlayerCount();
                break;
            case 'player-joined':
                if (msg.id !== myId) addRemotePlayer(msg.id, sanitizeNick(msg.nick, msg.id), msg.character);
                updateLabPlayerCount();
                break;
            case 'player-left':
                removeRemotePlayer(msg.id);
                updateLabPlayerCount();
                break;
            case 'nickname-changed':
                if (msg.id !== myId && players.has(msg.id)) {
                    const p = players.get(msg.id);
                    p.nick = sanitizeNick(msg.nick, msg.id);
                    if (p.model) {
                        const oldLabel = p.model.getObjectByName('label');
                        if (oldLabel) p.model.remove(oldLabel);
                        const newLabel = createTextLabel(p.nick, '#444');
                        newLabel.name = 'label';
                        p.model.add(newLabel);
                    }
                    drawGraph();
                }
                break;
            case 'character-changed':
                if (msg.id !== myId && players.has(msg.id)) {
                    const p = players.get(msg.id);
                    const nick = p.nick;
                    removeRemotePlayer(msg.id);
                    addRemotePlayer(msg.id, nick, msg.character);
                }
                break;
            case 'pos':
                if (msg.id !== myId && players.has(msg.id)) {
                    const p = players.get(msg.id);
                    p.targetPos.set(msg.x, msg.y, msg.z);
                    p.targetRot.set(msg.rx, msg.ry, msg.rz, msg.rw);
                    p.targetAnim = msg.anim;
                }
                break;
            case 'chat':
                if (msg.to === myId || msg.from === myId) receiveChat(msg.from, msg.to, msg.text, msg.timestamp);
                break;
            case 'chat-history':
                if (msg.partnerId === currentTargetId) renderHistoryMessages(msg.messages);
                break;

            // ---- qFoldIT scientific-state session sync (relayed like any other message) ----
            case 'science-state':
                if (msg.originId !== myId) applyRemoteScientificState(msg.state, sanitizeNick(msg.originNick, msg.originId));
                break;
            case 'science-clear':
                if (msg.originId !== myId) applyRemoteScientificClear(sanitizeNick(msg.originNick, msg.originId));
                break;
        }
        drawGraph();
    };
    ws.onclose = () => {
        showNotification('System', 'Connection to the server was lost. Please refresh the page.', true);
    };

    function safeSend(payload) {
        if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify(payload)); } catch (e) { console.warn('WS send failed', e); }
        }
    }

    setInterval(() => {
        if (!localModel || !myId) return;
        const joystickMag = Math.hypot(mobileMove.x, mobileMove.y);
        const isMoving = keys.w || keys.a || keys.s || keys.d || joystickMag > 0.15;
        const running = keys.shift || mobileRunActive;
        const currentAnim = isMoving ? (running ? 'run' : 'walk') : 'idle';
        safeSend({
            type: 'pos', id: myId,
            x: localModel.position.x, y: localModel.position.y, z: localModel.position.z,
            rx: localModel.quaternion.x, ry: localModel.quaternion.y, rz: localModel.quaternion.z, rw: localModel.quaternion.w,
            anim: currentAnim
        });
    }, 50);

    /* =========================================================================================
     * 3D SCENE
     * ========================================================================================= */
    let scene, camera, renderer, clock, controls, raycaster, mouse;
    let localModel, localMixer;
    const localActions = { idle: null, walk: null, run: null };
    const keys = { w: false, a: false, s: false, d: false, shift: false };
    // ---- mobile touch controls state ----
    const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const mobileMove = { x: 0, y: 0 }; // -1..1 on each axis, driven by the on-screen joystick
    let mobileRunActive = false;
    const walkDirection = new THREE.Vector3();
    const rotateQuaternion = new THREE.Quaternion();
    const cameraTarget = new THREE.Vector3();

    /* ---- Character library ----
     * Each character uses ONLY its own bundled animation clip(s) — no cross-model retargeting.
     * That was tried for Xbot/Ybot (both use `mixamorig:*` bone names, which looked promising),
     * but their skins bind 67 vs 65 joints respectively: same names, different joint sets, and
     * applying one's clips to the other visibly breaks skinning (limbs detach from the torso).
     * So every model here is self-contained instead:
     *   - Xbot ships its own idle/walk/run/etc. clips — full animation, nothing to work around.
     *   - Ybot ships a single unnamed baked clip — used as its idle pose (see loadCharacterModel).
     *   - The mannequin (a different, Unreal-Engine-style skeleton entirely) ships one
     *     'Male_commando_Idle_2' clip — likewise used as idle.
     * Ybot and the mannequin therefore hold their idle pose while moving instead of a real walk
     * cycle — translation, rotation, and multiplayer sync all still work correctly. A true walk
     * cycle for either needs a matching walk/run clip authored on that same skeleton.
     */
    const CHARACTER_LIBRARY = {
        mannequin: { label: 'Mannequin', url: 'assets/models/creative-mannequin.glb' },
        xbot: { label: 'Xbot (female)', url: 'assets/models/Xbot.glb' },
        ybot: { label: 'Ybot (male)', url: 'assets/models/Ybot.glb' }
    };
    const DEFAULT_CHARACTER_KEY = 'xbot';
    function isValidCharacterKey(key) { return Object.prototype.hasOwnProperty.call(CHARACTER_LIBRARY, key); }
    function sanitizeCharacterKey(key) { return isValidCharacterKey(key) ? key : DEFAULT_CHARACTER_KEY; }

    let myCharacterKey = DEFAULT_CHARACTER_KEY;

    // Loads any character from CHARACTER_LIBRARY using only its own bundled clip(s). Matches
    // clips named "idle"/"walk"/"run" where present; if nothing matches "idle" but the file has
    // at least one clip (e.g. Ybot's single unnamed clip), that first clip is used as idle so the
    // mesh isn't left frozen in its raw bind pose. Returns { model, mixer, actions }.
    async function loadCharacterModel(key) {
        const def = CHARACTER_LIBRARY[sanitizeCharacterKey(key)];
        const gltf = await new Promise((resolve, reject) => new GLTFLoader().load(def.url, resolve, undefined, reject));
        const model = gltf.scene;
        const mixer = new THREE.AnimationMixer(model);
        const actions = { idle: null, walk: null, run: null };

        gltf.animations.forEach(clip => {
            const n = clip.name.toLowerCase();
            if (n.includes('idle') && !actions.idle) actions.idle = clip;
            else if (n.includes('run') && !actions.run) actions.run = clip;
            else if (n.includes('walk') && !actions.walk) actions.walk = clip;
        });
        if (!actions.idle && gltf.animations.length > 0) actions.idle = gltf.animations[0];

        Object.keys(actions).forEach(k => {
            if (!actions[k]) return;
            const action = mixer.clipAction(actions[k]);
            actions[k] = action;
            action.play();
            action.setEffectiveWeight(k === 'idle' ? 1 : 0);
        });
        return { model, mixer, actions };
    }

    let currentTargetId = null;
    let currentTargetNick = '';

    const graphCanvas = document.getElementById('p2p-graph');
    const graphCtx = graphCanvas.getContext('2d');

    function drawGraph() {
        if (!graphCtx) return;
        const w = graphCanvas.width, h = graphCanvas.height;
        graphCtx.clearRect(0, 0, w, h);
        const ids = [myId, ...players.keys()].filter(Boolean);
        const centerX = w / 2, centerY = h / 2 - 10, radius = Math.min(w, h) * 0.3;
        const positions = new Map();
        ids.forEach((id, i) => {
            const angle = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
            positions.set(id, { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius });
        });
        graphCtx.beginPath();
        graphCtx.strokeStyle = '#FFFFFF';
        graphCtx.lineWidth = 2;
        const idList = Array.from(positions.keys());
        for (let i = 0; i < idList.length; i++) {
            for (let j = i + 1; j < idList.length; j++) {
                const p1 = positions.get(idList[i]), p2 = positions.get(idList[j]);
                graphCtx.moveTo(p1.x, p1.y);
                graphCtx.lineTo(p2.x, p2.y);
            }
        }
        graphCtx.stroke();
        positions.forEach((pos, id) => {
            const nick = id === myId ? myNickname : (players.get(id)?.nick || id.slice(0, 4));
            graphCtx.beginPath();
            graphCtx.arc(pos.x, pos.y, 14, 0, Math.PI * 2);
            graphCtx.fillStyle = id === myId ? '#007bff' : '#28a745';
            graphCtx.fill();
            graphCtx.strokeStyle = '#ffffff';
            graphCtx.lineWidth = 2;
            graphCtx.stroke();
            graphCtx.font = `700 12px ${NICK_FONT_FAMILY}`;
            graphCtx.fillStyle = '#000000';
            graphCtx.textAlign = 'center';
            graphCtx.textBaseline = 'top';
            graphCtx.fillText(nick.length > 8 ? nick.slice(0, 7) + '…' : nick, pos.x, pos.y + 20);
        });
        graphCtx.font = 'bold 10px sans-serif';
        graphCtx.fillText(`Players (${ids.length})`, centerX, h - 10);
    }

    function addRemotePlayer(id, nick, characterKey) {
        const key = sanitizeCharacterKey(characterKey);
        const model = new THREE.Group();
        model.userData.playerId = id;
        scene.add(model);
        players.set(id, { model, loading: true, nick, characterKey: key, messageIconSprite: null });
        unreadCounts.set(id, 0);
        loadCharacterModel(key).then(({ model: newModel, mixer, actions }) => {
            // The player may have disconnected while the model was loading.
            if (!players.has(id)) { scene.remove(newModel); return; }
            newModel.userData.playerId = id;
            scene.remove(model);
            scene.add(newModel);
            newModel.traverse(c => { if (c.isMesh) c.userData.isPlayer = true; });
            const label = createTextLabel(nick, '#444');
            label.name = 'label';
            newModel.add(label);
            players.set(id, {
                model: newModel, mixer, actions, nick, characterKey: key,
                targetPos: new THREE.Vector3(),
                targetRot: new THREE.Quaternion(),
                targetAnim: 'idle',
                messageIconSprite: null
            });
        }).catch(err => console.warn('Failed to load character model for remote player', id, err));
    }

    // Swaps the local player's model for a different character (used on first load and when the
    // person changes their selection in the profile modal). Returns once the new model is ready.
    async function switchLocalCharacter(key) {
        const safeKey = sanitizeCharacterKey(key);
        const { model, mixer, actions } = await loadCharacterModel(safeKey);
        if (localModel) scene.remove(localModel);
        localModel = model;
        localMixer = mixer;
        Object.keys(localActions).forEach(k => { localActions[k] = actions[k]; });
        localModel.traverse(c => { if (c.isMesh) { c.castShadow = true; c.userData.isPlayer = true; } });
        const label = createTextLabel(myNickname, '#007bff');
        label.name = 'label';
        localModel.add(label);
        scene.add(localModel);
        myCharacterKey = safeKey;
    }

    function removeRemotePlayer(id) {
        const p = players.get(id);
        if (p) {
            if (p.messageIconSprite) p.model?.remove(p.messageIconSprite);
            scene.remove(p.model);
            players.delete(id);
            unreadCounts.delete(id);
        }
    }

    function createTextLabel(text, color = '#333') {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const draw = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.font = `900 44px ${NICK_FONT_FAMILY}`;
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 6;
            ctx.strokeText(text, 256, 64);
            ctx.fillText(text, 256, 64);
        };
        draw();
        const tex = new THREE.CanvasTexture(canvas);
        // Canvas text doesn't wait for @font-face the way CSS does — if this ran before the HUD
        // font finished loading, redraw once it's actually ready instead of staying on fallback.
        if (!document.fonts.check(`900 44px "Big Shoulders Display"`)) {
            nickFontReady.then(() => { draw(); tex.needsUpdate = true; });
        }
        const mat = new THREE.SpriteMaterial({ map: tex });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(2.5, 0.6, 1);
        sprite.position.y = 2.4;
        return sprite;
    }

    function updateMessageIcon(playerId) {
        const p = players.get(playerId);
        if (!p || !p.model || p.loading) return;
        const model = p.model;
        const count = unreadCounts.get(playerId) || 0;
        const oldIcon = model.getObjectByName('message-icon');
        if (oldIcon) { model.remove(oldIcon); p.messageIconSprite = null; }
        if (count <= 0) return;

        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.font = '48px "Font Awesome 6 Free"';
        ctx.fillStyle = '#007bff';
        ctx.textAlign = 'center';
        ctx.fillText('\uf4ad', 64, 72);
        ctx.beginPath();
        ctx.arc(96, 36, 18, 0, Math.PI * 2);
        ctx.fillStyle = '#ff3b30';
        ctx.fill();
        ctx.font = 'bold 20px "Segoe UI", sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(count.toString(), 96, 42);

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex });
        const sprite = new THREE.Sprite(mat);
        sprite.name = 'message-icon';
        sprite.scale.set(1.2, 1.2, 1);
        sprite.position.y = 3.2;
        model.add(sprite);
        p.messageIconSprite = sprite;
    }

    // ---- nickname / chat UI ----
    let selectedCharacterKey = myCharacterKey;
    graphCanvas.parentElement.addEventListener('click', () => openNickModal());
    window.openNickModal = () => {
        document.getElementById('nick-input').value = myNickname;
        selectedCharacterKey = myCharacterKey;
        document.querySelectorAll('.character-option').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.key === selectedCharacterKey);
        });
        document.getElementById('nickname-modal').style.display = 'block';
    };
    document.querySelectorAll('.character-option').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedCharacterKey = sanitizeCharacterKey(btn.dataset.key);
            document.querySelectorAll('.character-option').forEach(b => b.classList.toggle('selected', b === btn));
        });
    });
    // Strip anything outside printable ASCII as the player types, so Cyrillic (or any other
    // non-English script) never even makes it into the field, rather than being caught later.
    document.getElementById('nick-input').addEventListener('input', (e) => {
        const cleaned = e.target.value.replace(/[^\x20-\x7E]/g, '');
        if (cleaned !== e.target.value) e.target.value = cleaned;
    });
    window.saveNickname = () => {
        const val = sanitizeNick(document.getElementById('nick-input').value.trim(), myId);
        if (val && val !== myNickname) {
            myNickname = val;
            const oldLabel = localModel?.getObjectByName('label');
            if (oldLabel) localModel.remove(oldLabel);
            if (localModel) {
                const newLabel = createTextLabel(myNickname, '#007bff');
                newLabel.name = 'label';
                localModel.add(newLabel);
            }
            safeSend({ type: 'nickname-change', nick: myNickname });
            drawGraph();
        }
        if (selectedCharacterKey !== myCharacterKey) {
            switchLocalCharacter(selectedCharacterKey).then(() => {
                safeSend({ type: 'character-change', character: myCharacterKey });
            }).catch(err => console.warn('Failed to switch character', err));
        }
        document.getElementById('nickname-modal').style.display = 'none';
    };

    window.startChat = () => { if (currentTargetId) openChat(currentTargetId, currentTargetNick); hideMenu(); };
    window.sendFile = () => { alert("File transfer is not supported in this version yet."); hideMenu(); };
    function hideMenu() { document.getElementById('interaction-menu').style.display = 'none'; }

    function openChat(targetId, nick) {
        currentTargetId = targetId;
        currentTargetNick = nick;
        document.getElementById('chat-partner').innerText = `💬 ${nick}`;
        document.getElementById('chat-messages').innerHTML = '';
        document.getElementById('chat-modal').style.display = 'flex';
        unreadCounts.set(targetId, 0);
        updateMessageIcon(targetId);
        safeSend({ type: 'request-chat-history', partnerId: targetId });
        document.getElementById('chat-input').focus();
    }

    function renderHistoryMessages(messages) {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        container.innerHTML = '';
        messages.forEach(msg => addChatMessage(msg.from, msg.text, msg.timestamp));
        container.scrollTop = container.scrollHeight;
    }

    window.closeChat = () => {
        document.getElementById('chat-modal').style.display = 'none';
        currentTargetId = null;
        currentTargetNick = '';
    };

    window.sendChatMessage = () => {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (!text || !currentTargetId) return;
        safeSend({ type: 'chat', to: currentTargetId, text, timestamp: Date.now() });
        input.value = '';
    };

    function receiveChat(from, to, text, timestamp) {
        if (to === myId && from !== myId && (!currentTargetId || currentTargetId !== from)) {
            const current = unreadCounts.get(from) || 0;
            unreadCounts.set(from, current + 1);
            updateMessageIcon(from);
        }
        if (currentTargetId && (from === currentTargetId || to === currentTargetId)) addChatMessage(from, text, timestamp);
        if (from !== myId && to === myId && (!currentTargetId || currentTargetId !== from)) {
            const sender = players.get(from)?.nick || 'Player';
            showNotification(sender, text);
        }
    }

    function addChatMessage(fromId, text, timestamp) {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-msg ' + (fromId === myId ? 'mine' : 'other');
        const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        msgDiv.innerHTML = `${text}<span class="chat-time">${time}</span>`;
        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
    }

    function showNotification(sender, text, persistent = false) {
        const container = document.getElementById('notification-container');
        const div = document.createElement('div');
        div.className = 'notification' + (persistent ? ' persistent' : '');
        div.innerText = `${sender}: ${text}`;
        container.appendChild(div);
        if (!persistent) setTimeout(() => div.remove(), 3000);
    }

    document.addEventListener('mousedown', e => { if (!e.target.closest('#interaction-menu')) hideMenu(); });

    /* =========================================================================================
     * QFOLDIT SCIENTIFIC LAYER
     * Same canonical shape as qfoldit.scientific-state/v1 and the same tool contract used by
     * WEB-TOOLBELT / UEFN-TOOLBELT / Unity-Toolbelt / UNIGINE-Toolbelt, exposed as WebMCP tools.
     * The browser stays authoritative for presentation only; heavier solvers stay server-side.
     * ========================================================================================= */
    const sciObjects = new Map(); // id -> { mesh, velocity, kind, properties }
    let sciState = null;          // last loaded qfoldit.scientific-state/v1 payload
    const telemetry = { steps: 0, simTime: 0 };

    const KIND_GEOMETRY = {
        atom: () => new THREE.SphereGeometry(0.28, 20, 20),
        molecule: () => new THREE.IcosahedronGeometry(0.35, 0),
        marker: () => new THREE.ConeGeometry(0.25, 0.5, 12),
        box: () => new THREE.BoxGeometry(0.5, 0.5, 0.5),
        default: () => new THREE.SphereGeometry(0.3, 16, 16)
    };

    function colorForKind(kind, properties) {
        if (properties && properties.color) return properties.color;
        const palette = { atom: 0x16e0bd, molecule: 0xffb020, marker: 0xff5d73, box: 0x8c7bff, default: 0x9db3d0 };
        return palette[kind] || palette.default;
    }

    function spawnSciObject({ id, kind, position, properties }) {
        removeSciObject(id); // idempotent re-spawn
        const geomFn = KIND_GEOMETRY[kind] || KIND_GEOMETRY.default;
        const material = new THREE.MeshStandardMaterial({ color: colorForKind(kind, properties), roughness: 0.35, metalness: 0.15 });
        const mesh = new THREE.Mesh(geomFn(), material);
        mesh.castShadow = true;
        mesh.position.set(position?.x ?? 0, position?.y ?? 1, position?.z ?? 0);
        mesh.userData.sciId = id;
        scene.add(mesh);
        sciObjects.set(id, { mesh, velocity: new THREE.Vector3(), kind, properties: properties || {} });
    }

    function removeSciObject(id) {
        const obj = sciObjects.get(id);
        if (obj) { scene.remove(obj.mesh); sciObjects.delete(id); }
    }

    /* Backbone trace: connects sequential Cα atoms from a loaded PDB structure with a line, so
     * a chain of atoms reads as an actual folded protein backbone instead of a cloud of dots.
     * Drawn separately from spawnSciObject/sciObjects since only PDB-derived structures use it. */
    let sciBackboneLine = null;
    let sciBackboneIds = [];
    function clearSciBackbone() {
        if (sciBackboneLine) {
            scene.remove(sciBackboneLine);
            sciBackboneLine.geometry.dispose();
            sciBackboneLine.material.dispose();
            sciBackboneLine = null;
        }
        sciBackboneIds = [];
    }
    function drawSciBackbone(orderedIds) {
        clearSciBackbone();
        if (orderedIds.length < 2) return;
        sciBackboneIds = orderedIds;
        const geometry = new THREE.BufferGeometry().setFromPoints(orderedIds.map(() => new THREE.Vector3()));
        geometry.setDrawRange(0, 0); // animated open in the render loop, see animate()
        const material = new THREE.LineBasicMaterial({ color: 0x16e0bd, transparent: true, opacity: 0.85 });
        sciBackboneLine = new THREE.Line(geometry, material);
        sciBackboneLine.userData.revealStart = performance.now();
        scene.add(sciBackboneLine);
    }

    function clearAllSciObjects() {
        sciObjects.forEach(obj => scene.remove(obj.mesh));
        sciObjects.clear();
        clearSciBackbone();
        telemetry.steps = 0;
        telemetry.simTime = 0;
    }

    function stepSciPhysics(steps) {
        const dt = 1 / 60;
        for (let s = 0; s < steps; s++) {
            sciObjects.forEach(obj => {
                obj.velocity.y -= 1.6 * dt; // light illustrative gravity, not an authoritative solver
                obj.mesh.position.addScaledVector(obj.velocity, dt);
                if (obj.mesh.position.y < 0.3) { obj.mesh.position.y = 0.3; obj.velocity.y *= -0.35; }
                obj.mesh.rotation.y += dt * 0.6;
            });
            telemetry.steps += 1;
            telemetry.simTime += dt;
        }
    }

    /* ---- Tool registry (protocol-neutral capability layer) ---- */
    class ToolRegistry {
        constructor() { this.handlers = new Map(); }
        register(name, handler) { this.handlers.set(name, handler); }
        list() { return [...this.handlers.keys()]; }
        async call({ name, arguments: args }) {
            const handler = this.handlers.get(name);
            if (!handler) return { ok: false, error: { code: 'TOOL_NOT_FOUND', message: `Tool '${name}' is not registered.` } };
            try { return await handler(args || {}); }
            catch (err) { return { ok: false, error: { code: 'TOOL_EXECUTION_ERROR', message: err instanceof Error ? err.message : String(err) } }; }
        }
    }
    const toolRegistry = new ToolRegistry();

    function registerSciTools() {
        toolRegistry.register('init_scene', async () => { clearAllSciObjects(); return { ok: true, data: { initialized: true } }; });

        toolRegistry.register('spawn_object', async (args) => {
            if (!args.id || !args.position) return { ok: false, error: { code: 'INVALID_ARGS', message: 'id and position are required.' } };
            spawnSciObject({ id: String(args.id), kind: String(args.kind || 'default'), position: args.position, properties: args.properties });
            refreshLabPanel();
            return { ok: true };
        });

        toolRegistry.register('remove_object', async (args) => {
            removeSciObject(String(args.id));
            refreshLabPanel();
            return { ok: true };
        });

        toolRegistry.register('apply_impulse', async (args) => {
            const obj = sciObjects.get(String(args.object_id));
            if (!obj) return { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown object_id.' } };
            const v = args.force_vector || {};
            obj.velocity.add(new THREE.Vector3(v.x || 0, v.y || 0, v.z || 0));
            return { ok: true, data: { note: 'Local interaction preview only; authoritative physics remains server-side.' } };
        });

        toolRegistry.register('run_simulation_steps', async (args) => {
            const steps = Math.max(1, Number(args.steps) || 1);
            stepSciPhysics(steps);
            refreshLabPanel();
            return { ok: true, data: { steps: telemetry.steps } };
        });

        toolRegistry.register('get_telemetry', async () => ({
            ok: true, data: { steps: telemetry.steps, simTime: telemetry.simTime, objectCount: sciObjects.size }
        }));

        toolRegistry.register('load_scientific_data', async (args) => {
            const state = args.state;
            if (!state || state.schema !== 'qfoldit.scientific-state/v1') {
                return { ok: false, error: { code: 'SCHEMA_MISMATCH', message: 'Unsupported scientific-state schema.' } };
            }
            clearAllSciObjects();
            sciState = state;
            (state.objects || []).forEach(o => spawnSciObject(o));
            refreshLabPanel();
            return { ok: true, data: { stateId: state.stateId } };
        });

        toolRegistry.register('get_scientific_state', async () => ({ ok: true, data: sciState }));

        toolRegistry.register('clear_scientific_state', async () => {
            clearAllSciObjects();
            sciState = null;
            refreshLabPanel();
            return { ok: true };
        });

        toolRegistry.register('capture_viewport', async () => ({
            ok: true, data: { mimeType: 'image/png', dataUrl: renderer.domElement.toDataURL('image/png') }
        }));

        // Guided-protocol feedback. STUB: not computed from a real physics/scoring engine — there
        // isn't one connected here. Returns a plausible-shaped energy/RMSD readout that improves
        // as protocol steps are completed, so the UI and tool contract are real and wired end to
        // end; only the number-crunching behind them is a placeholder pending a connected solver.
        toolRegistry.register('get_protocol_feedback', async () => {
            if (!protocolState) return { ok: false, error: { code: 'NO_ACTIVE_PROTOCOL', message: 'No guided protocol is running.' } };
            return {
                ok: true,
                data: {
                    step: protocolState.stepIndex,
                    totalSteps: protocolState.targetIds.length,
                    energy: Number(protocolState.energy.toFixed(2)),
                    rmsd: Number(protocolState.rmsd.toFixed(3)),
                    stub: true,
                    note: 'Placeholder values, not a real energy/RMSD computation — pending a connected MCP solver.'
                }
            };
        });
    }

    /* ---- WebMCP transport boundary: window.postMessage bridge ---- */
    class WebMCPBridge {
        constructor(registry) { this.registry = registry; this.listener = null; }
        start() {
            this.listener = async (event) => {
                const message = event.data;
                if (!message || typeof message !== 'object') return;
                if (message.type === 'qfoldit.tools/list') {
                    window.postMessage({ type: 'qfoldit.tools/list/result', tools: this.registry.list() }, window.location.origin);
                    return;
                }
                if (message.type === 'qfoldit.tools/call') {
                    const result = await this.registry.call(message.call);
                    window.postMessage({ type: 'qfoldit.tools/call/result', requestId: message.requestId, result }, window.location.origin);
                }
            };
            window.addEventListener('message', this.listener);
        }
    }
    const webMcpBridge = new WebMCPBridge(toolRegistry);

    // Direct in-page access for consoles / external orchestrators embedding this page.
    window.qfoldit = {
        tools: () => toolRegistry.list(),
        call: (name, args) => toolRegistry.call({ name, arguments: args })
    };

    async function callTool(name, args, { broadcast = false, log = true } = {}) {
        const result = await toolRegistry.call({ name, arguments: args });
        if (log) logToolCall(name, result);
        if (broadcast && result.ok) {
            if (name === 'clear_scientific_state') safeSend({ type: 'science-clear', originId: myId, originNick: myNickname });
            else safeSend({ type: 'science-state', originId: myId, originNick: myNickname, state: sciState });
        }
        return result;
    }

    // ---- remote session sync handlers (applied without re-broadcasting) ----
    function applyRemoteScientificState(state, originNick) {
        if (!state || state.schema !== 'qfoldit.scientific-state/v1') return;
        clearAllSciObjects();
        sciState = state;
        (state.objects || []).forEach(o => spawnSciObject(o));
        if (state.domain === 'protein-structure') animateStructureAssembly(state.objects || []);
        refreshLabPanel();
        showNotification('Science Lab', `${originNick || 'A player'} shared "${state.metadata?.title || state.stateId}" with the session.`);
    }
    function applyRemoteScientificClear(originNick) {
        clearAllSciObjects();
        sciState = null;
        refreshLabPanel();
        showNotification('Science Lab', `${originNick || 'A player'} cleared the shared scientific state.`);
    }

    /* ---- Live science data: real structures from the RCSB Protein Data Bank ----
     * CAMEO (cameo3d.org) itself has no public API — its site is a JS single-page app with no
     * documented programmatic access, so there's no honest way to pull its live weekly
     * leaderboard into the browser without either unauthorized scraping or fabricating numbers.
     * What IS public, documented, and explicitly designed for external web use is the RCSB PDB
     * API (data.rcsb.org / files.rcsb.org) — the same reference archive CAMEO evaluates blind
     * predictions against. This fetches a real, released structure and traces its Cα (alpha
     * carbon) backbone into the same qfoldit.scientific-state/v1 pipeline the demo experiment
     * uses, so it renders, syncs, and persists exactly like any other Science Lab experiment.
     */
    async function fetchPdbStructure(rawId) {
        const id = (rawId || '').trim().toUpperCase();
        if (!/^[0-9][A-Z0-9]{3}$/.test(id)) {
            throw new Error('Enter a valid 4-character PDB ID (e.g. 6VXX).');
        }

        const [metaRes, pdbRes] = await Promise.all([
            fetch(`https://data.rcsb.org/rest/v1/core/entry/${id}`).catch(() => null),
            fetch(`https://files.rcsb.org/download/${id}.pdb`)
        ]);
        if (!pdbRes.ok) throw new Error(`PDB entry "${id}" was not found.`);
        const pdbText = await pdbRes.text();

        let title = id;
        if (metaRes && metaRes.ok) {
            try {
                const meta = await metaRes.json();
                if (meta?.struct?.title) title = meta.struct.title;
            } catch (e) { /* metadata is a nice-to-have; keep the ID as the title if it fails */ }
        }

        // Fixed-column PDB format: atom name at columns 13-16, x/y/z at 31-38/39-46/47-54.
        // Cα atoms give a real, if coarse, trace of the fold without needing a full mmCIF parser.
        const caPositions = [];
        pdbText.split('\n').forEach(line => {
            if (!(line.startsWith('ATOM') || line.startsWith('HETATM'))) return;
            if (line.substring(12, 16).trim() !== 'CA') return;
            const x = parseFloat(line.substring(30, 38));
            const y = parseFloat(line.substring(38, 46));
            const z = parseFloat(line.substring(46, 54));
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) caPositions.push({ x, y, z });
        });
        if (caPositions.length === 0) {
            throw new Error(`No alpha-carbon (protein backbone) atoms found in "${id}" — it may not be a protein entry.`);
        }

        const center = caPositions.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }), { x: 0, y: 0, z: 0 });
        center.x /= caPositions.length; center.y /= caPositions.length; center.z /= caPositions.length;

        // Cap the object count for scene performance; large complexes can have thousands of
        // residues, and we're rendering each as its own multiplayer-synced 3D mesh.
        const MAX_ATOMS = 300;
        let sampled = caPositions;
        if (caPositions.length > MAX_ATOMS) {
            const step = caPositions.length / MAX_ATOMS;
            sampled = Array.from({ length: MAX_ATOMS }, (_, i) => caPositions[Math.floor(i * step)]);
        }

        const SCALE = 0.12; // angstroms -> scene units, roughly matching the demo experiment's spread
        const objects = sampled.map((p, i) => ({
            id: `pdb-${id}-${i}`,
            kind: 'atom',
            position: {
                x: (p.x - center.x) * SCALE + 3,
                y: (p.y - center.y) * SCALE + 2.5,
                z: (p.z - center.z) * SCALE - 3
            },
            properties: { label: `${title} · Cα ${i + 1}/${sampled.length}` }
        }));

        return {
            schema: 'qfoldit.scientific-state/v1',
            stateId: `pdb-${id}-${Date.now()}`,
            timestamp: Date.now(),
            domain: 'protein-structure',
            objects,
            trajectories: [],
            observations: [],
            metrics: { residue_count_shown: sampled.length, residue_count_total: caPositions.length },
            metadata: {
                title: `${title} (PDB ${id})`,
                source: 'RCSB Protein Data Bank — files.rcsb.org / data.rcsb.org (public API)',
                note: 'Cα backbone trace of a real, released structure. Not a live CAMEO leaderboard feed.'
            }
        };
    }

    /* ---- demo dataset ---- */
    function buildDemoState() {
        const objects = [];
        const count = 8;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            objects.push({
                id: `atom-${i}`,
                kind: i % 3 === 0 ? 'molecule' : 'atom',
                position: { x: Math.cos(angle) * 2 + 3, y: 1.4 + Math.sin(i) * 0.4, z: Math.sin(angle) * 2 - 3 },
                properties: { label: `Residue ${i + 1}` }
            });
        }
        return {
            schema: 'qfoldit.scientific-state/v1',
            stateId: 'demo-amino-chain-' + Date.now(),
            timestamp: Date.now(),
            domain: 'protein-folding',
            objects,
            trajectories: [],
            observations: [],
            metrics: { stability_score: 0.72 },
            metadata: { title: 'Demo: Amino Acid Chain Sandbox', source: 'qFoldIT Science Lab demo generator' }
        };
    }

    /* ---- Lab panel UI ---- */
    window.toggleLab = () => {
        const panel = document.getElementById('lab-panel');
        panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
        if (panel.style.display === 'flex') refreshLabPanel();
    };

    window.labLoadDemo = async () => { await callTool('load_scientific_data', { state: buildDemoState() }, { broadcast: true }); };
    // Staggers the just-spawned atoms into a scale-in "assembly" reveal, and grows the backbone
    // line alongside them, so a loaded structure visibly comes together instead of popping in
    // all at once. Purely a local presentation effect — every client renders it independently
    // over the same final (real) coordinates, so nothing needs to be sent over the network for it.
    function animateStructureAssembly(objectsWithIds) {
        const startTime = performance.now();
        const total = objectsWithIds.length;
        objectsWithIds.forEach(({ id }, i) => {
            const obj = sciObjects.get(id);
            if (!obj) return;
            obj.mesh.scale.setScalar(0.001);
            obj.mesh.userData.revealStart = startTime;
            obj.mesh.userData.revealDelay = (i / Math.max(total, 1)) * 1400; // ms, spread across ~1.4s
            obj.mesh.userData.revealTargetScale = 1;
        });
        drawSciBackbone(objectsWithIds.map(o => o.id));
    }

    window.labApplyPdbPreset = () => {
        const select = document.getElementById('pdb-preset-select');
        const input = document.getElementById('pdb-id-input');
        if (!select.value || select.value === 'custom') { input.focus(); input.select(); return; }
        input.value = select.value;
    };

    window.labLoadPdb = async () => {
        const input = document.getElementById('pdb-id-input');
        const rawId = input.value;
        try {
            showNotification('Science Lab', `Fetching ${rawId.trim().toUpperCase() || 'structure'} from the Protein Data Bank…`);
            const state = await fetchPdbStructure(rawId);
            const result = await callTool('load_scientific_data', { state }, { broadcast: true });
            if (result.ok) animateStructureAssembly(state.objects);
        } catch (err) {
            showNotification('Science Lab', err.message || 'Failed to load structure from the PDB.');
        }
    };
    window.labRunSteps = async () => { await callTool('run_simulation_steps', { steps: 20 }); };
    window.labClear = async () => { await callTool('clear_scientific_state', {}, { broadcast: true }); };
    window.labSyncSession = () => {
        if (!sciState) { showNotification('Science Lab', 'Load an experiment before syncing it to the session.'); return; }
        safeSend({ type: 'science-state', originId: myId, originNick: myNickname, state: sciState });
        showNotification('Science Lab', 'Current scientific state was broadcast to everyone in this session.');
    };
    window.labRemoveObject = async (id) => { await callTool('remove_object', { id }, { broadcast: true }); };

    window.labCapture = async () => {
        const result = await callTool('capture_viewport', {});
        if (result.ok) {
            document.getElementById('viewport-preview-img').src = result.data.dataUrl;
            document.getElementById('viewport-download').href = result.data.dataUrl;
            document.getElementById('viewport-preview').style.display = 'block';
        }
    };

    window.openAbout = () => { document.getElementById('about-modal').style.display = 'block'; };
    window.closeAbout = () => { document.getElementById('about-modal').style.display = 'none'; };

    /* =========================================================================================
     * EXPERIMENT VERSION CONTROL
     * A lightweight, "Lore"-inspired (Epic's content-addressed, revision-chain VCS that powers
     * UEFN — github.com/epicgames/lore) history system for a player's scientific-state
     * experiments. This is NOT the actual Lore backend or a live GitHub integration — there's no
     * server component here to host a real content-addressed store, and writing to GitHub from
     * client-side JS would mean embedding a personal access token in a public page, which this
     * deliberately does not do. What it does implement, independently, in the same spirit:
     *   - content-addressed revisions: each commit's ID is a SHA-256 hash of its content
     *   - an immutable revision chain: every revision points at its parent, like a git commit
     *   - named branches: a branch is just a pointer to a revision hash
     *   - a full JSON export/import of the whole repo (revisions + branches + HEAD), so a
     *     player's experiment history is entirely portable as one file — including moving it
     *     into an actual git repository by hand, since the export is just plain JSON.
     * Persisted locally (localStorage) so it survives a page reload; JSON export/import is the
     * supported way to move it between browsers, players, or into real version control.
     * ========================================================================================= */
    const SCI_REPO_STORAGE_KEY = 'qfoldit.sci-repo.v1';
    let sciRepo = { revisions: {}, branches: { main: null }, head: { branch: 'main' } };

    async function sha256Hex(text) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function loadSciRepoFromStorage() {
        try {
            const raw = localStorage.getItem(SCI_REPO_STORAGE_KEY);
            if (raw) sciRepo = JSON.parse(raw);
        } catch (e) { console.warn('Could not load local experiment history', e); }
    }
    function saveSciRepoToStorage() {
        try { localStorage.setItem(SCI_REPO_STORAGE_KEY, JSON.stringify(sciRepo)); }
        catch (e) { console.warn('Could not save local experiment history', e); }
    }
    loadSciRepoFromStorage();

    function currentBranchHead() {
        const branch = sciRepo.head.branch;
        return branch ? sciRepo.branches[branch] : sciRepo.head.revisionId;
    }

    async function commitExperiment(message) {
        if (!sciState) throw new Error('Load an experiment before committing it.');
        const parentId = currentBranchHead();
        const content = JSON.stringify({ parentId, state: sciState, message: message || '', author: myNickname });
        const id = (await sha256Hex(content)).slice(0, 12);
        sciRepo.revisions[id] = { id, parentId, message: message || '(no message)', author: myNickname, timestamp: Date.now(), state: sciState };
        if (sciRepo.head.branch) sciRepo.branches[sciRepo.head.branch] = id;
        else sciRepo.head.revisionId = id;
        saveSciRepoToStorage();
        return id;
    }

    function listRevisionHistory(fromId) {
        const history = [];
        let cursor = fromId;
        const seen = new Set();
        while (cursor && sciRepo.revisions[cursor] && !seen.has(cursor)) {
            seen.add(cursor);
            history.push(sciRepo.revisions[cursor]);
            cursor = sciRepo.revisions[cursor].parentId;
        }
        return history;
    }

    async function checkoutRevision(id) {
        const rev = sciRepo.revisions[id];
        if (!rev) throw new Error(`Unknown revision "${id}".`);
        await callTool('load_scientific_data', { state: rev.state }, { broadcast: true, log: false });
        if (rev.state.domain === 'protein-structure') animateStructureAssembly(rev.state.objects || []);
        sciRepo.head = { branch: sciRepo.head.branch, revisionId: id };
        if (sciRepo.head.branch) sciRepo.branches[sciRepo.head.branch] = id;
        saveSciRepoToStorage();
    }

    window.vcCommit = async () => {
        const msgInput = document.getElementById('vc-commit-message');
        try {
            const id = await commitExperiment(msgInput.value.trim());
            msgInput.value = '';
            showNotification('Version Control', `Committed revision ${id} to "${sciRepo.head.branch}".`);
            refreshVersionControlPanel();
        } catch (err) {
            showNotification('Version Control', err.message || 'Commit failed.');
        }
    };

    window.vcCreateBranch = () => {
        const nameInput = document.getElementById('vc-branch-name');
        const name = sanitizeNick(nameInput.value.trim(), '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 24);
        if (!name) { showNotification('Version Control', 'Enter a branch name first.'); return; }
        if (sciRepo.branches[name]) { showNotification('Version Control', `Branch "${name}" already exists.`); return; }
        sciRepo.branches[name] = currentBranchHead();
        sciRepo.head = { branch: name };
        nameInput.value = '';
        saveSciRepoToStorage();
        showNotification('Version Control', `Created and switched to branch "${name}".`);
        refreshVersionControlPanel();
    };

    window.vcSwitchBranch = (name) => {
        if (!sciRepo.branches.hasOwnProperty(name)) return;
        sciRepo.head = { branch: name };
        const head = sciRepo.branches[name];
        saveSciRepoToStorage();
        if (head) checkoutRevision(head).catch(err => showNotification('Version Control', err.message));
        refreshVersionControlPanel();
    };

    window.vcCheckout = async (id) => {
        try {
            await checkoutRevision(id);
            showNotification('Version Control', `Checked out revision ${id}.`);
            refreshVersionControlPanel();
        } catch (err) {
            showNotification('Version Control', err.message || 'Checkout failed.');
        }
    };

    window.vcExport = () => {
        const blob = new Blob([JSON.stringify(sciRepo, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `qfoldit-experiment-history-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    window.vcImport = (fileInput) => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const imported = JSON.parse(reader.result);
                if (!imported.revisions || !imported.branches) throw new Error('Not a qFoldIT experiment history file.');
                // Merge rather than overwrite, so importing someone else's history doesn't
                // silently discard local commits — revisions are content-addressed, so
                // colliding IDs are, by construction, identical content.
                Object.assign(sciRepo.revisions, imported.revisions);
                Object.assign(sciRepo.branches, imported.branches);
                saveSciRepoToStorage();
                showNotification('Version Control', `Imported ${Object.keys(imported.revisions).length} revision(s) and ${Object.keys(imported.branches).length} branch(es).`);
                refreshVersionControlPanel();
            } catch (err) {
                showNotification('Version Control', err.message || 'Could not import that file.');
            }
        };
        reader.readAsText(file);
        fileInput.value = '';
    };

    function refreshVersionControlPanel() {
        const branchSelect = document.getElementById('vc-branch-select');
        if (branchSelect) {
            branchSelect.innerHTML = '';
            Object.keys(sciRepo.branches).forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name === sciRepo.head.branch ? `${name} (current)` : name;
                if (name === sciRepo.head.branch) opt.selected = true;
                branchSelect.appendChild(opt);
            });
        }
        const list = document.getElementById('vc-history-list');
        if (!list) return;
        list.innerHTML = '';
        const history = listRevisionHistory(currentBranchHead());
        if (history.length === 0) {
            list.innerHTML = '<div id="vc-empty">No commits yet on this branch.</div>';
            return;
        }
        history.forEach(rev => {
            const isHead = rev.id === (sciRepo.head.revisionId || sciRepo.branches[sciRepo.head.branch]);
            const item = document.createElement('div');
            item.className = 'vc-revision' + (isHead ? ' current' : '');
            const time = new Date(rev.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            item.innerHTML = `<span class="vc-hash">${rev.id}</span><span class="vc-msg">${rev.message}</span><span class="vc-meta">${rev.author} · ${time}</span>`;
            item.onclick = () => window.vcCheckout(rev.id);
            list.appendChild(item);
        });
    }

    /* =========================================================================================
     * GUIDED PROTOCOL
     * A step-by-step exercise — load a structure, then click its residues in sequence, with a
     * running energy/RMSD readout — in the spirit of the guided, pedagogical simulation format
     * used by qFoldIT member Neil Voss's Virtual-Lab-Simulation
     * (github.com/qfoldit/Virtual-Lab-Simulation). This is an independent implementation built
     * for this project's own WebMCP tool contract, not a port of that project's source (which
     * wasn't available to build from here) — and see get_protocol_feedback above for why the
     * energy/RMSD numbers are explicitly a stub rather than a real computation.
     * ========================================================================================= */
    let protocolState = null; // { targetIds, stepIndex, energy, rmsd }

    function highlightProtocolTarget() {
        sciObjects.forEach(o => {
            if (o.mesh.userData.isProtocolTarget) {
                o.mesh.material.emissive?.setHex(0x000000);
                o.mesh.userData.isProtocolTarget = false;
            }
        });
        if (!protocolState || protocolState.stepIndex >= protocolState.targetIds.length) return;
        const obj = sciObjects.get(protocolState.targetIds[protocolState.stepIndex]);
        if (obj) {
            obj.mesh.userData.isProtocolTarget = true;
            obj.mesh.material.emissive?.setHex(0xffcc00);
        }
    }

    window.startGuidedProtocol = () => {
        if (!sciBackboneIds || sciBackboneIds.length < 3) {
            showNotification('Guided Protocol', 'Load a structure first (Live science data panel above) — the protocol walks its backbone.');
            return;
        }
        const stride = Math.max(1, Math.floor(sciBackboneIds.length / 8));
        const targetIds = sciBackboneIds.filter((_, i) => i % stride === 0).slice(0, 8);
        protocolState = { targetIds, stepIndex: 0, energy: 100, rmsd: 12.0 };
        highlightProtocolTarget();
        refreshProtocolPanel();
        showNotification('Guided Protocol', `Protocol started — ${targetIds.length} steps. Click the highlighted (yellow-glowing) residue.`);
    };

    function handleProtocolObjectClick(id) {
        if (!protocolState || protocolState.stepIndex >= protocolState.targetIds.length) return;
        if (id !== protocolState.targetIds[protocolState.stepIndex]) return; // not the expected residue — no progress
        protocolState.stepIndex++;
        // Stub feedback — see get_protocol_feedback's tool registration for why.
        const n = protocolState.targetIds.length;
        protocolState.energy = Math.max(5, protocolState.energy - 95 / n + (Math.random() * 4 - 2));
        protocolState.rmsd = Math.max(0.4, protocolState.rmsd - 11.5 / n + (Math.random() * 0.3 - 0.15));
        if (protocolState.stepIndex >= n) {
            showNotification('Guided Protocol', `Protocol complete — final energy ${protocolState.energy.toFixed(1)}, RMSD ${protocolState.rmsd.toFixed(2)} Å (stub values).`);
        } else {
            showNotification('Guided Protocol', `Step ${protocolState.stepIndex}/${n} — energy ${protocolState.energy.toFixed(1)}, RMSD ${protocolState.rmsd.toFixed(2)} Å (stub).`);
        }
        highlightProtocolTarget();
        refreshProtocolPanel();
    }

    function refreshProtocolPanel() {
        const stepEl = document.getElementById('protocol-step');
        const energyEl = document.getElementById('protocol-energy');
        const rmsdEl = document.getElementById('protocol-rmsd');
        if (!stepEl) return;
        if (!protocolState) { stepEl.textContent = '–'; energyEl.textContent = '–'; rmsdEl.textContent = '–'; return; }
        stepEl.textContent = `${protocolState.stepIndex}/${protocolState.targetIds.length}`;
        energyEl.textContent = protocolState.energy.toFixed(1);
        rmsdEl.textContent = protocolState.rmsd.toFixed(2);
    }

    function logToolCall(name, result) {
        const log = document.getElementById('lab-log');
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const line = document.createElement('div');
        line.innerHTML = `[${time}] <span class="call-name">${name}</span> → ${result.ok ? 'ok' : 'error: ' + (result.error?.message || 'unknown')}`;
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
    }

    function updateLabPlayerCount() {
        const el = document.getElementById('lab-metric-players');
        if (el) el.innerText = String(players.size + 1);
    }

    function refreshLabPanel() {
        document.getElementById('lab-metric-objects').innerText = String(sciObjects.size);
        document.getElementById('lab-metric-steps').innerText = String(telemetry.steps);
        document.getElementById('lab-metric-time').innerText = telemetry.simTime.toFixed(1) + 's';
        updateLabPlayerCount();
        refreshVersionControlPanel();
        refreshProtocolPanel();

        const list = document.getElementById('lab-object-list');
        const empty = document.getElementById('lab-empty');
        list.innerHTML = '';
        if (sciObjects.size === 0) { empty.style.display = 'block'; return; }
        empty.style.display = 'none';
        sciObjects.forEach((obj, id) => {
            const li = document.createElement('li');
            const label = obj.properties?.label || id;
            li.innerHTML = `<span>🔹 ${label} <em style="color:#7f92ad">(${obj.kind})</em></span><span class="rm" title="Remove">✖</span>`;
            li.querySelector('.rm').onclick = () => window.labRemoveObject(id);
            list.appendChild(li);
        });
    }

    /* =========================================================================================
     * BOOTSTRAP
     * ========================================================================================= */
    init();
    function init() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xe0e0e0);
        scene.fog = new THREE.Fog(0xe0e0e0, 15, 60);
        camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.set(0, 3, 10);
        renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        document.body.appendChild(renderer.domElement);

        clock = new THREE.Clock();
        raycaster = new THREE.Raycaster();
        mouse = new THREE.Vector2();

        scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(5, 12, 8);
        dirLight.castShadow = true;
        scene.add(dirLight);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshPhongMaterial({ color: 0xcccccc, depthWrite: false }));
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);
        scene.add(new THREE.GridHelper(100, 50, 0xbbbbbb, 0xdddddd));

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.maxDistance = 20;
        controls.target.set(0, 1, 0);

        registerSciTools();
        webMcpBridge.start();
        const dot = document.getElementById('lab-dot');
        if (dot) dot.classList.add('online');

        switchLocalCharacter(myCharacterKey).then(() => {
            document.getElementById('loading-overlay').style.display = 'none';
            animate();
        }).catch(err => {
            console.error('Failed to load the local character model', err);
            document.getElementById('loading-overlay').innerHTML = '<p>Failed to load character model. Please refresh.</p>';
        });

        window.addEventListener('keydown', e => { if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = true; if (e.key === 'Shift') keys.shift = true; });
        window.addEventListener('keyup', e => { if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = false; if (e.key === 'Shift') keys.shift = false; });
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });
        renderer.domElement.addEventListener('mousedown', onCanvasMouseDown);
        setupMobileControls();
    }

    function performInteraction(clientX, clientY) {
        mouse.x = (clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        // Scientific objects: a quick tap/click gives them a small illustrative upward impulse,
        // and — if a guided protocol is running — advances it when the right residue is clicked.
        const sciTargets = [...sciObjects.values()].map(o => o.mesh);
        const sciHits = raycaster.intersectObjects(sciTargets, false);
        if (sciHits.length > 0) {
            const id = sciHits[0].object.userData.sciId;
            callTool('apply_impulse', { object_id: id, force_vector: { x: (Math.random() - 0.5) * 2, y: 3, z: (Math.random() - 0.5) * 2 } });
            handleProtocolObjectClick(id);
            return;
        }

        const targets = [];
        players.forEach(p => { if (p.model && !p.loading) targets.push(p.model); });
        const intersects = raycaster.intersectObjects(targets, true);
        if (intersects.length > 0) {
            let obj = intersects[0].object;
            while (obj.parent && !obj.userData.playerId) obj = obj.parent;
            if (obj.userData.playerId) {
                const pid = obj.userData.playerId;
                const p = players.get(pid);
                const menu = document.getElementById('interaction-menu');
                document.getElementById('target-name').innerText = p.nick;
                // On a touch device there's no cursor position to anchor to, so center the menu.
                menu.style.left = (isTouchDevice ? window.innerWidth / 2 - 100 : clientX) + 'px';
                menu.style.top = (isTouchDevice ? window.innerHeight / 2 - 40 : clientY) + 'px';
                menu.style.display = 'block';
                currentTargetId = pid;
                currentTargetNick = p.nick;
                return true;
            }
        }
        return false;
    }

    function onCanvasMouseDown(event) {
        const hit = performInteraction(event.clientX, event.clientY);
        if (hit) event.stopPropagation();
    }

    /* ---- Mobile touch controls: virtual joystick, run toggle, center-screen interact ---- */
    function setupMobileControls() {
        if (!isTouchDevice) return;
        document.body.classList.add('is-touch');

        const base = document.getElementById('joystick-base');
        const knob = document.getElementById('joystick-knob');
        const runBtn = document.getElementById('mobile-run-btn');
        const interactBtn = document.getElementById('mobile-interact-btn');
        if (!base || !knob || !runBtn || !interactBtn) return;

        const maxRadius = 40; // px the knob can travel from center
        let activeTouchId = null;

        function setKnob(dx, dy) {
            const dist = Math.min(Math.hypot(dx, dy), maxRadius);
            const angle = Math.atan2(dy, dx);
            const kx = Math.cos(angle) * dist;
            const ky = Math.sin(angle) * dist;
            knob.style.transform = `translate(${kx}px, ${ky}px)`;
            mobileMove.x = kx / maxRadius;
            mobileMove.y = ky / maxRadius;
        }

        function resetKnob() {
            knob.style.transform = 'translate(0px, 0px)';
            mobileMove.x = 0;
            mobileMove.y = 0;
            activeTouchId = null;
        }

        base.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.changedTouches[0];
            activeTouchId = touch.identifier;
            const rect = base.getBoundingClientRect();
            const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
            setKnob(touch.clientX - cx, touch.clientY - cy);
        }, { passive: false });

        base.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = [...e.changedTouches].find(t => t.identifier === activeTouchId);
            if (!touch) return;
            const rect = base.getBoundingClientRect();
            const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
            setKnob(touch.clientX - cx, touch.clientY - cy);
        }, { passive: false });

        base.addEventListener('touchend', (e) => {
            e.preventDefault();
            const touch = [...e.changedTouches].find(t => t.identifier === activeTouchId);
            if (touch) resetKnob();
        }, { passive: false });
        base.addEventListener('touchcancel', resetKnob);

        runBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            mobileRunActive = !mobileRunActive;
            runBtn.classList.toggle('active', mobileRunActive);
        }, { passive: false });

        interactBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            performInteraction(window.innerWidth / 2, window.innerHeight / 2);
        }, { passive: false });
    }

    function updateLocal(delta) {
        if (!localModel) return;
        const joystickMag = Math.hypot(mobileMove.x, mobileMove.y);
        const joystickActive = joystickMag > 0.15;
        const isMoving = keys.w || keys.a || keys.s || keys.d || joystickActive;
        const running = keys.shift || mobileRunActive;
        // If this character has no walk/run clip for its skeleton (e.g. the mannequin, which only
        // ships a single idle pose on a non-Mixamo rig), hold idle rather than fading it out —
        // otherwise the mesh would fall back to its bind/T-pose while translating across the floor.
        const hasWalkRun = !!(localActions.walk || localActions.run);
        const currentAnim = (isMoving && hasWalkRun) ? (running ? 'run' : 'walk') : 'idle';
        Object.keys(localActions).forEach(k => {
            const act = localActions[k];
            if (act) act.setEffectiveWeight(THREE.MathUtils.lerp(act.getEffectiveWeight(), k === currentAnim ? 1 : 0, delta * 10));
        });
        if (joystickActive) {
            // Continuous analog direction from the on-screen joystick, relative to the camera.
            const camAngle = Math.atan2(camera.position.x - localModel.position.x, camera.position.z - localModel.position.z);
            const inputAngle = Math.atan2(mobileMove.x, -mobileMove.y);
            rotateQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), camAngle + inputAngle + Math.PI);
            localModel.quaternion.rotateTowards(rotateQuaternion, 0.2);
            const speed = (running ? 6 : 2.5) * Math.min(joystickMag, 1);
            walkDirection.set(0, 0, 1).applyQuaternion(localModel.quaternion);
            localModel.position.addScaledVector(walkDirection, speed * delta);
        } else if (isMoving) {
            const angle = Math.atan2(camera.position.x - localModel.position.x, camera.position.z - localModel.position.z);
            let offset = 0;
            if (keys.w) { if (keys.a) offset = Math.PI / 4; else if (keys.d) offset = -Math.PI / 4; }
            else if (keys.s) { if (keys.a) offset = Math.PI * 0.75; else if (keys.d) offset = -Math.PI * 0.75; else offset = Math.PI; }
            else if (keys.a) offset = Math.PI / 2; else if (keys.d) offset = -Math.PI / 2;
            rotateQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle + offset + Math.PI);
            localModel.quaternion.rotateTowards(rotateQuaternion, 0.2);
            const speed = running ? 6 : 2.5;
            walkDirection.set(0, 0, 1).applyQuaternion(localModel.quaternion);
            localModel.position.addScaledVector(walkDirection, speed * delta);
        }
        cameraTarget.set(localModel.position.x, localModel.position.y + 1.5, localModel.position.z);
        controls.target.lerp(cameraTarget, 0.1);
    }

    function animate() {
        requestAnimationFrame(animate);
        const delta = clock.getDelta();
        const elapsedTime = clock.getElapsedTime();

        if (localMixer) localMixer.update(delta);
        updateLocal(delta);

        players.forEach(p => {
            if (p.loading || !p.model) return;
            const sprite = p.messageIconSprite;
            if (sprite) {
                const scale = 1.2 + 0.1 * Math.sin(elapsedTime * 6);
                sprite.scale.set(scale, scale, 1);
            }
            p.mixer?.update(delta);
            if (!p.loading && p.model) {
                p.model.position.lerp(p.targetPos, 0.2);
                p.model.quaternion.slerp(p.targetRot, 0.2);
                const hasWalkRun = !!(p.actions?.walk || p.actions?.run);
                const effectiveAnim = hasWalkRun ? p.targetAnim : 'idle';
                Object.keys(p.actions).forEach(k => {
                    const act = p.actions[k];
                    if (act) act.setEffectiveWeight(THREE.MathUtils.lerp(act.getEffectiveWeight(), k === effectiveAnim ? 1 : 0, delta * 10));
                });
            }
        });

        // Gentle idle sway for loaded scientific objects so the lab feels alive even at rest,
        // plus the staggered scale-in "assembly" reveal kicked off by animateStructureAssembly().
        sciObjects.forEach(obj => {
            obj.mesh.rotation.y += delta * 0.15;
            const ud = obj.mesh.userData;
            if (ud.revealStart !== undefined) {
                const elapsed = performance.now() - ud.revealStart - ud.revealDelay;
                if (elapsed >= 0) {
                    const t = THREE.MathUtils.clamp(elapsed / 300, 0, 1); // 300ms pop-in per atom
                    obj.mesh.scale.setScalar(THREE.MathUtils.lerp(0.001, ud.revealTargetScale, t));
                    if (t >= 1) delete ud.revealStart;
                }
            }
        });
        // Grow the backbone trace alongside the atom reveal, and keep it pinned to each atom's
        // current position — so it stays correct even while "Run N sim steps" is moving them.
        if (sciBackboneLine && sciBackboneIds.length) {
            const posAttr = sciBackboneLine.geometry.attributes.position;
            sciBackboneIds.forEach((id, i) => {
                const obj = sciObjects.get(id);
                if (obj) posAttr.setXYZ(i, obj.mesh.position.x, obj.mesh.position.y, obj.mesh.position.z);
            });
            posAttr.needsUpdate = true;
            const elapsed = (performance.now() - sciBackboneLine.userData.revealStart) / 1500;
            const shown = Math.min(sciBackboneIds.length, Math.ceil(THREE.MathUtils.clamp(elapsed, 0, 1) * sciBackboneIds.length));
            sciBackboneLine.geometry.setDrawRange(0, shown);
        }

        controls.update();
        renderer.render(scene, camera);
    }