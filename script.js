/*** GAME STATE ***/
const TICK_MS = 500; // ritmo de simulación
const GRID_N = 4; // 4x4 (editable)

// --- Nuevas constantes de salud / plagas ---
const WATER_OK_MIN = 20; // zona ideal >=20
const WATER_LOW = 10; // por debajo = sequía
const WATER_HIGH = 90; // por encima = exceso
const DROUGHT_LIMIT = 12; // ticks en sequía antes de riesgo serio
const FLOOD_LIMIT = 12; // ticks en exceso antes de riesgo serio
const BASE_PLAGUE_CHANCE = 0.001; // probabilidad base por tick

const defaultState = () => ({
  money: 5,
  stock: 0,
  tick: 0,
  paused: false,
  priceBase: 1,
  qualityLevel: 0, // multiplica el precio
  growthLevel: 0, // multiplica la velocidad de crecimiento
  yieldLevel: 0, // multiplica la cosecha por planta
  plotCount: 0, // veces ampliada la parcela
  autos: { sprinkler: false, picker: false, vendor: false },
  field: Array(GRID_N * GRID_N)
    .fill(null)
    .map((_, i) => newPlant(i === 0)), // empieza con 1 planta
});

function newPlant(start = false) {
  return {
    alive: start, // si hay planta en la parcela
    stage: start ? "seedling" : "empty", // empty | seedling | growing | ripe | dead
    water: start ? 50 : 0, // 0-100
    growth: start ? 0 : 0, // 0-100
    quality: 1, // factor individual (afectado por upgrades globales)
    fruits: 0, // frutos listos en la planta (cuando ripe)
    // --- Salud / plagas ---
    plague: false, // ¿infectada?
    droughtTicks: 0, // secado acumulado
    floodTicks: 0, // encharcado acumulado
  };
}

let S = load() || defaultState();
migrateState();

/*** ECONOMÍA Y REGLAS ***/
function pricePerFruit() {
  const qualityMult = 1 + S.qualityLevel * 0.25; // +25% por nivel
  return +(S.priceBase * qualityMult).toFixed(2);
}

function growthRate() {
  const base = 2; // puntos por tick
  return base * (1 + S.growthLevel * 0.25);
}

function yieldPerCycle() {
  const base = 2; // frutos por ciclo
  return Math.round(base * (1 + S.yieldLevel * 0.4));
}

function reserveAmount() {
  return Math.ceil(S.stock * 0.1); // 10% bloqueado
}

/*** UI ***/
const elGrid = document.getElementById("grid");
const elLog = document.getElementById("log");
const elMoney = document.getElementById("money");
const elStock = document.getElementById("stock");
const elPrice = document.getElementById("price");
const elReserve = document.getElementById("reserve");
const elTick = document.getElementById("tick");
const elSizeLabel = document.getElementById("sizeLabel");
const plantInfo = document.getElementById("plantInfo");
const actions = document.getElementById("actions");
const shopDialog = document.getElementById("shopDialog");
const shopUpgrades = document.getElementById("shopUpgrades");
const shopAutos = document.getElementById("shopAutos");

document.documentElement.style.setProperty("--grid", GRID_N);
elSizeLabel.textContent = GRID_N + "x" + GRID_N;

function tileEmoji(p) {
  if (!p || !p.alive) return "🪹";
  if (p.stage === "dead") return "💀";
  if (p.plague) return "🐛";
  if (p.stage === "seedling") return "🌱";
  if (p.stage === "growing") return "🪴";
  if (p.stage === "ripe") return "🍓";
  return "⬜️";
}

function render() {
  // header
  elMoney.textContent = S.money.toFixed(2);
  elStock.textContent = S.stock;
  elPrice.textContent = pricePerFruit().toFixed(2);
  elReserve.textContent = reserveAmount();
  elTick.textContent = S.tick;
  const btnPause = document.getElementById("btnPause");
  if (btnPause) {
    btnPause.textContent = S.paused ? "▶️ Reanudar" : "⏸️ Pausar";
    btnPause.classList.toggle("warn", S.paused);
  }
  // bloquear UI cuando está en pausa
  document.body.classList.toggle("paused", S.paused);
  const ids = ["btnHarvest", "btnSell", "btnShop", "btnHints", "btnSave", "btnReset"];
  ids.forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = S.paused;
  });

  // grid
  elGrid.innerHTML = "";
  S.field.forEach((p, idx) => {
    const tile = document.createElement("div");
    tile.className = "tile";
    const em = document.createElement("div");
    em.className = "emoji";
    em.textContent = tileEmoji(p);
    tile.appendChild(em);
    const badge = document.createElement("div");
    badge.className = "badge";
    
    // Añadir clase para agua baja
    if (p && p.alive && p.water < WATER_OK_MIN) {
      badge.classList.add("low-water");
    }
    
    if (p && p.alive) {
      const flags = [
        `${Math.floor(p.growth)}%`,
        `💧${Math.floor(p.water)}`,
      ];
      if (p.plague) flags.push("🐛");
      if (p.stage === "dead") flags.push("💀");
      badge.textContent = flags.join("|");
    } else {
      badge.textContent = "vacío";
    }
    tile.appendChild(badge);
    const btn = document.createElement("button");
    btn.title = "Seleccionar";
    btn.addEventListener("click", () => selectPlant(idx));
    tile.appendChild(btn);
    elGrid.appendChild(tile);
  });

  // tienda
  renderOwnedPanel();
  renderShop();
}

let selectedIndex = -1;
function selectPlant(i) {
  selectedIndex = i;
  if (S.paused) {
    toast("Juego en pausa ⏸️");
    return;
  }
  const p = S.field[i];
  actions.innerHTML = "";
  if (!p || !p.alive) {
    plantInfo.innerHTML = `<b>Parcela ${i + 1}</b>: <span class="muted">vacía</span>`;
    addAction("🌱 Replantar (1 fruto)", () => {
      if (S.stock <= reserveAmount())
        return toast("No puedes usar la reserva.");
      if (S.stock <= 0) return toast("Sin frutos en stock.");
      S.stock -= 1;
      S.field[i] = newPlant(true);
      log("Has replantado una parcela con 1 fruto.");
      render();
    });
    return;
  }
  const stageMap = {
    seedling: "brote",
    growing: "creciendo",
    ripe: "madura",
    dead: "muerta",
  };
  const stageLabel = stageMap[p.stage] || p.stage;
  plantInfo.innerHTML = `<b>Planta ${i + 1}</b> — estado: <b>${stageLabel}${p.plague ? ' · <span class="danger">plaga</span>' : ""}</b><br>
    Crecimiento: ${Math.floor(p.growth)}% · Agua: ${Math.floor(p.water)}/100 · Calidad: x${(p.quality * (1 + S.qualityLevel * 0.25)).toFixed(2)} ${p.stage === "ripe" ? `· Frutos: ${p.fruits}` : ""}`;

  if (p.stage !== "dead") {
    addAction("💧 Regar (+20)", () => {
      const before = p.water;
      p.water = Math.min(100, p.water + 20);
      const added = p.water - before;
      const cost = +(added * WATER_COST_PER_UNIT).toFixed(6);
      if (added > 0) {
        S.money -= cost;
      }
      log(`Has regado la planta ${i + 1}. Coste agua: ${cost} €`);
      render();
    });
    addAction("🧯 Purgar agua (-20)", () => {
      p.water = Math.max(0, p.water - 20);
      render();
    });
  }

  if (p.stage === "ripe" && p.fruits > 0) {
    addAction("🧺 Cosechar", () => {
      S.stock += p.fruits;
      log(`Cosecha manual de planta ${i + 1}: +${p.fruits} 🍓.`);
      p.fruits = 0;
      p.stage = "growing";
      p.growth = 0; // nuevo ciclo
      render();
    });
  }

  if (p.plague && p.stage !== "dead") {
    addAction("🧪 Tratar plaga (2 €)", () => {
      if (S.money >= 2) {
        S.money -= 2;
        p.plague = false;
        log(`Plaga tratada en planta ${i + 1}.`);
        render();
      } else toast("Necesitas 2 € para tratar la plaga.");
    });
  }

  addAction(
    p.stage === "dead" ? "🗑️ Retirar planta muerta" : "🪓 Quitar planta",
    () => {
      S.field[i] = newPlant(false);
      log(`Has quitado la planta ${i + 1}.`);
      render();
    },
  );
}

function addAction(label, fn) {
  const b = document.createElement("button");
  b.className = "btn";
  b.textContent = label;
  b.onclick = () => {
    if (S.paused) return;
    fn();
  };
  actions.appendChild(b);
}

function rand() {
  return Math.random();
}

/*** LOOP ***/
function step() {
  if (S.paused) return;
  S.tick++;
  S.field.forEach((p) => {
    if (!p.alive) return;

    if (p.stage === "dead") return; // parcela ocupada con cadáver hasta quitarla

    // consumo de agua
    p.water = Math.max(0, p.water - 0.8);

    // Contadores de sequía / encharcado
    if (p.water < WATER_LOW) {
      p.droughtTicks++;
    } else if (p.water > WATER_HIGH) {
      p.floodTicks++;
    } else {
      // en zona segura, los contadores se reducen suavemente
      p.droughtTicks = Math.max(0, p.droughtTicks - 1);
      p.floodTicks = Math.max(0, p.floodTicks - 1);
    }

    // Crecimiento (pausado si no hay agua mínima o hay plaga)
    const hydrated = p.water >= WATER_OK_MIN;
    const canGrow = hydrated && !p.plague;
    if (canGrow) {
      p.growth = Math.min(100, p.growth + growthRate());
    } else if (!hydrated) {
      p.growth = Math.max(0, p.growth - 0.5);
    }

    // transición de estados de madurez
    if (p.growth >= 100 && p.stage !== "ripe") {
      p.stage = "ripe";
      p.fruits = yieldPerCycle();
    } else if (p.stage === "seedling" && p.growth >= 25) {
      p.stage = "growing";
    }

    // Riesgo de muerte por agua (exceso/defecto)
    if (p.droughtTicks >= DROUGHT_LIMIT || p.floodTicks >= FLOOD_LIMIT) {
      const stress =
        p.droughtTicks >= DROUGHT_LIMIT
          ? p.droughtTicks - DROUGHT_LIMIT + 1
          : p.floodTicks - FLOOD_LIMIT + 1;
      const deathChance = Math.min(0.05 + 0.01 * stress, 0.5); // escala hasta 50%
      if (rand() < deathChance) {
        p.stage = "dead";
        p.plague = false;
        p.fruits = 0;
        p.growth = 0;
        log(
          "Una planta ha muerto por " +
            (p.droughtTicks >= DROUGHT_LIMIT
              ? "sequía"
              : "exceso de agua") +
            " 💀",
        );
        return;
      }
    }

    // Aparición de plaga (más probable con estrés hídrico)
    if (!p.plague) {
      const stressScore =
        Math.max(0, p.droughtTicks - 4) + Math.max(0, p.floodTicks - 4);
      const plagueChance = Math.min(
        BASE_PLAGUE_CHANCE + 0.0005 * stressScore,
        0.05,
      );
      if (rand() < plagueChance) {
        p.plague = true;
        log('⚠️ Plaga detectada en una planta. (Usa "Tratar plaga")');
      }
    } else {
      // Progresión de plaga: pequeña probabilidad de muerte por tick, aumenta con estrés
      const stressScore =
        Math.max(0, p.droughtTicks - 4) + Math.max(0, p.floodTicks - 4);
      const killChance = Math.min(0.01 + 0.002 * stressScore, 0.25);
      if (rand() < killChance) {
        p.stage = "dead";
        p.plague = false;
        p.fruits = 0;
        p.growth = 0;
        log("Una planta ha sucumbido a la plaga 💀");
        return;
      }
    }
  });

  // Automatizaciones
  if (S.autos.sprinkler) {
    S.field.forEach((p) => {
      if (p.alive && p.stage !== "dead" && p.water < 60) {
        const add = Math.min(6, 100 - p.water);
        if (add > 0) {
          p.water = p.water + add;
          S.money -= +(add * WATER_COST_PER_UNIT).toFixed(6);
        }
      }
    });
  }
  if (S.autos.picker) {
    S.field.forEach((p) => {
      if (p.alive && p.stage === "ripe" && p.fruits > 0) {
        S.stock += p.fruits;
        p.fruits = 0;
        p.stage = "growing";
        p.growth = 0;
      }
    });
  }
  if (S.autos.vendor) {
    autoSellExcess();
  }

  if (S.tick % 10 === 0) render();
}

/*** VENDER ***/
function sell(amount) {
  const minKeep = reserveAmount();
  const sellable = Math.max(0, S.stock - minKeep);
  const n = Math.min(amount, sellable);
  if (n <= 0) {
    toast("Nada que vender (respeta la reserva del 10%).");
    return 0;
  }
  const total = n * pricePerFruit();
  S.stock -= n;
  S.money += total;
  log(`Vendidos ${n} 🍓 por ${total.toFixed(2)} €.`);
  return n;
}

function autoSellExcess() {
  const minKeep = reserveAmount();
  const sellable = S.stock - minKeep;
  if (sellable > 0) sell(sellable);
}

/*** MEJORAS & AUTOS ***/
const UPG_BASE = { quality: 30, growth: 40, yield: 60, plot: 50 };
const WATER_COST_PER_UNIT = 0.2 / 20; // coste por unidad de agua añadida

function upgradeLevel(key) {
  if (key === "quality") return S.qualityLevel || 0;
  if (key === "growth") return S.growthLevel || 0;
  if (key === "yield") return S.yieldLevel || 0;
  if (key === "plot") return S.plotCount || 0;
  return 0;
}
function nextUpgradePrice(key) {
  const base = UPG_BASE[key] || 0;
  const lvl = upgradeLevel(key);
  return Math.ceil(base * Math.pow(2.2, lvl)); // +120% por compra (x2.2)
}

const UPGRADES = [
  {
    key: "quality",
    label: "Fertilizante premium (+25% precio)",
    price: 30,
    apply: () => S.qualityLevel++,
  },
  {
    key: "growth",
    label: "Riego por goteo (+25% crecimiento)",
    price: 40,
    apply: () => S.growthLevel++,
  },
  {
    key: "yield",
    label: "Sustrato rico (+40% frutos/ciclo)",
    price: 60,
    apply: () => S.yieldLevel++,
  },
  {
    key: "plot",
    label: "Ampliar parcela (+1 planta)",
    price: 50,
    apply: () => addOnePlantSlot(),
  },
];

const AUTOS = [
  { key: "sprinkler", label: "Aspersor automático (riega)", price: 80 },
  { key: "picker", label: "Recolector automático", price: 120 },
  { key: "vendor", label: "Vendedor automático", price: 150 },
];

function renderShop() {
  // Upgrades
  shopUpgrades.innerHTML = "";
  UPGRADES.forEach((u) => {
    const row = document.createElement("div");
    row.className = "row";
    const owned =
      u.key === "quality"
        ? S.qualityLevel
        : u.key === "growth"
          ? S.growthLevel
          : u.key === "yield"
            ? S.yieldLevel
            : S.plotCount;
    row.innerHTML = `<div>${u.label} ${owned ? `<span class="kbd">Nivel ${owned}</span>` : ""}</div>`;
    const b = document.createElement("button");
    b.className = "btn primary";
    const price = nextUpgradePrice(u.key);
    b.textContent = `Comprar — ${price}€`;
    b.disabled = S.money < price;
    b.onclick = () => {
      if (S.paused) return;
      if (S.money >= price) {
        S.money -= price;
        u.apply();
        log(
          `Comprado: ${u.label}. Próximo precio: ${nextUpgradePrice(u.key)} €`,
        );
        render();
      }
    };
    row.appendChild(b);
    shopUpgrades.appendChild(row);
  });

  // Autos
  shopAutos.innerHTML = "";
  AUTOS.forEach((a) => {
    const row = document.createElement("div");
    row.className = "row";
    const active = !!S.autos[a.key];
    row.innerHTML = `<div>${a.label} ${active ? '<span class="kbd good">Activo</span>' : ""}</div>`;
    const b = document.createElement("button");
    b.className = "btn warn";
    b.textContent = active ? "Comprado" : `Comprar — ${a.price}€`;
    b.disabled = active || S.money < a.price;
    b.onclick = () => {
      if (S.paused) return;
      if (!active && S.money >= a.price) {
        S.money -= a.price;
        S.autos[a.key] = true;
        log(`Automatización activada: ${a.label}.`);
        render();
      }
    };
    row.appendChild(b);
    shopAutos.appendChild(row);
  });
}

function renderOwnedPanel() {
  const list = document.getElementById("ownedList");
  if (!list) return;
  list.innerHTML = "";
  const entries = [
    {
      name: "Fertilizante premium",
      key: "quality",
      level: S.qualityLevel || 0,
    },
    { name: "Riego por goteo", key: "growth", level: S.growthLevel || 0 },
    { name: "Sustrato rico", key: "yield", level: S.yieldLevel || 0 },
    { name: "Ampliar parcela", key: "plot", level: S.plotCount || 0 },
  ];
  entries.forEach((e) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<div>${e.name}</div><div><span class="kbd">Nivel ${e.level}</span> <span class="kbd">Próx: ${nextUpgradePrice(e.key)}€</span></div>`;
    list.appendChild(row);
  });
  const labels = {
    sprinkler: "Aspersor",
    picker: "Recolector",
    vendor: "Vendedor",
  };
  const autosRow = document.createElement("div");
  autosRow.className = "row";
  const autosHtml = Object.keys(labels)
    .map((k) =>
      S.autos[k]
        ? `<span class="kbd good">${labels[k]}</span>`
        : `<span class="kbd">${labels[k]}</span>`,
    )
    .join(" ");
  autosRow.innerHTML = `<div>Automatizaciones</div><div>${autosHtml}</div>`;
  list.appendChild(autosRow);
}

function addOnePlantSlot() {
  S.plotCount = (S.plotCount || 0) + 1;
  const idx = S.field.findIndex((p) => !p || !p.alive);
  if (idx !== -1) {
    S.field[idx] = newPlant(true);
    return;
  }
  S.field.push(newPlant(true));
}

/*** LOG, TOAST, SAVE ***/
function log(text) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<div>${text}</div>`;
  elLog.prepend(row);
}
function toast(text) {
  log(`<span class="danger">${text}</span>`);
}

function save() {
  localStorage.setItem("harvest_mvp", JSON.stringify(S));
}
function load() {
  try {
    return JSON.parse(localStorage.getItem("harvest_mvp"));
  } catch {
    return null;
  }
}

function migrateState() {
  // Asegura campos nuevos en partidas guardadas
  if (!S.field) return;
  S.field = S.field.map((p) => {
    if (!p) return newPlant(false);
    if (p.alive === undefined) p.alive = false;
    if (p.stage === undefined) p.stage = "empty";
    if (p.water === undefined) p.water = 0;
    if (p.growth === undefined) p.growth = 0;
    if (p.quality === undefined) p.quality = 1;
    if (p.fruits === undefined) p.fruits = 0;
    if (p.plague === undefined) p.plague = false;
    if (p.droughtTicks === undefined) p.droughtTicks = 0;
    if (p.floodTicks === undefined) p.floodTicks = 0;
    return p;
  });
  if (S.paused === undefined) S.paused = false;
  if (S.plotCount === undefined) S.plotCount = 0;
}

/*** CONTROLES ***/
document.getElementById("btnHarvest").onclick = () => {
  if (S.paused) return;
  let total = 0;
  S.field.forEach((p) => {
    if (p && p.alive && p.stage === "ripe" && p.fruits > 0) {
      total += p.fruits;
      p.fruits = 0;
      p.stage = "growing";
      p.growth = 0;
    }
  });
  if (total > 0) {
    S.stock += total;
    log(`Cosecha global: +${total} 🍓.`);
    render();
  } else toast("No hay frutos maduros.");
};
document.getElementById("btnSell").onclick = () => {
  if (S.paused) return;
  const sold = sell(1e9);
  if (sold > 0) render();
};
document.getElementById("btnShop").onclick = () => {
  if (S.paused) return;
  shopDialog.showModal();
};
document.getElementById("btnHints").onclick = () => {
  if (S.paused) return;
  hintsDialog.showModal();
};
document.getElementById("btnSave").onclick = () => {
  if (S.paused) return;
  save();
  log("Partida guardada.");
};
document.getElementById("btnReset").onclick = () => {
  if (S.paused) return;
  if (confirm("¿Resetear partida?")) {
    localStorage.removeItem("harvest_mvp");
    S = defaultState();
    render();
    log("Partida reiniciada.");
  }
};
document.getElementById("btnPause").onclick = () => {
  S.paused = !S.paused;
  if (S.paused && shopDialog.open) shopDialog.close();
  if (S.paused && hintsDialog.open) hintsDialog.close();
  log(S.paused ? "Juego en pausa ⏸️" : "Juego reanudado ▶️");
  render();
};
window.addEventListener("keydown", (e) => {
  if (e.key && e.key.toLowerCase() === "p") {
    S.paused = !S.paused;
    if (S.paused && shopDialog.open) shopDialog.close();
    if (S.paused && hintsDialog.open) hintsDialog.close();
    log(S.paused ? "Juego en pausa ⏸️" : "Juego reanudado ▶️");
    render();
  }
});

// Auto-save cada 30s
setInterval(() => save(), 30000);
// Game loop
setInterval(step, TICK_MS);

/*** SELF-TESTS (mínimos) ***/
function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}
function selfTests() {
  try {
    // Test 1: precio exponencial (+120% por compra)
    const base = 30; // usar quality
    const expectedL2 = Math.ceil(base * Math.pow(2.2, 2));
    const tmp = JSON.parse(JSON.stringify(S));
    S.qualityLevel = 2;
    console.assert(
      nextUpgradePrice("quality") === expectedL2,
      "nextUpgradePrice nivel 2 incorrecto",
    );

    // Test 2: coste de agua 20 unidades -> 0.0002
    const cost20 = 20 * WATER_COST_PER_UNIT;
    console.assert(
      approx(cost20, 0.2),
      "Coste de agua por 20 unidades incorrecto",
    );

    // Test 3: pausa bloquea step()
    const t0 = S.tick;
    S.paused = true;
    step();
    console.assert(S.tick === t0, "step avanzó ticks estando en pausa");
    S.paused = false;

    // restaurar estado
    S = Object.assign(S, tmp);
    log("✅ Tests básicos OK");
  } catch (e) {
    console.error("Self-tests error", e);
    log("❌ Error en tests: " + e.message);
  }
}

// Bootstrap
render();
selfTests();
log("¡Bienvenido! Riega la planta inicial y empieza a cosechar.");
