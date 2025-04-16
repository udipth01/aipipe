import { showUsage } from "./usage.js";

const $login = document.querySelector("#login");
const $result = document.querySelector("#result");
const $token = document.querySelector("#token");
const $usage = document.querySelector("#usage");

const redirect = new URLSearchParams(location.search).get("redirect");

// https://developers.google.com/identity/gsi/web/reference/js-reference
window.onload = function () {
  google.accounts.id.initialize({
    client_id: "1098061226510-1gn6mjnpdi30jiehanff71ri0ejva0t7.apps.googleusercontent.com",
    use_fedcm_for_button: true,
    // ux_mode: "redirect",
    callback: async (response) => {
      const profile = await fetch(`/token?credential=${response.credential}`).then((r) => r.json());
      localStorage.setItem("aipipe", JSON.stringify(profile));
      await init();
    },
  });
  // Render the Google Sign-In button
  google.accounts.id.renderButton($login, {
    theme: "filled_blue",
    size: "large",
    shape: "pill",
    state: location.search,
  });
};

async function init() {
  const { token, email } = JSON.parse(localStorage.getItem("aipipe") || "{}");
  if (!token) return;

  if (redirect) {
    const url = new URL(redirect, window.location.origin);
    url.searchParams.append("aipipe_token", token);
    url.searchParams.append("aipipe_email", email);
    window.location.href = url.toString();
    return;
  }

  $result.classList.remove("d-none");
  $token.value = token;
  await showUsage($usage, token, email);
}

init();
