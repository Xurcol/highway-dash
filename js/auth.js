// The account screen, shown over the loading video once everything has downloaded: sign in, or
// create an account, or - when someone chose to stay signed in - one click to carry on. Resolves
// once an account is signed in; the save it loaded is already in P.
import { register, login, resume, keptAccount, hasAccounts, lastUsername } from "./profile.js?v=muew3v7x";

export function signIn() {
  const $ = (id) => document.getElementById(id);
  const root = $("auth"), form = $("authForm"), user = $("authUser"), pass = $("authPass"), pass2 = $("authPass2"), msg = $("authMsg"), go = $("authGo");
  let mode = hasAccounts() ? "login" : "register";
  root.hidden = false;
  // typing here is not driving: keep the keys away from the game's shortcuts
  root.addEventListener("keydown", (e) => e.stopPropagation());
  const say = (text) => { msg.textContent = text; msg.classList.remove("shake"); void msg.offsetWidth; if (text) msg.classList.add("shake"); };
  const setMode = (m) => {
    mode = m;
    root.querySelectorAll("[data-auth]").forEach((b) => b.classList.toggle("on", b.dataset.auth === m));
    $("authPass2Row").hidden = m !== "register";
    pass.autocomplete = m === "register" ? "new-password" : "current-password";
    go.textContent = m === "register" ? "Create account" : "Sign in";
    say("");
  };
  root.querySelectorAll("[data-auth]").forEach((b) => b.onclick = () => { setMode(b.dataset.auth); user.focus(); });
  user.value = lastUsername();
  setMode(mode);
  return new Promise((resolve) => {
    const done = () => { root.classList.add("done"); resolve(); };
    // stayed signed in last time: carry on, or switch to someone else
    const kept = keptAccount();
    if (kept) {
      $("authQuick").hidden = false; form.hidden = true; $("authTabs").hidden = true;
      $("authQuickName").textContent = kept.name;
      $("authContinue").onclick = () => { resume(); done(); };
      $("authSwitch").onclick = () => { $("authQuick").hidden = true; form.hidden = false; $("authTabs").hidden = false; pass.focus(); };
      $("authContinue").focus();
    } else (user.value ? pass : user).focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (mode === "register" && pass.value !== pass2.value) return say("The passwords don't match");
      go.disabled = true; const label = go.textContent; go.textContent = mode === "register" ? "Creating…" : "Signing in…";
      try {
        if (mode === "register") await register(user.value, pass.value, $("authKeep").checked);
        else await login(user.value, pass.value, $("authKeep").checked);
        pass.value = pass2.value = "";
        done();
      } catch (err) {
        say(err.message || "Something went wrong");
        go.disabled = false; go.textContent = label;
        pass.select();
      }
    };
  });
}
