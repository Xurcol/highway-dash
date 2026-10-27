import { bootArcline } from "./arcline-main.js?v=mvq292b7";

bootArcline().catch(error => {
  console.error(error);
  document.getElementById("loader").hidden = true;
  document.getElementById("arcError").hidden = false;
  document.getElementById("arcErrorMsg").textContent = error.message || "ARCLINE could not start. Reload the page to try again.";
  document.getElementById("arcReload").onclick = () => location.reload();
});
