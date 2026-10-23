// Two-step login: password, then (when the account has 2FA) the TOTP / recovery code.
const f = document.getElementById("f"), e = document.getElementById("e"), f2 = document.getElementById("f2"), e2 = document.getElementById("e2");
let pending = null;
async function post(path, body) {
  const r = await fetch("/_gw/api/" + path, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "collado" }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}
f.addEventListener("submit", async (ev) => {
  ev.preventDefault(); e.textContent = "";
  const btn = f.querySelector("button"); btn.disabled = true;
  try {
    const { ok, data } = await post("login", { username: f.username.value.trim(), password: f.password.value });
    if (!ok) { e.textContent = data.error || "No se pudo iniciar sesión"; f.password.select(); return; }
    if (data.need_totp) { pending = data.pending; f.hidden = true; f2.hidden = false; f2.code.value = ""; f2.code.focus(); return; }
    location.replace("/");
  } catch { e.textContent = "Sin conexión con el servidor"; } finally { btn.disabled = false; }
});
f2.addEventListener("submit", async (ev) => {
  ev.preventDefault(); e2.textContent = "";
  const btn = f2.querySelector("button[type=submit]"); btn.disabled = true;
  try {
    const { ok, data } = await post("login/totp", { pending, code: f2.code.value });
    if (!ok) { e2.textContent = data.error || "Código incorrecto"; if (/caduc/.test(data.error || "")) setTimeout(() => location.reload(), 1500); f2.code.select(); return; }
    location.replace("/");
  } catch { e2.textContent = "Sin conexión con el servidor"; } finally { btn.disabled = false; }
});
document.getElementById("back").addEventListener("click", () => { pending = null; f2.hidden = true; f.hidden = false; f.password.value = ""; f.password.focus(); });
