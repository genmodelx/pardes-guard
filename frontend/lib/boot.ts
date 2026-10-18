// Tiny scripts that must run before the first paint, so they are inlined in <head> as strings.
// They only read two localStorage keys and set attributes; storage that throws is ignored.

import { LOCALE_STORAGE_KEY, THEME_STORAGE_KEY, UI_LOCALES } from "@/lib/i18n/config";

export const SIMPLE_STORAGE_KEY = "pg.simple";

/** Apply the saved theme and simple mode before paint, so the page never flashes the wrong one. */
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement,t=JSON.parse(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})||"null");if(t==="dark"||t==="light")d.setAttribute("data-theme",t);if(JSON.parse(localStorage.getItem(${JSON.stringify(
  SIMPLE_STORAGE_KEY,
)})||"null")===true)d.setAttribute("data-simple","on")}catch(e){}})();`;

/** On the language picker only: people who already chose a language go straight to their home screen. */
export const RETURNING_SCRIPT = `(function(){try{var l=JSON.parse(localStorage.getItem(${JSON.stringify(
  LOCALE_STORAGE_KEY,
)})||"null");if(${JSON.stringify(UI_LOCALES)}.indexOf(l)>=0&&location.search.indexOf("choose")<0)location.replace("/"+l+"/home/")}catch(e){}})();`;
