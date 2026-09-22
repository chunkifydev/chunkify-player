import { registerPlayerTheme } from "./theme.js";
import { instaplayThemeMarkup } from "./themes/instaplay.js";

const template = document.createElement("template");
template.innerHTML = instaplayThemeMarkup;
registerPlayerTheme("instaplay", template);

export { instaplayThemeMarkup } from "./themes/instaplay.js";
