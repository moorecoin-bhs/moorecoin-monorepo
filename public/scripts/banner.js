export function showApiErrorBanner(message = "API down.") {
  let banner = document.getElementById("api-error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "api-error-banner";
    document.body.appendChild(banner);
  }
  banner.innerHTML = `${message} <a href="mailto:20029686@brightonk12.com">E-mail 20029686@brightonk12.com</a>`;
  banner.style.display = "block";
}
