// Lightweight ambient background so the landing page isn't a static black frame while
        // it waits for an orchestrator. This is presentation only — the real WebMCP bridge and
        // Science Lab tools live in game.html.
        import * as THREE from 'three';

        const canvas = document.getElementById('simulation-canvas');
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.z = 12;

        const geometry = new THREE.IcosahedronGeometry(0.12, 0);
        const material = new THREE.MeshBasicMaterial({ color: 0xd4af37, wireframe: true, transparent: true, opacity: 0.55 });
        const nodes = [];
        for (let i = 0; i < 90; i++) {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 10);
            scene.add(mesh);
            nodes.push(mesh);
        }

        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        const clock = new THREE.Clock();
        (function animate() {
            requestAnimationFrame(animate);
            const t = clock.getElapsedTime();
            nodes.forEach((n, i) => {
                n.rotation.x += 0.003;
                n.rotation.y += 0.004;
                n.position.y += Math.sin(t * 0.5 + i) * 0.0015;
            });
            camera.position.x = Math.sin(t * 0.05) * 2;
            camera.lookAt(0, 0, 0);
            renderer.render(scene, camera);
        })();
