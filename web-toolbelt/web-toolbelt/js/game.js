import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
                msg.players.forEach(p => { if (p.id !== myId) addRemotePlayer(p.id, sanitizeNick(p.nick, p.id)); });
                if (msg.scienceState) applyRemoteScientificState(msg.scienceState, 'the session'); // catch up on the current experiment
                drawGraph();
                updateLabPlayerCount();
                break;
            case 'player-joined':
                if (msg.id !== myId) addRemotePlayer(msg.id, sanitizeNick(msg.nick, msg.id));
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
        const isMoving = keys.w || keys.a || keys.s || keys.d;
        const currentAnim = isMoving ? (keys.shift ? 'run' : 'walk') : 'idle';
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
    const CHARACTER_MODEL_URL = 'https://threejs.org/examples/models/gltf/Xbot.glb';

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
            graphCtx.font = 'bold 11px "Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
            graphCtx.fillStyle = '#000000';
            graphCtx.textAlign = 'center';
            graphCtx.textBaseline = 'top';
            graphCtx.fillText(nick.length > 8 ? nick.slice(0, 7) + '…' : nick, pos.x, pos.y + 20);
        });
        graphCtx.font = 'bold 10px sans-serif';
        graphCtx.fillText(`Players (${ids.length})`, centerX, h - 10);
    }

    function addRemotePlayer(id, nick) {
        const loader = new GLTFLoader();
        const model = new THREE.Group();
        model.userData.playerId = id;
        scene.add(model);
        players.set(id, { model, loading: true, nick, messageIconSprite: null });
        unreadCounts.set(id, 0);
        loader.load(CHARACTER_MODEL_URL, (gltf) => {
            const newModel = gltf.scene;
            newModel.userData.playerId = id;
            scene.remove(model);
            scene.add(newModel);
            newModel.traverse(c => { if (c.isMesh) c.userData.isPlayer = true; });
            const label = createTextLabel(nick, '#444');
            label.name = 'label';
            newModel.add(label);
            const mixer = new THREE.AnimationMixer(newModel);
            const actions = { idle: null, walk: null, run: null };
            setupAnimations(gltf.animations, mixer, actions);
            players.set(id, {
                model: newModel, mixer, actions, nick,
                targetPos: new THREE.Vector3(),
                targetRot: new THREE.Quaternion(),
                targetAnim: 'idle',
                messageIconSprite: null
            });
        });
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
        ctx.font = 'bold 42px sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 6;
        ctx.strokeText(text, 256, 64);
        ctx.fillText(text, 256, 64);
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(2.5, 0.6, 1);
        sprite.position.y = 2.4;
        return sprite;
    }

    function setupAnimations(clips, mixer, storage) {
        clips.forEach(clip => {
            const n = clip.name.toLowerCase();
            let type = n.includes('idle') ? 'idle' : n.includes('run') ? 'run' : n.includes('walk') ? 'walk' : null;
            if (type) {
                const action = mixer.clipAction(clip);
                storage[type] = action;
                action.play();
                action.setEffectiveWeight(type === 'idle' ? 1 : 0);
            }
        });
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
    graphCanvas.parentElement.addEventListener('click', () => openNickModal());
    window.openNickModal = () => {
        document.getElementById('nick-input').value = myNickname;
        document.getElementById('nickname-modal').style.display = 'block';
    };
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

    function clearAllSciObjects() {
        sciObjects.forEach(obj => scene.remove(obj.mesh));
        sciObjects.clear();
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
        refreshLabPanel();
        showNotification('Science Lab', `${originNick || 'A player'} shared "${state.metadata?.title || state.stateId}" with the session.`);
    }
    function applyRemoteScientificClear(originNick) {
        clearAllSciObjects();
        sciState = null;
        refreshLabPanel();
        showNotification('Science Lab', `${originNick || 'A player'} cleared the shared scientific state.`);
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

        const loader = new GLTFLoader();
        loader.load(CHARACTER_MODEL_URL, (gltf) => {
            localModel = gltf.scene;
            scene.add(localModel);
            localModel.traverse(c => { if (c.isMesh) { c.castShadow = true; c.userData.isPlayer = true; } });
            const label = createTextLabel(myNickname, '#007bff');
            label.name = 'label';
            localModel.add(label);
            localMixer = new THREE.AnimationMixer(localModel);
            setupAnimations(gltf.animations, localMixer, localActions);
            document.getElementById('loading-overlay').style.display = 'none';
            animate();
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

        // Scientific objects: a quick tap/click gives them a small illustrative upward impulse.
        const sciTargets = [...sciObjects.values()].map(o => o.mesh);
        const sciHits = raycaster.intersectObjects(sciTargets, false);
        if (sciHits.length > 0) {
            const id = sciHits[0].object.userData.sciId;
            callTool('apply_impulse', { object_id: id, force_vector: { x: (Math.random() - 0.5) * 2, y: 3, z: (Math.random() - 0.5) * 2 } });
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
        const currentAnim = isMoving ? (running ? 'run' : 'walk') : 'idle';
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
                Object.keys(p.actions).forEach(k => {
                    const act = p.actions[k];
                    if (act) act.setEffectiveWeight(THREE.MathUtils.lerp(act.getEffectiveWeight(), k === p.targetAnim ? 1 : 0, delta * 10));
                });
            }
        });

        // Gentle idle sway for loaded scientific objects so the lab feels alive even at rest.
        sciObjects.forEach(obj => { obj.mesh.rotation.y += delta * 0.15; });

        controls.update();
        renderer.render(scene, camera);
    }
