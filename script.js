// ════════════════════════════════════════════════════════
//  COMBAT ZONE — 6v6 Team Deathmatch
//  Single-file game engine using Three.js r128
// ════════════════════════════════════════════════════════

'use strict';

// ── CONSTANTS ────────────────────────────────────────────
const WIN_SCORE    = 100;
const KILL_POINTS  = 5;
const PLAYER_HP    = 100;
const PLAYER_SPEED = 6;
const SPRINT_MULT  = 1.7;
const JUMP_VEL     = 8;
const GRAVITY      = 22;
const PLAYER_H     = 1.7;
const MAP_SIZE     = 60;
const BOT_SPEED    = 3.2;
const BOT_SIGHT    = 20;
const BOT_SHOOT_CD = 900; // ms

const WEAPONS = {
  1: { name:'SCAR-H',  damage:25, fireRate:150, magSize:30, reserve:90,  auto:true,  spread:0.02 },
  2: { name:'MP7',     damage:14, fireRate:80,  magSize:40, reserve:120, auto:true,  spread:0.03 },
  3: { name:'DEAGLE',  damage:60, fireRate:600, magSize:7,  reserve:35,  auto:false, spread:0.01 },
};

// ── STATE ─────────────────────────────────────────────────
let scene, camera, renderer, clock;
let gameRunning = false;
let gameOver    = false;

const teamScore = { alpha: 0, bravo: 0 };
const keys      = {};
let mouseDX = 0, mouseDY = 0;

// Player
const player = {
  team: 'alpha',
  hp: PLAYER_HP,
  alive: true,
  vel: new THREE.Vector3(),
  onGround: false,
  yaw: 0,
  pitch: 0,
  weapon: 1,
  ammo: { mag: 30, reserve: 90 },
  reloading: false,
  lastShot: 0,
  mouseDown: false,
};

const bots = [];
const bullets = [];
const walls = [];
const collidables = [];

// Minimap
let minimapCtx;

// ── INIT ──────────────────────────────────────────────────
function startGame() {
  document.getElementById('menu').style.display = 'none';
  document.getElementById('hud').classList.remove('hidden');

  initThree();
  buildMap();
  spawnPlayer();
  spawnBots();
  setupInput();

  minimapCtx = document.getElementById('minimap').getContext('2d');

  gameRunning = true;
  gameOver    = false;
  teamScore.alpha = 0;
  teamScore.bravo = 0;
  updateScoreUI();

  animate();
}

function restartGame() {
  // Clear scene
  while (scene.children.length) scene.remove(scene.children[0]);
  bots.length = 0;
  bullets.length = 0;
  walls.length = 0;
  collidables.length = 0;

  document.getElementById('win-screen').classList.add('hidden');
  document.getElementById('death-screen').classList.add('hidden');

  teamScore.alpha = 0;
  teamScore.bravo = 0;
  gameOver = false;

  buildMap();
  spawnPlayer();
  spawnBots();
  updateScoreUI();
  requestPointerLock();
}

// ── THREE.JS SETUP ─────────────────────────────────────────
function initThree() {
  clock = new THREE.Clock();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);
  scene.fog = new THREE.Fog(0x87CEEB, 30, 80);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);

  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
  sun.position.set(20, 40, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.width  = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far  = 200;
  sun.shadow.camera.left   = -60;
  sun.shadow.camera.right  =  60;
  sun.shadow.camera.top    =  60;
  sun.shadow.camera.bottom = -60;
  scene.add(sun);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ── MAP BUILDER ───────────────────────────────────────────
function makeMaterial(color, roughness = 0.8) {
  return new THREE.MeshLambertMaterial({ color });
}

function addBox(w, h, d, x, y, z, color, isWall = false) {
  const geo  = new THREE.BoxGeometry(w, h, d);
  const mat  = makeMaterial(color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Store AABB for collision
  const half = new THREE.Vector3(w / 2, h / 2, d / 2);
  const box  = new THREE.Box3(
    new THREE.Vector3(x - half.x, y - half.y, z - half.z),
    new THREE.Vector3(x + half.x, y + half.y, z + half.z)
  );
  collidables.push(box);
  if (isWall) walls.push(box);

  return mesh;
}

function buildMap() {
  const H2 = MAP_SIZE / 2;

  // Ground
  const groundGeo = new THREE.PlaneGeometry(MAP_SIZE + 20, MAP_SIZE + 20, 20, 20);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x5a7a3a });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Outer walls (invisible blockers)
  const WH = 6, WT = 1;
  addBox(MAP_SIZE, WH, WT,  0,  WH/2, -H2,  0x777777, true); // N
  addBox(MAP_SIZE, WH, WT,  0,  WH/2,  H2,  0x777777, true); // S
  addBox(WT, WH, MAP_SIZE,  H2, WH/2,  0,   0x777777, true); // E
  addBox(WT, WH, MAP_SIZE, -H2, WH/2,  0,   0x777777, true); // W

  // ── Cover / environment ──

  // Central tower
  addBox(6, 4, 6, 0, 2, 0, 0x8B7355, true);
  addBox(4, 0.3, 4, 0, 4.15, 0, 0x6B5335); // roof cap

  // Large containers
  const containers = [
    [-12, 0, -12], [12, 0, -12],
    [-12, 0,  12], [12, 0,  12],
    [ 0,  0, -18], [ 0,  0,  18],
    [-20, 0,  0 ], [20,  0,  0 ],
  ];
  containers.forEach(([x,,z]) => {
    addBox(4, 2.5, 2, x, 1.25, z, 0x4a6741, true);
  });

  // Crates scattered around
  const crates = [
    [-6,0,-8], [6,0,-8], [-6,0,8], [6,0,8],
    [-15,0,-8], [15,0,-8], [-15,0,8], [15,0,8],
    [-8,0,0], [8,0,0],
    [-18,0,-15], [18,0,15],
    [0,0,-10], [0,0,10],
  ];
  crates.forEach(([x,,z]) => {
    const s = 1.2 + Math.random() * 0.6;
    addBox(s, s, s, x, s/2, z, 0x8B6914, true);
  });

  // Low walls (L-shapes)
  const lWalls = [
    { w:6, h:1.2, d:0.5, x:-10, z:-5 },
    { w:0.5, h:1.2, d:4, x:-12.8, z:-3.5 },
    { w:6, h:1.2, d:0.5, x:10, z:5 },
    { w:0.5, h:1.2, d:4, x:12.8, z:3.5 },
  ];
  lWalls.forEach(({ w, h, d, x, z }) => {
    addBox(w, h, d, x, h/2, z, 0x9B9B9B, true);
  });

  // Barricade planks
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const r = 22;
    addBox(3, 1.5, 0.4, Math.cos(angle)*r, 0.75, Math.sin(angle)*r, 0x8B7355, true);
  }

  // Sandbags (low cover pairs)
  const sandbagPos = [
    [-5,0,-15],[5,0,-15],[-5,0,15],[5,0,15],
    [-22,0,-5],[22,0,5],
  ];
  sandbagPos.forEach(([x,,z]) => {
    addBox(2.5, 0.8, 0.8, x, 0.4, z, 0xC4A35A, true);
  });

  // Rubble / debris
  for (let i = 0; i < 10; i++) {
    const rx = (Math.random()-0.5)*48;
    const rz = (Math.random()-0.5)*48;
    const rs = 0.3 + Math.random()*0.5;
    addBox(rs, rs*0.5, rs, rx, rs*0.25, rz, 0x888888);
  }
}

// ── PLAYER SETUP ─────────────────────────────────────────
function spawnPlayer() {
  player.hp     = PLAYER_HP;
  player.alive  = true;
  player.vel.set(0, 0, 0);
  player.onGround = false;
  player.yaw   = 0;
  player.pitch = 0;
  player.weapon  = 1;
  player.reloading = false;
  player.lastShot  = 0;

  const w = WEAPONS[1];
  player.ammo = { mag: w.magSize, reserve: w.reserve };

  camera.position.set(0, PLAYER_H, -25);
  updateWeaponUI();
  updateHealthUI();
}

// ── BOT SYSTEM ───────────────────────────────────────────
const BOT_COLORS = { alpha: 0x1155cc, bravo: 0xcc2211 };

function createBotMesh(team) {
  const group = new THREE.Group();
  const col   = BOT_COLORS[team];

  // Body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 1.0, 0.35),
    new THREE.MeshLambertMaterial({ color: col })
  );
  body.position.y = 0.5;
  group.add(body);

  // Head
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.4, 0.4),
    new THREE.MeshLambertMaterial({ color: 0xf0c080 })
  );
  head.position.y = 1.2;
  group.add(head);

  // Helmet
  const helmet = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.22, 0.44),
    new THREE.MeshLambertMaterial({ color: col })
  );
  helmet.position.y = 1.42;
  group.add(helmet);

  // Gun
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.55),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
  );
  gun.position.set(0.32, 0.8, -0.3);
  group.add(gun);

  // Legs
  [-0.15, 0.15].forEach(ox => {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.6, 0.22),
      new THREE.MeshLambertMaterial({ color: col })
    );
    leg.position.set(ox, -0.3, 0);
    group.add(leg);
  });

  group.castShadow    = true;
  group.receiveShadow = true;
  scene.add(group);
  return group;
}

function spawnBots() {
  // 5 alpha bots + 6 bravo bots (player is alpha team)
  const spawns = {
    alpha: [
      [-5,0,-22], [5,0,-22], [-10,0,-18], [10,0,-18], [-3,0,-15]
    ],
    bravo: [
      [-5,0,22], [5,0,22], [-10,0,18], [10,0,18], [-3,0,15], [3,0,15]
    ]
  };

  ['alpha','bravo'].forEach(team => {
    spawns[team].forEach(([x, ,z]) => {
      const bot = {
        team,
        hp: PLAYER_HP,
        alive: true,
        mesh: createBotMesh(team),
        pos: new THREE.Vector3(x, PLAYER_H * 0.5, z),
        vel: new THREE.Vector3(),
        onGround: false,
        yaw: Math.random() * Math.PI * 2,
        weapon: Math.ceil(Math.random() * 3),
        lastShot: 0,
        lastDirectionChange: 0,
        targetYaw: Math.random() * Math.PI * 2,
        state: 'patrol', // patrol | engage
        spawnX: x, spawnZ: z,
        reloadTimer: 0,
        ammo: { mag: 30 },
      };
      bot.mesh.position.copy(bot.pos);
      bots.push(bot);
    });
  });
}

function respawnBot(bot) {
  bot.hp = PLAYER_HP;
  bot.alive = true;
  bot.mesh.visible = true;
  const angle = Math.random() * Math.PI * 2;
  const r = 8 + Math.random() * 12;
  const baseZ = bot.team === 'alpha' ? -20 : 20;
  bot.pos.set(
    Math.cos(angle) * r * 0.5,
    PLAYER_H * 0.5,
    baseZ + Math.sin(angle) * 4
  );
  bot.mesh.position.copy(bot.pos);
  bot.vel.set(0, 0, 0);
  bot.ammo.mag = 30;
}

// ── INPUT ─────────────────────────────────────────────────
function setupInput() {
  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Digit1') switchWeapon(1);
    if (e.code === 'Digit2') switchWeapon(2);
    if (e.code === 'Digit3') switchWeapon(3);
    if (e.code === 'KeyR' && !player.reloading) startReload();
  });
  document.addEventListener('keyup', e => { keys[e.code] = false; });

  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement !== document.body) return;
    mouseDX += e.movementX;
    mouseDY += e.movementY;
  });

  document.addEventListener('mousedown', e => {
    if (e.button === 0) {
      player.mouseDown = true;
      if (document.pointerLockElement !== document.body) {
        requestPointerLock();
      }
    }
  });
  document.addEventListener('mouseup', e => { if (e.button === 0) player.mouseDown = false; });

  document.addEventListener('pointerlockchange', () => {});
}

function requestPointerLock() {
  document.body.requestPointerLock();
}

// ── WEAPON LOGIC ─────────────────────────────────────────
function switchWeapon(num) {
  if (player.reloading) return;
  player.weapon = num;
  const w = WEAPONS[num];
  // keep ammo state separate per weapon - simple version: reset on switch
  player.ammo.mag     = w.magSize;
  player.ammo.reserve = w.reserve;
  updateWeaponUI();
}

function startReload() {
  const w = WEAPONS[player.weapon];
  if (player.ammo.reserve <= 0 || player.ammo.mag >= w.magSize) return;
  player.reloading = true;
  document.getElementById('reload-indicator').classList.remove('hidden');
  setTimeout(() => {
    if (!player.alive) return;
    const needed = w.magSize - player.ammo.mag;
    const take   = Math.min(needed, player.ammo.reserve);
    player.ammo.mag     += take;
    player.ammo.reserve -= take;
    player.reloading = false;
    document.getElementById('reload-indicator').classList.add('hidden');
    updateWeaponUI();
  }, 1800);
}

function tryShoot() {
  if (!player.alive || player.reloading || gameOver) return;
  const w    = WEAPONS[player.weapon];
  const now  = performance.now();
  if (now - player.lastShot < w.fireRate) return;
  if (player.ammo.mag <= 0) {
    startReload();
    return;
  }
  player.lastShot = now;
  player.ammo.mag--;
  updateWeaponUI();

  // Raycasting from camera
  const raycaster = new THREE.Raycaster();
  const spread = new THREE.Vector2(
    (Math.random()-0.5) * w.spread,
    (Math.random()-0.5) * w.spread
  );
  raycaster.setFromCamera(spread, camera);

  // Collect bot meshes
  const botMeshes = bots.filter(b => b.alive && b.team !== player.team).map(b => b.mesh);
  const allObjects = [];
  botMeshes.forEach(m => m.traverse(c => { if (c.isMesh) allObjects.push(c); }));

  const hits = raycaster.intersectObjects(allObjects, false);
  if (hits.length > 0) {
    // Find which bot was hit
    const hitObj = hits[0].object;
    for (const bot of bots) {
      if (!bot.alive) continue;
      let found = false;
      bot.mesh.traverse(c => { if (c === hitObj) found = true; });
      if (found) {
        damageBot(bot, w.damage);
        showHitMarker();
        break;
      }
    }
  }
  // Muzzle flash effect (brief)
  showMuzzleFlash();
}

function showMuzzleFlash() {
  // simple camera flash via brief brightness
}

function showHitMarker() {
  const hm = document.getElementById('hitmarker');
  hm.classList.remove('hidden');
  // force reflow
  void hm.offsetWidth;
  hm.style.animation = 'none';
  void hm.offsetWidth;
  hm.style.animation = '';
  setTimeout(() => hm.classList.add('hidden'), 260);
}

function damageBot(bot, amount) {
  if (!bot.alive) return;
  bot.hp -= amount;
  if (bot.hp <= 0) killBot(bot);
}

function killBot(bot) {
  bot.alive = false;
  bot.mesh.visible = false;

  // Score
  const scoringTeam = bot.team === 'alpha' ? 'bravo' : 'alpha';
  teamScore[scoringTeam] += KILL_POINTS;
  updateScoreUI();

  const isPlayerKill = (scoringTeam === 'alpha'); // player is alpha
  addKillFeed(isPlayerKill ? 'You' : `Bot`, bot.team, WEAPONS[player.weapon].name);

  checkWin();

  // Respawn after delay
  setTimeout(() => {
    if (!gameOver) respawnBot(bot);
  }, 3000);
}

// ── BOT AI ────────────────────────────────────────────────
function updateBots(dt) {
  const now = performance.now();
  bots.forEach(bot => {
    if (!bot.alive) return;

    const enemyPos = bot.team === 'bravo' ? camera.position : null;
    // For alpha bots, target nearest bravo bot or player position
    let target = null;

    if (bot.team === 'bravo') {
      target = camera.position;
    } else {
      // alpha bots target bravo bots or random patrol
      const bravoAlive = bots.filter(b => b.alive && b.team === 'bravo');
      if (bravoAlive.length > 0) {
        let closest = null, closestDist = Infinity;
        bravoAlive.forEach(b => {
          const d = bot.pos.distanceTo(b.pos);
          if (d < closestDist) { closestDist = d; closest = b; }
        });
        target = closest ? closest.pos : null;
      }
    }

    const distToTarget = target ? bot.pos.distanceTo(target) : Infinity;
    bot.state = distToTarget < BOT_SIGHT ? 'engage' : 'patrol';

    // Rotation toward target or wander
    if (bot.state === 'engage' && target) {
      const dx = target.x - bot.pos.x;
      const dz = target.z - bot.pos.z;
      bot.targetYaw = Math.atan2(dx, dz);
    } else {
      // Wander
      if (now - bot.lastDirectionChange > 1800 + Math.random()*1200) {
        bot.targetYaw = Math.random() * Math.PI * 2;
        bot.lastDirectionChange = now;
      }
    }

    // Smooth turn
    let dyaw = bot.targetYaw - bot.yaw;
    while (dyaw >  Math.PI) dyaw -= Math.PI*2;
    while (dyaw < -Math.PI) dyaw += Math.PI*2;
    bot.yaw += dyaw * Math.min(1, dt * 4);

    // Movement
    const speed = bot.state === 'engage' && distToTarget > 4 ? BOT_SPEED : (bot.state === 'patrol' ? BOT_SPEED * 0.6 : 0);
    const moveDir = new THREE.Vector3(Math.sin(bot.yaw), 0, Math.cos(bot.yaw));
    bot.vel.x = moveDir.x * speed;
    bot.vel.z = moveDir.z * speed;

    // Gravity
    if (!bot.onGround) bot.vel.y -= GRAVITY * dt;
    else bot.vel.y = 0;

    // Try move with simple wall avoidance
    const newPos = bot.pos.clone().addScaledVector(bot.vel, dt);
    newPos.y = Math.max(PLAYER_H * 0.5, newPos.y + bot.vel.y * dt);

    // Clamp to map
    const H2 = MAP_SIZE/2 - 2;
    newPos.x = Math.max(-H2, Math.min(H2, newPos.x));
    newPos.z = Math.max(-H2, Math.min(H2, newPos.z));

    // Simple wall collide
    const botBox = new THREE.Box3(
      new THREE.Vector3(newPos.x-0.35, newPos.y-PLAYER_H*0.5, newPos.z-0.35),
      new THREE.Vector3(newPos.x+0.35, newPos.y+PLAYER_H*0.5, newPos.z+0.35)
    );
    let collided = false;
    walls.forEach(w => { if (w.intersectsBox(botBox)) collided = true; });

    if (collided) {
      bot.targetYaw += Math.PI * (0.5 + Math.random()); // turn away
      bot.pos.y = PLAYER_H * 0.5;
    } else {
      bot.pos.copy(newPos);
      bot.pos.y = PLAYER_H * 0.5;
      bot.onGround = true;
    }

    bot.mesh.position.copy(bot.pos);
    bot.mesh.rotation.y = -bot.yaw;

    // Shoot at target
    if (bot.state === 'engage' && distToTarget < BOT_SIGHT && now - bot.lastShot > BOT_SHOOT_CD) {
      botShoot(bot, target, distToTarget);
      bot.lastShot = now;
    }
  });
}

function botShoot(bot, target, dist) {
  if (!target || gameOver) return;

  // Is target the player?
  const shootsPlayer = (bot.team === 'bravo' && target === camera.position);
  const hitChance = Math.max(0.05, 0.6 - dist * 0.025);

  if (Math.random() < hitChance) {
    if (shootsPlayer && player.alive) {
      const w = WEAPONS[bot.weapon];
      damagePlayer(w.damage * (0.5 + Math.random()*0.5));
    } else {
      // hit an alpha bot
      const alphaBots = bots.filter(b => b.alive && b.team === 'alpha');
      if (alphaBots.length > 0) {
        const victim = alphaBots[Math.floor(Math.random()*alphaBots.length)];
        const dmg = WEAPONS[bot.weapon].damage * (0.5 + Math.random()*0.5);
        damageBot(victim, dmg);
        if (!victim.alive) {
          teamScore.bravo += KILL_POINTS;
          updateScoreUI();
          addKillFeed('Bot(B)', 'alpha', WEAPONS[bot.weapon].name);
          checkWin();
        }
      }
    }
  }
}

// ── PLAYER PHYSICS ────────────────────────────────────────
function updatePlayer(dt) {
  if (!player.alive || gameOver) return;

  // Mouse look
  const sensitivity = 0.0018;
  player.yaw   -= mouseDX * sensitivity;
  player.pitch -= mouseDY * sensitivity;
  player.pitch  = Math.max(-Math.PI/2.2, Math.min(Math.PI/2.2, player.pitch));
  mouseDX = 0;
  mouseDY = 0;

  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  // Move direction
  const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right   = new THREE.Vector3( Math.cos(player.yaw), 0, -Math.sin(player.yaw));

  let speed = PLAYER_SPEED;
  if (keys['ShiftLeft'] || keys['ShiftRight']) speed *= SPRINT_MULT;

  const move = new THREE.Vector3();
  if (keys['KeyW']) move.addScaledVector(forward,  1);
  if (keys['KeyS']) move.addScaledVector(forward, -1);
  if (keys['KeyA']) move.addScaledVector(right,   -1);
  if (keys['KeyD']) move.addScaledVector(right,    1);
  if (move.length() > 0) move.normalize();
  move.multiplyScalar(speed);

  player.vel.x = move.x;
  player.vel.z = move.z;

  // Jump
  if ((keys['Space']) && player.onGround) {
    player.vel.y = JUMP_VEL;
    player.onGround = false;
  }

  // Gravity
  if (!player.onGround) player.vel.y -= GRAVITY * dt;

  // New position
  const pos = camera.position.clone();
  pos.x += player.vel.x * dt;
  pos.z += player.vel.z * dt;
  pos.y += player.vel.y * dt;

  // Floor
  if (pos.y < PLAYER_H) {
    pos.y = PLAYER_H;
    player.vel.y = 0;
    player.onGround = true;
  }

  // Map bounds
  const H2 = MAP_SIZE/2 - 1;
  pos.x = Math.max(-H2, Math.min(H2, pos.x));
  pos.z = Math.max(-H2, Math.min(H2, pos.z));

  // Wall collision (simple push-out)
  const playerBox = new THREE.Box3(
    new THREE.Vector3(pos.x-0.4, pos.y-PLAYER_H+0.05, pos.z-0.4),
    new THREE.Vector3(pos.x+0.4, pos.y+0.1,            pos.z+0.4)
  );
  walls.forEach(w => {
    if (w.intersectsBox(playerBox)) {
      // Push out on X
      const cx = (w.min.x + w.max.x) * 0.5;
      const cz = (w.min.z + w.max.z) * 0.5;
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      if (Math.abs(dx) > Math.abs(dz)) {
        pos.x = dx > 0 ? w.max.x + 0.41 : w.min.x - 0.41;
        player.vel.x = 0;
      } else {
        pos.z = dz > 0 ? w.max.z + 0.41 : w.min.z - 0.41;
        player.vel.z = 0;
      }
    }
  });

  camera.position.copy(pos);

  // Shooting
  if (player.mouseDown) {
    const w = WEAPONS[player.weapon];
    if (w.auto) tryShoot();
    else {
      // semi: only shoot once per press (handled via mousedown event)
    }
  }
}

// ── DAMAGE PLAYER ─────────────────────────────────────────
function damagePlayer(amount) {
  if (!player.alive || gameOver) return;
  player.hp = Math.max(0, player.hp - amount);
  updateHealthUI();
  flashDamage();
  if (player.hp <= 0) killPlayer();
}

function killPlayer() {
  player.alive = false;
  teamScore.bravo += KILL_POINTS;
  updateScoreUI();
  addKillFeed('You', 'alpha', 'Bot');
  checkWin();

  document.getElementById('death-screen').classList.remove('hidden');
  setTimeout(() => {
    if (gameOver) return;
    document.getElementById('death-screen').classList.add('hidden');
    player.hp = PLAYER_HP;
    player.alive = true;
    // Respawn at alpha spawn
    camera.position.set(
      (Math.random()-0.5)*8,
      PLAYER_H,
      -22 + Math.random()*4
    );
    player.vel.set(0,0,0);
    updateHealthUI();
  }, 2000);
}

function flashDamage() {
  const hud = document.getElementById('hud');
  hud.classList.add('hit');
  setTimeout(() => hud.classList.remove('hit'), 200);
}

// ── UI UPDATES ────────────────────────────────────────────
function updateWeaponUI() {
  const w = WEAPONS[player.weapon];
  document.getElementById('weapon-name').textContent = w.name;
  document.getElementById('ammo-current').textContent = player.ammo.mag;
  document.getElementById('ammo-reserve').textContent = player.ammo.reserve;
  [1,2,3].forEach(i => {
    document.getElementById(`wslot-${i}`).classList.toggle('active', i === player.weapon);
  });
}

function updateHealthUI() {
  const pct = (player.hp / PLAYER_HP) * 100;
  document.getElementById('health-bar').style.width = pct + '%';
  document.getElementById('health-val').textContent = Math.ceil(player.hp);
  const color = pct > 50 ? `linear-gradient(90deg,#ff4444,#ff8866)`
               : pct > 25 ? `linear-gradient(90deg,#ff6600,#ffaa00)`
               : `linear-gradient(90deg,#ff0000,#ff4400)`;
  document.getElementById('health-bar').style.background = color;
}

function updateScoreUI() {
  document.getElementById('score-alpha-val').textContent = teamScore.alpha;
  document.getElementById('score-bravo-val').textContent = teamScore.bravo;
  document.getElementById('bar-alpha').style.width = Math.min(100,(teamScore.alpha/WIN_SCORE)*100) + '%';
  document.getElementById('bar-bravo').style.width = Math.min(100,(teamScore.bravo/WIN_SCORE)*100) + '%';
}

const killFeedEntries = [];
function addKillFeed(killer, victimTeam, weapon) {
  const feed  = document.getElementById('killfeed');
  const entry = document.createElement('div');
  entry.className = 'kill-entry';
  const kc = killer === 'You' ? 'kf-alpha' : (victimTeam === 'alpha' ? 'kf-bravo' : 'kf-alpha');
  entry.innerHTML = `<span class="${kc}">${killer}</span> → ${weapon}`;
  feed.appendChild(entry);
  killFeedEntries.push(entry);
  if (killFeedEntries.length > 6) {
    feed.removeChild(killFeedEntries.shift());
  }
  setTimeout(() => {
    if (entry.parentNode) feed.removeChild(entry);
    const idx = killFeedEntries.indexOf(entry);
    if (idx > -1) killFeedEntries.splice(idx, 1);
  }, 3200);
}

// ── WIN CONDITION ─────────────────────────────────────────
function checkWin() {
  if (gameOver) return;
  if (teamScore.alpha >= WIN_SCORE || teamScore.bravo >= WIN_SCORE) {
    gameOver = true;
    const winner = teamScore.alpha >= WIN_SCORE ? 'ALPHA' : 'BRAVO';
    const color  = teamScore.alpha >= WIN_SCORE ? '#00c8ff' : '#ff4444';
    const ws = document.getElementById('win-screen');
    ws.classList.remove('hidden');
    const wt = document.getElementById('win-team');
    wt.textContent = `TEAM ${winner}`;
    wt.style.color = color;
    wt.style.textShadow = `0 0 30px ${color}`;
    document.exitPointerLock();
  }
}

// ── MINIMAP ───────────────────────────────────────────────
function drawMinimap() {
  if (!minimapCtx) return;
  const ctx = minimapCtx;
  const W = 140, H = 140;
  const scale = W / MAP_SIZE;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,10,20,0.7)';
  ctx.fillRect(0, 0, W, H);

  // Walls (approximate)
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  walls.forEach(box => {
    const bx = (box.min.x + MAP_SIZE/2) * scale;
    const bz = (box.min.z + MAP_SIZE/2) * scale;
    const bw = (box.max.x - box.min.x) * scale;
    const bd = (box.max.z - box.min.z) * scale;
    ctx.fillRect(bx, bz, bw, bd);
  });

  // Bots
  bots.forEach(bot => {
    if (!bot.alive) return;
    ctx.fillStyle = bot.team === 'alpha' ? '#00c8ff' : '#ff4444';
    const bx = (bot.pos.x + MAP_SIZE/2) * scale;
    const bz = (bot.pos.z + MAP_SIZE/2) * scale;
    ctx.beginPath();
    ctx.arc(bx, bz, 3, 0, Math.PI*2);
    ctx.fill();
  });

  // Player
  if (player.alive) {
    const px = (camera.position.x + MAP_SIZE/2) * scale;
    const pz = (camera.position.z + MAP_SIZE/2) * scale;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, pz, 4, 0, Math.PI*2);
    ctx.fill();
    // Direction indicator
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, pz);
    ctx.lineTo(px - Math.sin(player.yaw)*7, pz - Math.cos(player.yaw)*7);
    ctx.stroke();
  }

  // Border
  ctx.strokeStyle = 'rgba(0,200,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, W, H);
}

// ── SINGLE-CLICK SHOOT (semi-auto) ───────────────────────
document.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (!gameRunning || gameOver || !player.alive) return;
  const w = WEAPONS[player.weapon];
  if (!w.auto) tryShoot();
});

// ── MAIN LOOP ─────────────────────────────────────────────
function animate() {
  if (!gameRunning) return;
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);

  if (!gameOver) {
    updatePlayer(dt);
    updateBots(dt);
    drawMinimap();
  }

  renderer.render(scene, camera);
}

// ── AUTO-SHOOT for auto weapons ───────────────────────────
setInterval(() => {
  if (!gameRunning || gameOver || !player.alive) return;
  if (document.pointerLockElement !== document.body) return;
  if (!player.mouseDown) return;
  const w = WEAPONS[player.weapon];
  if (w.auto) tryShoot();
}, 16);
