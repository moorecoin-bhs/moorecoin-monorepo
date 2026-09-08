import { escapeHtml } from "./format.js";

// message is escaped even though every current caller passes the default:
// this is an innerHTML sink, and the obvious future change is to pass a
// server-supplied error string through it.
export function showApiErrorBanner(message = "API down.") {
  let banner = document.getElementById("api-error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "api-error-banner";
    document.body.appendChild(banner);
  }
  banner.innerHTML = `${escapeHtml(message)} <a href="mailto:20029686@brightonk12.com">E-mail 20029686@brightonk12.com</a>`;
  banner.style.display = "block";
}
